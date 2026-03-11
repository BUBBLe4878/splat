import os
from pathlib import Path
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config["SECRET_KEY"] = "splat-secret-2025"
HERE = Path(__file__).parent

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading", serve_client=True)

# rooms[code] = { players:[sid,...], names:{sid:name}, teams:{sid:0|1}, host:sid, settings:{}, max_players:8 }
rooms = {}
client_rooms = {}  # sid -> code

def _room_info(code):
    r = rooms.get(code)
    if not r: return []
    return [{"sid":s,"name":r["names"].get(s,"?"),"team":r["teams"].get(s,0)} for s in r["players"]]

def _cleanup_client(sid):
    code = client_rooms.get(sid)
    if not code or code not in rooms: return
    r = rooms[code]
    name = r["names"].pop(sid, "?")
    r["teams"].pop(sid, None)
    if sid in r["players"]: r["players"].remove(sid)
    del client_rooms[sid]
    if not r["players"]: del rooms[code]; return
    if r["host"] == sid and r["players"]: r["host"] = r["players"][0]
    socketio.emit("player_left", {"sid":sid,"name":name,"players":_room_info(code),"new_host":r["host"]}, room=code)

@app.route("/")
@app.route("/splat.html")
def serve_game(): return send_from_directory(HERE, "splat.html")

@app.route("/blasters.json")
def serve_blasters(): return send_from_directory(HERE, "blasters.json")

@socketio.on("host_room")
def on_host_room(data):
    sid = request.sid
    code = data.get("code","").upper().strip()
    name = data.get("name","Host")[:20]
    settings = data.get("settings", {})
    max_p = int(data.get("max_players", 8))
    if not code: emit("host_error", {"reason":"invalid_code"}); return
    if code in rooms: emit("host_error", {"reason":"code_taken"}); return
    rooms[code] = {"players":[sid],"names":{sid:name},"teams":{sid:0},"host":sid,"settings":settings,"max_players":max_p}
    client_rooms[sid] = code
    join_room(code)
    emit("host_ready", {"code":code,"players":_room_info(code)})

@socketio.on("join_room")
def on_join_room(data):
    sid = request.sid
    code = data.get("code","").upper().strip()
    name = data.get("name","Guest")[:20]
    if code not in rooms: emit("join_error", {"reason":"not_found"}); return
    r = rooms[code]
    if len(r["players"]) >= r["max_players"]: emit("join_error", {"reason":"room_full"}); return
    team = len(r["players"]) % 2
    r["players"].append(sid); r["names"][sid] = name; r["teams"][sid] = team
    client_rooms[sid] = code
    join_room(code)
    players_info = _room_info(code)
    emit("join_ready", {"code":code,"host_sid":r["host"],"host_name":r["names"].get(r["host"],"Host"),"players":players_info,"settings":r["settings"],"your_sid":sid,"your_team":team})
    socketio.emit("player_joined", {"sid":sid,"name":name,"team":team,"players":players_info}, room=code, skip_sid=sid)

@socketio.on("update_settings")
def on_update_settings(data):
    sid = request.sid
    code = client_rooms.get(sid)
    if not code or code not in rooms: return
    r = rooms[code]
    if r["host"] != sid: return
    r["settings"] = data.get("settings", {})
    socketio.emit("settings_changed", {"settings":r["settings"]}, room=code)

@socketio.on("relay")
def on_relay(data):
    sid = request.sid
    code = client_rooms.get(sid)
    if not code or code not in rooms: return
    data["from_sid"] = sid
    target_sid = data.pop("target_sid", None)
    if target_sid:
        socketio.emit("relay", data, room=target_sid)
    else:
        socketio.emit("relay", data, room=code, skip_sid=sid)

@socketio.on("leave_room")
def on_leave_room(data=None): _cleanup_client(request.sid)

@socketio.on("disconnect")
def on_disconnect(): _cleanup_client(request.sid)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"SPLAT! server starting on port {port}")
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
