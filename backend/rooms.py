"""Multiplayer rooms over WebSocket."""

from __future__ import annotations

import random
import string
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket

from backend.game import COLORS, Game, GameError


def _code() -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=5))


@dataclass
class Member:
    id: str
    name: str
    ws: WebSocket


@dataclass
class Room:
    code: str
    host_id: str
    members: List[Member] = field(default_factory=list)
    game: Optional[Game] = None
    ids: List[str] = field(default_factory=list)
    player_names: Dict[str, str] = field(default_factory=dict)
    left: Set[str] = field(default_factory=set)
    phase: str = "lobby"
    event: Optional[Dict[str, Any]] = None
    seq: int = 0

    def idx(self, player_id: str) -> int:
        return self.ids.index(player_id)

    def remove(self, player_id: str) -> None:
        self.members = [m for m in self.members if m.id != player_id]

    def is_connected(self, player_id: str) -> bool:
        return any(m.id == player_id for m in self.members)

    def is_active(self, player_id: str) -> bool:
        """In-game and still able to act (connected and not intentionally left)."""
        return player_id not in self.left and self.is_connected(player_id)

    def skip_inactive_turns(self) -> None:
        """Advance past disconnected or departed players who cannot draw."""
        if not self.game or self.phase != "playing":
            return
        n = len(self.ids)
        for _ in range(n):
            cur = self.ids[self.game.turn % n]
            if self.is_active(cur):
                break
            self.game.next_turn()

    def active_turn_id(self) -> str:
        self.skip_inactive_turns()
        assert self.game
        return self.ids[self.game.turn % len(self.ids)]

    def leave(self, player_id: str) -> str:
        """Remove a player from the live session. Returns their display name."""
        if player_id in self.left:
            raise GameError("Already left")
        if self.phase == "lobby":
            name = next(m.name for m in self.members if m.id == player_id)
            self.remove(player_id)
            if player_id in self.ids:
                self.ids.remove(player_id)
            self.player_names.pop(player_id, None)
            if player_id == self.host_id and self.members:
                self.host_id = self.members[0].id
            return name
        if self.phase == "playing":
            if player_id == self.host_id:
                raise GameError("Host can't leave — call settlement or wait for the game to end")
            if player_id not in self.ids:
                raise GameError("Not in this game")
            self.left.add(player_id)
            self.remove(player_id)
            self.skip_inactive_turns()
            return self.game.player_by_id(player_id).name
        # ended — spectator disconnect only
        name = (
            self.game.player_by_id(player_id).name
            if self.game and player_id in self.ids
            else self.player_names.get(player_id, "Player")
        )
        self.remove(player_id)
        return name

    def rejoin(self, player_id: str, ws: WebSocket) -> Member:
        """Reattach a live socket for a player who already belongs to this room."""
        if player_id in self.left:
            raise GameError("You left this game")
        if player_id not in self.ids:
            raise GameError("Not in this game")
        self.remove(player_id)
        name = (
            self.game.players[self.ids.index(player_id)].name
            if self.game
            else self.player_names[player_id]
        )
        mem = Member(player_id, name, ws)
        self.members.append(mem)
        return mem

    def set_event(self, ev: Dict[str, Any]) -> None:
        self.seq += 1
        self.event = ev

    def snapshot(self, you: Optional[str] = None) -> Dict[str, Any]:
        if self.phase == "lobby":
            return {
                "type": "state",
                "phase": "lobby",
                "room": self.code,
                "host": self.host_id,
                "you": you,
                "players": [
                    {
                        "id": m.id,
                        "name": m.name,
                        "host": m.id == self.host_id,
                        "you": m.id == you,
                    }
                    for m in self.members
                ],
                "event": self.event,
                "seq": self.seq,
            }

        assert self.game
        g = self.game
        cur = self.active_turn_id()
        est = g.market_prices()
        prev = g.price_history[-1]["prices"] if g.price_history else est

        body: Dict[str, Any] = {
            "type": "state",
            "phase": self.phase,
            "room": self.code,
            "host": self.host_id,
            "you": you,
            "round": g.round,
            "poolTotal": g.pool_total(),
            "turn": cur,
            "turnName": g.current().name,
            "canDraw": g.can_draw(),
            "prices": {c: round(est[c], 2) for c in COLORS},
            "prevPrices": {c: round(prev[c], 2) for c in COLORS},
            "drawnCounts": {c: g.drawn_counts[c] for c in COLORS},
            "pickedCounts": {c: g.picked_counts[c] for c in COLORS},
            "history": [
                {"round": h["round"], "prices": {c: round(h["prices"][c], 2) for c in COLORS}}
                for h in g.price_history
            ],
            "orders": [
                {
                    "id": o.id,
                    "ownerId": o.owner,
                    "owner": g.player_by_id(o.owner).name,
                    "side": o.side,
                    "color": o.color,
                    "qty": o.qty,
                    "price": round(o.price, 2),
                }
                for o in g.orders
            ],
            "players": [
                {
                    "id": self.ids[i],
                    "name": p.name,
                    "holdings": p.holdings,
                    "reserved": {c: g.reserved(self.ids[i], c) for c in COLORS},
                    "cash": round(p.cash, 2),
                    "value": round(g.portfolio_value(p, est), 2),
                    "pnl": round(g.pnl_since_start(p, est), 2),
                    "pnlRound": round(g.pnl_round(p, est), 2),
                    "portfolioHistory": [
                        {"round": int(h["round"]), "value": round(h["value"], 2)}
                        for h in p.portfolio_history
                    ],
                    "you": self.ids[i] == you,
                    "turn": self.ids[i] == cur,
                    "connected": self.is_connected(self.ids[i]),
                    "left": self.ids[i] in self.left,
                }
                for i, p in enumerate(g.players)
            ],
            "event": self.event,
            "seq": self.seq,
        }

        if self.phase == "ended":
            sp = g.settlement_prices()
            body["initial"] = dict(g.initial_pool)
            body["prices"] = {c: round(sp[c], 2) for c in COLORS}
            ranked = sorted(g.players, key=lambda p: g.portfolio_value(p, sp), reverse=True)
            body["standings"] = [
                {
                    "name": p.name,
                    "cash": round(p.cash, 2),
                    "mmValue": round(g.portfolio_value(p, sp) - p.cash, 2),
                    "score": round(g.portfolio_value(p, sp), 2),
                    "holdings": p.holdings,
                }
                for p in ranked
            ]
        return body

    async def push(self) -> None:
        # Send each live member their snapshot; prune any whose socket is gone
        # so one dead/closed connection can't abort the broadcast for everyone.
        dead: List[Member] = []
        for m in list(self.members):
            try:
                await m.ws.send_json(self.snapshot(m.id))
            except Exception:
                dead.append(m)
        for m in dead:
            self.remove(m.id)


