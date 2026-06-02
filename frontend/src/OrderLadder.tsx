import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type OrderRow = {
  id: number;
  ownerId: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
};

const TICK = 5;
const ROW_H = 28;
const BATCH = 25;
const INITIAL = 30;
const EDGE = ROW_H * 8;
/** Orders farther than this from market snap onto the market row. */
const SNAP_GAP = TICK * 2;

function fmtQty(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n);
}

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

function roundPrice(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundToTick(n: number): number {
  return roundPrice(Math.round(n / TICK) * TICK);
}

function displayLevel(orderPrice: number, center: number): number {
  const market = roundToTick(center);
  const tick = roundToTick(orderPrice);
  if (Math.abs(orderPrice - market) > SNAP_GAP && Math.abs(tick - market) > SNAP_GAP) {
    return market;
  }
  return tick;
}

function buildLevels(center: number, above: number, below: number): number[] {
  const market = roundToTick(center);
  const levels: number[] = [];
  for (let i = above; i >= -below; i--) {
    const p = roundPrice(market + i * TICK);
    if (p > 0) levels.push(p);
  }
  return levels.sort((a, b) => b - a);
}

export function OrderLadder({
  ticker,
  marketPrice,
  orders,
  qty,
  you,
  onPlace,
  onFill,
  onCancel,
}: {
  ticker: string;
  marketPrice: number;
  orders: OrderRow[];
  qty: number;
  you?: string;
  onPlace: (side: "buy" | "sell", price: number) => void;
  onFill: (orderId: number) => void;
  onCancel: (orderId: number) => void;
}) {
  const [menuPrice, setMenuPrice] = useState<number | null>(null);
  const [above, setAbove] = useState(INITIAL);
  const [below, setBelow] = useState(INITIAL);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAdjust = useRef(0);
  const extending = useRef(false);
  const recenterPending = useRef(false);

  const scrollToMarket = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = INITIAL * ROW_H - el.clientHeight / 2;
  };

  const recenter = () => {
    setAbove(INITIAL);
    setBelow(INITIAL);
    setMenuPrice(null);
    recenterPending.current = true;
  };

  const bids = orders.filter((o) => o.side === "buy");
  const asks = orders.filter((o) => o.side === "sell");
  const openCount = orders.filter((o) => o.ownerId === you).length;
  const maxQty = Math.max(1, ...orders.map((o) => o.qty));

  const center = roundPrice(marketPrice);
  const marketTick = roundToTick(center);

  const levels = useMemo(
    () => buildLevels(center, above, below),
    [center, above, below]
  );

  useEffect(() => {
    setAbove(INITIAL);
    setBelow(INITIAL);
    setMenuPrice(null);
    recenterPending.current = true;
  }, [ticker]);

  useLayoutEffect(() => {
    if (recenterPending.current) {
      scrollToMarket();
      recenterPending.current = false;
    }
    if (scrollAdjust.current && scrollRef.current) {
      scrollRef.current.scrollTop += scrollAdjust.current;
      scrollAdjust.current = 0;
    }
    extending.current = false;
  }, [above, below]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuPrice(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const extendUp = () => {
    if (extending.current) return;
    extending.current = true;
    scrollAdjust.current = BATCH * ROW_H;
    setAbove((n) => n + BATCH);
  };

  const extendDown = () => {
    if (extending.current) return;
    const lowest = roundPrice(marketTick - below * TICK);
    if (lowest <= TICK) return;
    extending.current = true;
    setBelow((n) => n + BATCH);
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || extending.current) return;
    if (el.scrollTop < EDGE) extendUp();
    if (el.scrollHeight - el.scrollTop - el.clientHeight < EDGE) extendDown();
  };

  const openMenu = (price: number) => {
    setMenuPrice((p) => (p === price ? null : price));
  };

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-[#0a0d0a]">
      <div className="flex items-start justify-between gap-1 border-b border-zinc-800 px-2 py-2">
        <div>
          <div className="font-display text-sm font-bold text-zinc-100">{ticker}</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            {openCount ? `${openCount} open order${openCount === 1 ? "" : "s"}` : "No open orders"}
          </div>
        </div>
        <button
          type="button"
          onClick={recenter}
          title="Recenter on market price"
          aria-label="Recenter on market price"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8" cy="8" r="1.25" fill="currentColor" />
            <path d="M8 1.5v2.5M8 12v2.5M1.5 8h2.5M12 8h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto py-1">
        {levels.map((price) => {
          const bidsAt = bids.filter((o) => displayLevel(o.price, center) === price);
          const asksAt = asks.filter((o) => displayLevel(o.price, center) === price);
          const bidQty = bidsAt.reduce((s, o) => s + o.qty, 0);
          const askQty = asksAt.reduce((s, o) => s + o.qty, 0);
          const isMarket = Math.abs(price - marketTick) < 0.005;
          const bidMine = bidsAt.find((o) => o.ownerId === you);
          const askMine = asksAt.find((o) => o.ownerId === you);
          const bidOther = bidsAt.find((o) => o.ownerId !== you);
          const askOther = asksAt.find((o) => o.ownerId !== you);
          const menuOpen = menuPrice === price;
          const snapped =
            bidsAt.some((o) => Math.abs(o.price - price) > 0.005) ||
            asksAt.some((o) => Math.abs(o.price - price) > 0.005);

          return (
            <div key={price} className="relative">
              <button
                type="button"
                onClick={() => openMenu(price)}
                className={`grid h-7 w-full grid-cols-[1fr_auto_1fr] items-center text-[11px] transition hover:bg-zinc-800/30 ${
                  menuOpen ? "bg-zinc-800/40" : ""
                }`}
              >
                <span className="relative flex h-full items-center justify-end pr-1">
                  {bidQty > 0 && (
                    <>
                      <span
                        className="absolute inset-y-0 right-0 bg-emerald-500/25"
                        style={{ width: `${(bidQty / maxQty) * 100}%` }}
                      />
                      <span className={`relative z-10 font-display tabular-nums ${bidMine ? "text-emerald-300" : "text-emerald-400"}`}>
                        {fmtQty(bidQty)}
                      </span>
                    </>
                  )}
                </span>
                <span
                  className={`min-w-[3.5rem] px-1 text-center font-display tabular-nums ${
                    isMarket ? "bg-zinc-100 font-bold text-zinc-950" : snapped ? "text-amber-400" : "text-zinc-400"
                  }`}
                  title={snapped ? "Snapped order(s) on this row" : undefined}
                >
                  {fmtPrice(price)}
                </span>
                <span className="relative flex h-full items-center justify-start pl-1">
                  {askQty > 0 && (
                    <>
                      <span
                        className="absolute inset-y-0 left-0 bg-amber-900/50"
                        style={{ width: `${(askQty / maxQty) * 100}%` }}
                      />
                      <span className={`relative z-10 font-display tabular-nums ${askMine ? "text-amber-300" : "text-amber-500"}`}>
                        {fmtQty(askQty)}
                      </span>
                    </>
                  )}
                </span>
              </button>

              {menuOpen && (
                <div className="absolute left-1 right-1 z-30 -mt-0.5 flex flex-col gap-1 rounded-lg border border-zinc-700/80 bg-zinc-950/95 p-1.5 shadow-xl backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={() => {
                      onPlace("buy", price);
                      setMenuPrice(null);
                    }}
                    className="rounded-full bg-emerald-950/90 px-3 py-1.5 text-left text-[11px] text-emerald-400 transition hover:bg-emerald-900/90"
                  >
                    Buy limit{" "}
                    <span className="font-display font-bold text-zinc-100">${fmtPrice(price)}</span>
                    <span className="ml-1 text-zinc-500">×{qty}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onPlace("sell", price);
                      setMenuPrice(null);
                    }}
                    className="rounded-full bg-amber-950/90 px-3 py-1.5 text-left text-[11px] text-amber-400 transition hover:bg-amber-900/90"
                  >
                    Sell limit{" "}
                    <span className="font-display font-bold text-zinc-100">${fmtPrice(price)}</span>
                    <span className="ml-1 text-zinc-500">×{qty}</span>
                  </button>
                  {bidOther && (
                    <button
                      type="button"
                      onClick={() => {
                        onFill(bidOther.id);
                        setMenuPrice(null);
                      }}
                      className="rounded-md px-3 py-1 text-[11px] text-emerald-400 transition hover:bg-zinc-800"
                    >
                      Sell into bid · {fmtQty(bidOther.qty)} @ ${fmtPrice(bidOther.price)}
                    </button>
                  )}
                  {askOther && (
                    <button
                      type="button"
                      onClick={() => {
                        onFill(askOther.id);
                        setMenuPrice(null);
                      }}
                      className="rounded-md px-3 py-1 text-[11px] text-amber-400 transition hover:bg-zinc-800"
                    >
                      Buy from ask · {fmtQty(askOther.qty)} @ ${fmtPrice(askOther.price)}
                    </button>
                  )}
                  {bidMine && (
                    <button
                      type="button"
                      onClick={() => {
                        onCancel(bidMine.id);
                        setMenuPrice(null);
                      }}
                      className="rounded-md px-3 py-1 text-[11px] text-zinc-400 transition hover:bg-zinc-800"
                    >
                      Cancel your bid @ ${fmtPrice(bidMine.price)}
                    </button>
                  )}
                  {askMine && (
                    <button
                      type="button"
                      onClick={() => {
                        onCancel(askMine.id);
                        setMenuPrice(null);
                      }}
                      className="rounded-md px-3 py-1 text-[11px] text-zinc-400 transition hover:bg-zinc-800"
                    >
                      Cancel your ask @ ${fmtPrice(askMine.price)}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-zinc-800 px-2 py-1.5">
        <span className="inline-flex items-center gap-1 rounded bg-zinc-800/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
          LMT <span className="text-zinc-500">×{qty}</span>
        </span>
      </div>
    </div>
  );
}
