"""FastAPI server: WebSocket game + built React UI."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.game import Game, GameError
from backend.rooms import Rooms

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"
INDEX = DIST / "index.html"

app = FastAPI(title="M&M Game")
rooms = Rooms()

if INDEX.is_file():
    assets = DIST / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/")
    def home() -> FileResponse:
        return FileResponse(INDEX)
else:

    @app.get("/")
    def home() -> dict:
        return {"error": "Run .\\start.ps1 to build the UI first"}


@app.websocket("/ws")
async def ws(sock: WebSocket) -> None:
    await sock.accept()
    room = None
    me_id = None

    try:
        while True:
            raw = await sock.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await sock.send_json({"type": "error", "msg": "Bad JSON"})
                continue

            act = msg.get("action")
            try:
                if act == "create":
                    room, m = rooms.create(str(msg.get("name", "")), sock)
                    me_id = m.id
                    await sock.send_json({"type": "joined", "room": room.code, "id": me_id})
                    await room.push()

                elif act == "join":
                    room, m = rooms.join(str(msg.get("room", "")), str(msg.get("name", "")), sock)
                    me_id = m.id
                    await sock.send_json({"type": "joined", "room": room.code, "id": me_id})
                    await room.push()

                elif act == "rejoin":
                    room, m = rooms.rejoin(str(msg.get("room", "")), str(msg.get("id", "")), sock)
                    me_id = m.id
                    await sock.send_json({"type": "joined", "room": room.code, "id": me_id})
                    await room.push()

                elif act == "start":
                    if not room or me_id != room.host_id:
                        raise GameError("Only host can start")
                    if len(room.members) < 2:
                        raise GameError("Need 2+ players")
                    room.ids = [m.id for m in room.members]
                    room.game = Game.new([(m.id, m.name) for m in room.members])
                    room.phase = "playing"
                    room.set_event({"kind": "msg", "text": "Market open. Good luck!"})
                    await room.push()

                elif act == "guess":
                    if not room or not room.game:
                        raise GameError("No game")
                    if room.ids[room.game.turn % len(room.ids)] != me_id:
                        raise GameError("Not your turn")
                    if not room.game.can_draw():
                        room.game.settle()
                        room.phase = "ended"
                        room.set_event({"kind": "msg", "text": "Bag empty — settlement"})
                    else:
                        colors = msg.get("colors") or []
                        won, drawn = room.game.guess(colors)
                        p = room.game.players[room.idx(me_id)]
                        ev = {
                            "kind": "guess",
                            "who": p.name,
                            "guess": colors,
                            "drawn": drawn,
                            "won": won,
                        }
                        if not room.game.can_draw():
                            room.game.settle()
                            room.phase = "ended"
                            ev["text"] = "Bag depleted — settlement"
                        room.set_event(ev)
                    await room.push()

                elif act == "place":
                    if not room or not room.game:
                        raise GameError("No game")
                    side = str(msg.get("side", "")).lower()
                    color = str(msg.get("color", "")).lower()
                    qty = int(msg.get("qty") or 0)
                    price = float(msg.get("price") or 0)
                    resting, fills = room.game.place_order(me_id, side, color, qty, price)
                    g = room.game
                    if fills:
                        f = fills[-1]
                        taker = g.player_by_id(f.taker_id).name
                        maker = g.player_by_id(f.maker_id).name
                        taker_side = "buy" if f.buyer_id == f.taker_id else "sell"
                        room.set_event({
                            "kind": "trade",
                            "side": taker_side,
                            "trader": taker,
                            "other": maker,
                            "color": f.color,
                            "qty": f.qty,
                            "price": round(f.price, 2),
                        })
                    elif resting:
                        who = g.player_by_id(me_id).name
                        room.set_event({
                            "kind": "place",
                            "side": side,
                            "who": who,
                            "color": color,
                            "qty": resting.qty,
                            "price": round(price, 2),
                        })
                    await room.push()

                elif act == "fill":
                    if not room or not room.game:
                        raise GameError("No game")
                    order_id = int(msg.get("orderId"))
                    qty = msg.get("qty")
                    qty = int(qty) if qty else None
                    n, px, o = room.game.fill_order(me_id, order_id, qty)
                    filler = room.game.player_by_id(me_id).name
                    maker = room.game.player_by_id(o.owner).name
                    # filler takes the opposite side of the resting order
                    filler_side = "buy" if o.side == "sell" else "sell"
                    room.set_event({
                        "kind": "trade",
                        "side": filler_side,
                        "trader": filler,
                        "other": maker,
                        "color": o.color,
                        "qty": n,
                        "price": round(px, 2),
                    })
                    await room.push()

                elif act == "cancel":
                    if not room or not room.game:
                        raise GameError("No game")
                    room.game.cancel_order(me_id, int(msg.get("orderId")))
                    await room.push()

                elif act == "end":
                    if not room or me_id != room.host_id:
                        raise GameError("Only host can end")
                    room.game.settle()
                    room.phase = "ended"
                    room.set_event({"kind": "msg", "text": "Host called settlement"})
                    await room.push()

                else:
                    await sock.send_json({"type": "error", "msg": f"Unknown: {act}"})

            except GameError as e:
                await sock.send_json({"type": "error", "msg": str(e)})

    except WebSocketDisconnect:
        pass
    finally:
        if room is not None and me_id is not None:
            room.remove(me_id)
            if not room.members:
                rooms.all.pop(room.code, None)
            else:
                try:
                    await room.push()
                except Exception:
                    pass
