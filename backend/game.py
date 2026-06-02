"""Core M&M game rules: drawing, price discovery, and a floating order book."""

from __future__ import annotations

import heapq
import random
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

COLORS = ("red", "green", "blue", "yellow", "brown", "orange")
TOTAL_VALUE = 600
# Players start flat. Buying borrows from the bank (cash may go negative).
STARTING_CASH = 0.0
# Every color is quoted at this price until a trade prints a new one.
DEFAULT_PRICE = 100.0


class GameError(ValueError):
    pass


@dataclass
class Player:
    name: str
    cash: float = STARTING_CASH
    holdings: Dict[str, int] = field(default_factory=dict)
    # Par baseline: +100 for every candy this player has picked up from a draw.
    expected: float = 0.0
    # Net-worth snapshots at each round boundary; starts at 0 for round 1.
    round_values: List[float] = field(default_factory=lambda: [0.0])
    # Chart history keyed by game round.
    portfolio_history: List[Dict[str, float]] = field(
        default_factory=lambda: [{"round": 0, "value": 0.0}]
    )

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
class Fill:
    buyer_id: str
    seller_id: str
    color: str
    qty: int
    price: float
    maker_id: str
    maker_order_id: int
    taker_id: str
    taker_order_id: int


class OrderBook:
    """Price-time priority book for one color.

    Bids: max-heap on price (negated for heapq), then earliest id.
    Asks: min-heap on price, then earliest id.
    """

    def __init__(self, color: str) -> None:
        self.color = color
        self._bids: List[Tuple[float, int, Order]] = []
        self._asks: List[Tuple[float, int, Order]] = []
        self._by_id: Dict[int, Order] = {}
        self._dead: set[int] = set()

    def get(self, order_id: int) -> Optional[Order]:
        o = self._by_id.get(order_id)
        if o and order_id not in self._dead and o.qty > 0:
            return o
        return None

    def all_orders(self) -> List[Order]:
        return [o for o in self._by_id.values() if o.id not in self._dead and o.qty > 0]

    def add_resting(self, order: Order) -> None:
        self._by_id[order.id] = order
        if order.side == "buy":
            heapq.heappush(self._bids, (-order.price, order.id, order))
        else:
            heapq.heappush(self._asks, (order.price, order.id, order))

    def remove(self, order_id: int) -> Order:
        o = self._by_id.pop(order_id)
        self._dead.add(order_id)
        return o

    def clear(self) -> List[Order]:
        orders = self.all_orders()
        self._bids.clear()
        self._asks.clear()
        self._by_id.clear()
        self._dead.clear()
        return orders

    def _live(self, order: Order) -> bool:
        return order.id in self._by_id and order.id not in self._dead and order.qty > 0

    def _pop_best_bid(self) -> Optional[Order]:
        while self._bids:
            _, _, o = heapq.heappop(self._bids)
            if self._live(o):
                return o
        return None

    def _pop_best_ask(self) -> Optional[Order]:
        while self._asks:
            _, _, o = heapq.heappop(self._asks)
            if self._live(o):
                return o
        return None

    def _requeue(self, order: Order) -> None:
        if not self._live(order):
            return
        if order.side == "buy":
            heapq.heappush(self._bids, (-order.price, order.id, order))
        else:
            heapq.heappush(self._asks, (order.price, order.id, order))

    def match(self, taker: Order) -> List[Fill]:
        """Match *taker* against resting orders; return fills at maker prices."""
        if taker.side == "buy":
            return self._match_buy(taker)
        return self._match_sell(taker)

    def _match_buy(self, taker: Order) -> List[Fill]:
        fills: List[Fill] = []
        deferred: List[Order] = []
        while taker.qty > 0:
            ask = self._pop_best_ask()
            if not ask:
                break
            if ask.owner == taker.owner:
                deferred.append(ask)
                continue
            if ask.price > taker.price:
                deferred.append(ask)
                break
            n = min(taker.qty, ask.qty)
            fills.append(
                Fill(
                    buyer_id=taker.owner,
                    seller_id=ask.owner,
                    color=self.color,
                    qty=n,
                    price=ask.price,
                    maker_id=ask.owner,
                    maker_order_id=ask.id,
                    taker_id=taker.owner,
                    taker_order_id=taker.id,
                )
            )
            taker.qty -= n
            ask.qty -= n
            if ask.qty == 0:
                self.remove(ask.id)
            else:
                deferred.append(ask)
        for o in deferred:
            self._requeue(o)
        return fills

    def _match_sell(self, taker: Order) -> List[Fill]:
        fills: List[Fill] = []
        deferred: List[Order] = []
        while taker.qty > 0:
            bid = self._pop_best_bid()
            if not bid:
                break
            if bid.owner == taker.owner:
                deferred.append(bid)
                continue
            if bid.price < taker.price:
                deferred.append(bid)
                break
            n = min(taker.qty, bid.qty)
            fills.append(
                Fill(
                    buyer_id=bid.owner,
                    seller_id=taker.owner,
                    color=self.color,
                    qty=n,
                    price=bid.price,
                    maker_id=bid.owner,
                    maker_order_id=bid.id,
                    taker_id=taker.owner,
                    taker_order_id=taker.id,
                )
            )
            taker.qty -= n
            bid.qty -= n
            if bid.qty == 0:
                self.remove(bid.id)
            else:
                deferred.append(bid)
        for o in deferred:
            self._requeue(o)
        return fills


