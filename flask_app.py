import os
from pathlib import Path
from flask import Flask, send_from_directory, send_file, request
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["SECRET_KEY"] = "splat-secret-2025"
HERE = Path(__file__).parent

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading", serve_client=True)

rooms = {}
client_rooms = {}

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
def serve_game():
    return send_file(HERE / "splat.html")

@app.route("/splat.html")
def serve_game_html():
    return send_file(HERE / "splat.html")

@app.route("/static/blasters.json")
def serve_blasters():
    return send_from_directory(HERE, "static/blasters.json")

@app.route("/static/mods.json")
def serve_mods():
    return send_from_directory(HERE, "static/mods.json")

@app.route("/static/maps.json")
def serve_maps():
    return send_from_directory(HERE, "static/maps.json")

@app.route("/static/armor.json")
def serve_armor_items():
    return send_from_directory(HERE, "static/armor.json")

@app.route("/static/medical_items.json")
def serve_medical_items():
    return send_from_directory(HERE, "static/medical_items.json")

# --- rest of your socket handlers unchanged below ---

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
    print(f"SPLAT! server starting on http://0.0.0.0:{port}")
    print(f"Looking for splat.html at: {HERE / 'splat.html'}")
    print(f"File exists: {(HERE / 'splat.html').exists()}")
    socketio.run(app, host="0.0.0.0", port=port, debug=False)
