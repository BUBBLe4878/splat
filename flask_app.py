# ========================================
# SPLAT! — Flask + Socket.IO relay server
# ========================================
# Deploy instructions (HidenCloud / any VPS):
#   1) pip install flask flask-socketio
#   2) python flask_app.py
#   3) Both players open http://YOUR_SERVER_IP:5000
# ========================================

from pathlib import Path
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit, join_room, leave_room

BASE_DIR = Path(__file__).resolve().parent

app = Flask(__name__)
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    serve_client=True,
)

# room_code -> {"host": sid, "guest": sid|None, "host_name": str, "guest_name": str|None}
rooms = {}
# sid -> room_code  (reverse lookup for fast cleanup)
client_rooms = {}


# ── Serve the game ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "splat.html")

@app.route("/splat.html")
def splat():
    return send_from_directory(BASE_DIR, "splat.html")


# ── Room cleanup helper ───────────────────────────────────────────────────────

def _cleanup_client(sid):
    code = client_rooms.pop(sid, None)
    if not code:
        return
    room = rooms.get(code)
    if not room:
        return

    if room.get("host") == sid:
        # Host left — kick the guest and close the room
        guest_sid = room.get("guest")
        if guest_sid:
            client_rooms.pop(guest_sid, None)
            emit("peer_left", {"role": "host"}, to=guest_sid)
            try:
                leave_room(code, sid=guest_sid)
            except TypeError:
                pass  # older flask-socketio versions don't take sid kwarg
        rooms.pop(code, None)
    else:
        # Guest left — keep room open so host can accept someone else
        room["guest"] = None
        room["guest_name"] = None
        emit("peer_left", {"role": "guest"}, room=code, include_self=False)

    try:
        leave_room(code)
    except Exception:
        pass


# ── Socket.IO events ─────────────────────────────────────────────────────────

@socketio.on("host_room")
def on_host_room(data):
    code = (data.get("code") or "").upper()
    name = data.get("name") or "Host"

    if not code:
        emit("host_error", {"reason": "bad_code"})
        return
    if code in rooms:
        emit("host_error", {"reason": "code_in_use"})
        return

    rooms[code] = {
        "host": request.sid,
        "guest": None,
        "host_name": name,
        "guest_name": None,
    }
    join_room(code)
    client_rooms[request.sid] = code
    emit("host_ready", {"code": code})
    print(f"[SPLAT] Room created: {code}  host={name} ({request.sid})")


@socketio.on("join_room")
def on_join_room(data):
    code = (data.get("code") or "").upper()
    name = data.get("name") or "Guest"

    room = rooms.get(code)
    if not room:
        emit("join_error", {"reason": "not_found"})
        return
    if room.get("guest"):
        emit("join_error", {"reason": "room_full"})
        return

    room["guest"] = request.sid
    room["guest_name"] = name
    join_room(code)
    client_rooms[request.sid] = code

    emit("join_ready", {"code": code, "host_name": room["host_name"]})
    # Tell everyone else in the room (i.e. the host) a guest arrived
    emit("guest_joined", {"name": name}, room=code, include_self=False)
    print(f"[SPLAT] {name} ({request.sid}) joined room {code}")


@socketio.on("relay")
def on_relay(msg):
    """Forward any game message to the other player — no server-side logic."""
    code = client_rooms.get(request.sid)
    if not code:
        return
    emit("relay", msg, room=code, include_self=False)


@socketio.on("leave_room")
def on_leave_room(_data=None):
    _cleanup_client(request.sid)


@socketio.on("disconnect")
def on_disconnect():
    _cleanup_client(request.sid)
    print(f"[SPLAT] Client disconnected: {request.sid}")


# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("SPLAT! server starting on http://0.0.0.0:5000")
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