class Rooms:
    def __init__(self) -> None:
        self.all: Dict[str, Room] = {}

    def create(self, name: str, ws: WebSocket) -> tuple[Room, Member]:
        code = _code()
        while code in self.all:
            code = _code()
        pid = str(uuid.uuid4())
        mem = Member(pid, name.strip(), ws)
        room = Room(code, pid, [mem])
        room.ids = [pid]
        room.player_names = {pid: name.strip()}
        self.all[code] = room
        return room, mem

    def join(self, code: str, name: str, ws: WebSocket) -> tuple[Room, Member, bool]:
        """Join a room. Returns (room, member, joined_mid_game)."""
        code = code.strip().upper()
        room = self.all.get(code)
        if not room:
            raise GameError("Room not found")
        if room.phase == "ended":
            raise GameError("Game is over")
        clean = name.strip()
        if room.game:
            if any(p.name.lower() == clean.lower() for p in room.game.players):
                raise GameError("Name taken")
        elif any(m.name.lower() == clean.lower() for m in room.members):
            raise GameError("Name taken")
        pid = str(uuid.uuid4())
        mem = Member(pid, clean, ws)
        room.members.append(mem)
        room.ids.append(pid)
        room.player_names[pid] = clean
        mid_game = room.phase == "playing"
        if mid_game:
            assert room.game
            room.game.add_player(pid, clean)
        return room, mem, mid_game

    def rejoin(self, code: str, player_id: str, ws: WebSocket) -> tuple[Room, Member]:
        code = code.strip().upper()
        room = self.all.get(code)
        if not room:
            raise GameError("Room not found")
        mem = room.rejoin(player_id, ws)
        return room, mem
