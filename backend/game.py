"""Core M&M game rules: drawing, price discovery, and a floating order book."""

from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

COLORS = ("red", "green", "blue", "yellow", "brown", "orange")
TOTAL_VALUE = 600
# Players start flat. Buying borrows from the bank (cash may go negative).
STARTING_CASH = 0.0
# Pseudo-count per color so the estimated price starts at 100 each
# (6 colors * 100 = 600 total) and converges toward truth as draws reveal info.
PRICE_PRIOR = 3.0


class GameError(ValueError):
    pass


@dataclass
class Player:
    name: str
    cash: float = STARTING_CASH
    holdings: Dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for c in COLORS:
            self.holdings.setdefault(c, 0)

    def add(self, color: str, n: int) -> None:
        self.holdings[color] += n

    def take(self, color: str, n: int) -> None:
        if self.holdings[color] < n:
            raise GameError(f"Not enough {color}")
        self.holdings[color] -= n


@dataclass
class Order:
    id: int
    owner: str  # player id
    side: str  # "buy" (bid) or "sell" (ask)
    color: str
    qty: int
    price: float  # per unit


@dataclass
class Game:
    players: List[Player]
    ids: List[str]
    pool: Dict[str, int]
    initial_pool: Dict[str, int]
    turn: int = 0
    round: int = 1
    drawn_counts: Dict[str, int] = field(default_factory=lambda: {c: 0 for c in COLORS})
    price_history: List[Dict] = field(default_factory=list)
    orders: List[Order] = field(default_factory=list)
    _next_id: int = 1

    @classmethod
    def new(cls, players_info: List[Tuple[str, str]]) -> Game:
        if len(players_info) < 2:
            raise GameError("Need at least 2 players")
        pool = {c: random.randint(3, 15) for c in COLORS}
        g = cls(
            players=[Player(name.strip()) for _, name in players_info],
            ids=[pid for pid, _ in players_info],
            pool=dict(pool),
            initial_pool=dict(pool),
        )
        g.price_history.append({"round": 0, "prices": g.est_prices()})
        return g

    # ---- players ----
    def player_by_id(self, pid: str) -> Player:
        return self.players[self.ids.index(pid)]

    def current(self) -> Player:
        return self.players[self.turn % len(self.players)]

    def next_turn(self) -> None:
        self.turn += 1
        if self.turn % len(self.players) == 0:
            completed = self.round
            self.round += 1
            self.price_history.append({"round": completed, "prices": self.est_prices()})

    # ---- pool / drawing ----
    def pool_total(self) -> int:
        return sum(self.pool.values())

    def can_draw(self) -> bool:
        return self.pool_total() >= 3

    def draw(self) -> List[str]:
        if not self.can_draw():
            raise GameError("Bag has fewer than 3 M&Ms")
        out: List[str] = []
        temp = dict(self.pool)
        for _ in range(3):
            total = sum(temp.values())
            pick = random.randint(1, total)
            n = 0
            for c in COLORS:
                n += temp[c]
                if pick <= n:
                    out.append(c)
                    temp[c] -= 1
                    break
        return out

    def guess(self, colors: List[str]) -> Tuple[Dict[str, int], List[str]]:
        if len(colors) != 3:
            raise GameError("Pick exactly 3 colors")
        drawn = self.draw()
        for c in drawn:
            self.drawn_counts[c] += 1
        g = Counter(colors)
        d = Counter(drawn)
        won: Dict[str, int] = {}
        for c in COLORS:
            n = min(g[c], d[c])
            if n:
                won[c] = n
                self.pool[c] -= n
        player = self.current()
        for c, n in won.items():
            player.add(c, n)
        self.next_turn()
        return won, drawn

    # ---- pricing ----
    def est_prices(self) -> Dict[str, float]:
        """Public estimated value per color from revealed draws (starts at 100)."""
        total = sum(self.drawn_counts.values())
        denom = total + len(COLORS) * PRICE_PRIOR
        return {c: (self.drawn_counts[c] + PRICE_PRIOR) / denom * TOTAL_VALUE for c in COLORS}

    def settlement_prices(self) -> Dict[str, float]:
        """True end-game value per color (revealed only at settlement)."""
        total = sum(self.initial_pool.values())
        return {c: (self.initial_pool[c] / total) * TOTAL_VALUE for c in COLORS}

    def reserved(self, pid: str, color: str) -> int:
        return sum(
            o.qty for o in self.orders if o.owner == pid and o.side == "sell" and o.color == color
        )

    def portfolio_value(self, player: Player, prices: Dict[str, float]) -> float:
        pid = self.ids[self.players.index(player)]
        total = player.cash
        for c in COLORS:
            total += prices[c] * (player.holdings[c] + self.reserved(pid, c))
        return total

    # ---- order book ----
    def place_order(self, pid: str, side: str, color: str, qty: int, price: float) -> Order:
        if side not in ("buy", "sell"):
            raise GameError("Side must be buy or sell")
        if color not in COLORS:
            raise GameError(f"Unknown color: {color}")
        if qty < 1:
            raise GameError("Quantity must be at least 1")
        if price <= 0:
            raise GameError("Price must be positive")
        player = self.player_by_id(pid)
        if side == "sell":
            player.take(color, qty)  # reserve inventory
        o = Order(self._next_id, pid, side, color, qty, price)
        self._next_id += 1
        self.orders.append(o)
        return o

    def cancel_order(self, pid: str, order_id: int) -> None:
        o = next((x for x in self.orders if x.id == order_id), None)
        if not o or o.owner != pid:
            raise GameError("Order not found")
        if o.side == "sell":
            self.player_by_id(pid).add(o.color, o.qty)  # return reserved
        self.orders.remove(o)

    def fill_order(self, pid: str, order_id: int, qty: Optional[int] = None) -> Tuple[int, float, Order]:
        o = next((x for x in self.orders if x.id == order_id), None)
        if not o:
            raise GameError("Order already gone")
        if o.owner == pid:
            raise GameError("That is your own order")
        n = o.qty if qty is None else min(qty, o.qty)
        if n < 1:
            raise GameError("Nothing to fill")

        filler = self.player_by_id(pid)
        owner = self.player_by_id(o.owner)
        total = n * o.price

        if o.side == "sell":
            # owner is selling reserved inventory; filler buys it
            filler.add(o.color, n)
            filler.cash -= total
            owner.cash += total
        else:
            # owner has a resting bid; filler sells into it (must own inventory)
            filler.take(o.color, n)
            owner.add(o.color, n)
            filler.cash += total
            owner.cash -= total

        o.qty -= n
        if o.qty == 0:
            self.orders.remove(o)
        return n, o.price, o

    def settle(self) -> None:
        """Return reserved inventory from open sell orders and clear the book."""
        for o in list(self.orders):
            if o.side == "sell":
                self.player_by_id(o.owner).add(o.color, o.qty)
        self.orders.clear()