@dataclass
class Game:
    players: List[Player]
    ids: List[str]
    pool: Dict[str, int]
    initial_pool: Dict[str, int]
    turn: int = 0
    round: int = 1
    # How many of each color have come out of the bag across all draws.
    drawn_counts: Dict[str, int] = field(default_factory=lambda: {c: 0 for c in COLORS})
    # Of those drawn, how many were actually matched/picked up by a player.
    picked_counts: Dict[str, int] = field(default_factory=lambda: {c: 0 for c in COLORS})
    # Last printed transaction price per color; quotes stay at default until a fill.
    last_trade: Dict[str, float] = field(
        default_factory=lambda: {c: DEFAULT_PRICE for c in COLORS}
    )
    price_history: List[Dict] = field(default_factory=list)
    books: Dict[str, OrderBook] = field(default_factory=dict)
    _next_id: int = 1

    def __post_init__(self) -> None:
        if not self.books:
            self.books = {c: OrderBook(c) for c in COLORS}

    @property
    def orders(self) -> List[Order]:
        out: List[Order] = []
        for book in self.books.values():
            out.extend(book.all_orders())
        return out

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
        g.price_history.append({"round": 0, "prices": g.market_prices()})
        return g

    def add_player(self, pid: str, name: str) -> Player:
        """Add a player mid-game with a fresh portfolio."""
        p = Player(name.strip())
        self.players.append(p)
        self.ids.append(pid)
        prices = self.market_prices()
        val = self.portfolio_value(p, prices)
        p.portfolio_history = [
            {"round": int(h["round"]), "value": val}
            for h in self.price_history
        ]
        if not p.portfolio_history:
            p.portfolio_history = [{"round": 0, "value": val}]
        p.round_values = [val]
        return p

    # ---- players ----
    def player_by_id(self, pid: str) -> Player:
        return self.players[self.ids.index(pid)]

    def current(self) -> Player:
        return self.players[self.turn % len(self.players)]

    def next_turn(self) -> None:
        self.turn += 1

    def _roll_round(self) -> None:
        """Advance to the round the turn pointer now sits in, sealing the
        prior round's close as each player's round-PnL baseline.

        Done lazily at the start of a draw (rather than the instant the last
        player of a round draws) so a round-closing draw is still reflected in
        the round it belonged to before the baseline resets to zero.
        """
        target = self.turn // len(self.players) + 1
        while self.round < target:
            prices = self.market_prices()
            completed = self.round
            self.price_history.append({"round": completed, "prices": prices})
            for p in self.players:
                val = self.portfolio_value(p, prices)
                p.round_values.append(val)
                p.portfolio_history.append({"round": completed, "value": val})
            self.round += 1

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
        self._roll_round()
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
                self.picked_counts[c] += n
        player = self.current()
        for c, n in won.items():
            player.add(c, n)
            player.expected += DEFAULT_PRICE * n
        self.next_turn()
        return won, drawn

    # ---- pricing ----
    def market_prices(self) -> Dict[str, float]:
        """Quoted price per color = last transaction price (default until traded)."""
        return {c: self.last_trade[c] for c in COLORS}

    def pnl_since_start(self, player: Player, prices: Dict[str, float]) -> float:
        """Net worth vs the par baseline of every candy drawn (100 each).

        Net worth includes cash, so realized gains/losses from trading count too.
        """
        return self.portfolio_value(player, prices) - player.expected

    def pnl_round(self, player: Player, prices: Dict[str, float]) -> float:
        """Round PnL = current net worth minus the last sealed snapshot.

        Uses round_values[-1] as the baseline (0 on the first round).
        """
        current = self.portfolio_value(player, prices)
        baseline = player.round_values[-1] if player.round_values else 0.0
        return current - baseline

    def settlement_prices(self) -> Dict[str, float]:
        """True end-game value per color (revealed only at settlement)."""
        total = sum(self.initial_pool.values())
        return {c: (self.initial_pool[c] / total) * TOTAL_VALUE for c in COLORS}

    def reserved(self, pid: str, color: str) -> int:
        book = self.books[color]
        return sum(o.qty for o in book.all_orders() if o.owner == pid and o.side == "sell")

    def _find_order(self, order_id: int) -> Tuple[OrderBook, Order]:
        for book in self.books.values():
            o = book.get(order_id)
            if o:
                return book, o
        raise GameError("Order not found")

    def _apply_fill(self, fill: Fill) -> None:
        buyer = self.player_by_id(fill.buyer_id)
        seller = self.player_by_id(fill.seller_id)
        total = fill.qty * fill.price
        buyer.add(fill.color, fill.qty)
        buyer.cash -= total
        seller.cash += total
        self.last_trade[fill.color] = fill.price

    def portfolio_value(self, player: Player, prices: Dict[str, float]) -> float:
        pid = self.ids[self.players.index(player)]
        total = player.cash
        for c in COLORS:
            total += prices[c] * (player.holdings[c] + self.reserved(pid, c))
        return total

    # ---- order book ----
    def place_order(
        self, pid: str, side: str, color: str, qty: int, price: float
    ) -> Tuple[Optional[Order], List[Fill]]:
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
            player.take(color, qty)  # reserve inventory for the full order

        taker = Order(self._next_id, pid, side, color, qty, price)
        self._next_id += 1

        book = self.books[color]
        fills = book.match(taker)
        for f in fills:
            self._apply_fill(f)

        if taker.qty > 0:
            book.add_resting(taker)
            return taker, fills
        return None, fills

    def cancel_order(self, pid: str, order_id: int) -> None:
        book, o = self._find_order(order_id)
        if o.owner != pid:
            raise GameError("Order not found")
        if o.side == "sell":
            self.player_by_id(pid).add(o.color, o.qty)  # return reserved
        book.remove(order_id)

    def fill_order(self, pid: str, order_id: int, qty: Optional[int] = None) -> Tuple[int, float, Order]:
        book, o = self._find_order(order_id)
        if o.owner == pid:
            raise GameError("That is your own order")
        n = o.qty if qty is None else min(qty, o.qty)
        if n < 1:
            raise GameError("Nothing to fill")

        if o.side == "sell":
            fill = Fill(
                buyer_id=pid,
                seller_id=o.owner,
                color=o.color,
                qty=n,
                price=o.price,
                maker_id=o.owner,
                maker_order_id=o.id,
                taker_id=pid,
                taker_order_id=o.id,
            )
        else:
            self.player_by_id(pid).take(o.color, n)
            fill = Fill(
                buyer_id=o.owner,
                seller_id=pid,
                color=o.color,
                qty=n,
                price=o.price,
                maker_id=o.owner,
                maker_order_id=o.id,
                taker_id=pid,
                taker_order_id=o.id,
            )

        self._apply_fill(fill)
        o.qty -= n
        if o.qty == 0:
            book.remove(o.id)
        return n, o.price, o

    def settle(self) -> None:
        """Return reserved inventory from open sell orders and clear the book."""
        for book in self.books.values():
            for o in book.all_orders():
                if o.side == "sell":
                    self.player_by_id(o.owner).add(o.color, o.qty)
            book.clear()
