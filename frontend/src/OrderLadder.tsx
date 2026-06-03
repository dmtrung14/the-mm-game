import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type OrderRow = {
  id: number;
  ownerId: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
};

type RowHover = { price: number; side: "buy" | "sell" } | null;

const TICK = 5;
const ROW_H = 28;
const PRICE_COL = "3.25rem";
const BATCH = 25;
const INITIAL = 30;
const EDGE = ROW_H * 8;

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

function orderLevel(orderPrice: number): number {
  return roundToTick(orderPrice);
}

function uniqueOrders(orders: OrderRow[]): OrderRow[] {
  const seen = new Set<number>();
  return orders.filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });
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

function IconCross({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function SideAction({ side, onPlace }: { side: "buy" | "sell"; onPlace: () => void }) {
  const buy = side === "buy";
  return (
    <div className="flex h-full w-full min-w-0 items-center justify-center px-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPlace();
        }}
        className={`font-display text-sm font-semibold leading-none ${buy ? "text-emerald-400" : "text-rose-400"}`}
      >
        {buy ? "Buy limit" : "Sell limit"}
      </button>
    </div>
  );
}

/** One resting own-order bar: × (dark side-colored tail) + qty body toward price. */
function OwnOrderBar({
  side,
  order,
  onCancel,
}: {
  side: "buy" | "sell";
  order: OrderRow;
  onCancel: () => void;
}) {
  const buy = side === "buy";
  const bodyBg = buy ? "bg-emerald-500" : "bg-rose-500";
  const tailBg = buy
    ? "bg-emerald-800 text-emerald-50 hover:bg-emerald-900"
    : "bg-rose-800 text-rose-50 hover:bg-rose-900";

  return (
    <div className="relative z-10 flex h-6 w-full min-w-0 shrink-0 overflow-hidden rounded-md border border-zinc-600/70 shadow-sm">
      {buy ? (
        <>
          <button
            type="button"
            aria-label="Cancel order"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className={`flex shrink-0 items-center justify-center rounded-l-md px-1.5 ${tailBg}`}
          >
            <IconCross className="h-3 w-3" />
          </button>
          <div
            className={`flex min-w-0 flex-1 items-center justify-end rounded-r-md px-1.5 font-display text-[10px] font-bold tabular-nums text-zinc-950 ${bodyBg}`}
          >
            {fmtQty(order.qty)}
          </div>
        </>
      ) : (
        <>
          <div
            className={`flex min-w-0 flex-1 items-center justify-start rounded-l-md px-1.5 font-display text-[10px] font-bold tabular-nums text-zinc-950 ${bodyBg}`}
          >
            {fmtQty(order.qty)}
          </div>
          <button
            type="button"
            aria-label="Cancel order"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className={`flex shrink-0 items-center justify-center rounded-r-md px-1.5 ${tailBg}`}
          >
            <IconCross className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}

function QtyStepper({ qty, onChange }: { qty: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center rounded-md bg-zinc-900">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, qty - 1))}
        className="px-2 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-100"
        aria-label="Decrease quantity"
      >
        −
      </button>
      <span className="min-w-[1.75rem] text-center font-display text-sm tabular-nums text-zinc-100">{qty}</span>
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        className="px-2 py-1.5 text-sm text-zinc-400 transition hover:text-zinc-100"
        aria-label="Increase quantity"
      >
        +
      </button>
    </div>
  );
}

export function OrderLadder({
  ticker,
  marketPrice,
  orders,
  you,
  onPlace,
  onFill,
  onCancel,
}: {
  ticker: string;
  marketPrice: number;
  orders: OrderRow[];
  you?: string;
  onPlace: (side: "buy" | "sell", price: number, qty: number) => void;
  onFill: (orderId: number) => void;
  onCancel: (orderId: number) => void;
}) {
  const [ladderQty, setLadderQty] = useState(1);
  const [rowHover, setRowHover] = useState<RowHover>(null);
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
    recenterPending.current = true;
  };

  const bids = orders.filter((o) => o.side === "buy");
  const asks = orders.filter((o) => o.side === "sell");
  const openCount = orders.filter((o) => o.ownerId === you).length;
  const maxQty = Math.max(1, ...orders.map((o) => o.qty));

  const center = roundPrice(marketPrice);
  const marketTick = roundToTick(center);

  const levels = useMemo(() => buildLevels(center, above, below), [center, above, below]);

  useEffect(() => {
    setAbove(INITIAL);
    setBelow(INITIAL);
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

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-[#12100f]">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-2.5 py-2">
        <div className="min-w-0">
          <div className="font-display text-sm font-bold tracking-tight text-zinc-100">{ticker}</div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            {openCount ? `${openCount} open` : "0 open"} · LMT ×{ladderQty}
          </div>
        </div>
        <button
          type="button"
          onClick={recenter}
          title="Recenter on market"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8" cy="8" r="1.25" fill="currentColor" />
            <path d="M8 1.5v2.5M8 12v2.5M1.5 8h2.5M12 8h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 border-b border-zinc-800/80 p-2">
        <button
          type="button"
          onClick={() => onPlace("buy", marketTick, ladderQty)}
          className="rounded-md bg-zinc-900 py-1.5 text-[11px] font-semibold text-emerald-400 transition hover:bg-zinc-800"
        >
          Buy MKT
        </button>
        <QtyStepper qty={ladderQty} onChange={setLadderQty} />
        <button
          type="button"
          onClick={() => onPlace("sell", marketTick, ladderQty)}
          className="rounded-md bg-zinc-900 py-1.5 text-[11px] font-semibold text-rose-400 transition hover:bg-zinc-800"
        >
          Sell MKT
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onMouseLeave={() => setRowHover(null)}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {levels.map((price) => {
          const bidsAt = bids.filter((o) => orderLevel(o.price) === price);
          const asksAt = asks.filter((o) => orderLevel(o.price) === price);
          const bidQty = bidsAt.reduce((s, o) => s + o.qty, 0);
          const askQty = asksAt.reduce((s, o) => s + o.qty, 0);
          const isMarket = Math.abs(price - marketTick) < 0.005;
          const bidMine = uniqueOrders(bidsAt.filter((o) => o.ownerId === you));
          const askMine = uniqueOrders(asksAt.filter((o) => o.ownerId === you));
          const bidOther = bidsAt.filter((o) => o.ownerId !== you);
          const askOther = asksAt.filter((o) => o.ownerId !== you);
          const hoverBuy = rowHover?.price === price && rowHover?.side === "buy";
          const hoverSell = rowHover?.price === price && rowHover?.side === "sell";
          const canBuyLimit = bidsAt.length === 0;
          const canSellLimit = asksAt.length === 0;
          const showBuyBand = hoverBuy && canBuyLimit;
          const showSellBand = hoverSell && canSellLimit;
          const chipStack = Math.max(bidMine.length, askMine.length);
          const rowPad = chipStack > 0 ? "py-0.5" : "";

          return (
            <div
              key={price}
              className={`relative grid items-stretch overflow-hidden border-b border-zinc-900/80 min-h-7 ${rowPad} ${
                showBuyBand || showSellBand ? "min-h-8" : ""
              }`}
              style={{ gridTemplateColumns: `minmax(0, 1fr) ${PRICE_COL} minmax(0, 1fr)` }}
              onMouseLeave={() => setRowHover(null)}
            >
              {/* Bid depth + own orders */}
              <div
                className="relative z-0 col-start-1 row-start-1 flex min-h-6 w-full min-w-0 flex-col justify-center gap-0.5 py-0.5"
                onMouseEnter={() => canBuyLimit && setRowHover({ price, side: "buy" })}
              >
                {bidMine.map((o) => (
                  <OwnOrderBar
                    key={o.id}
                    side="buy"
                    order={o}
                    onCancel={() => onCancel(o.id)}
                  />
                ))}
                {bidMine.length === 0 && bidQty > 0 && (
                  <div className="relative flex h-6 w-full shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => bidOther[0] && onFill(bidOther[0].id)}
                      disabled={!bidOther[0]}
                      className={`relative flex h-full w-full min-w-0 items-center justify-end pr-0.5 ${
                        bidOther[0] ? "cursor-pointer" : "cursor-default"
                      }`}
                      title={bidOther[0] ? "Fill bid" : undefined}
                    >
                      <span className="relative z-10 shrink-0 font-display text-[10px] leading-none tabular-nums text-emerald-500">
                        {fmtQty(bidOther.length > 0 ? bidOther.reduce((s, x) => s + x.qty, 0) : bidQty)}
                      </span>
                      <span
                        className="absolute inset-y-0 right-0 bg-emerald-600/75"
                        style={{
                          width: `${Math.min(
                            100,
                            ((bidOther.length > 0 ? bidOther.reduce((s, x) => s + x.qty, 0) : bidQty) / maxQty) *
                              100
                          )}%`,
                        }}
                      />
                    </button>
                  </div>
                )}
                {bidMine.length > 0 && bidOther.length > 0 && (
                  <div className="relative flex h-6 w-full shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => onFill(bidOther[0].id)}
                      className="relative flex h-full w-full min-w-0 cursor-pointer items-center justify-end pr-0.5"
                      title="Fill bid"
                    >
                      <span className="relative z-10 shrink-0 font-display text-[10px] leading-none tabular-nums text-emerald-500">
                        {fmtQty(bidOther.reduce((s, x) => s + x.qty, 0))}
                      </span>
                      <span
                        className="absolute inset-y-0 right-0 bg-emerald-600/75"
                        style={{
                          width: `${Math.min(100, (bidOther.reduce((s, x) => s + x.qty, 0) / maxQty) * 100)}%`,
                        }}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* Price column (idle) */}
              <div
                className={`pointer-events-none relative z-10 col-start-2 row-start-1 flex min-h-7 items-center justify-center ${
                  showBuyBand || showSellBand ? "invisible" : ""
                }`}
              >
                <span
                  className={`font-display text-[11px] leading-none tabular-nums ${
                    isMarket
                      ? "rounded-sm bg-zinc-100 px-1 py-0.5 font-bold text-zinc-950"
                      : "text-zinc-500"
                  }`}
                >
                  {fmtPrice(price)}
                </span>
              </div>

              {/* Ask depth + own orders */}
              <div
                className="relative z-0 col-start-3 row-start-1 flex min-h-6 w-full min-w-0 flex-col justify-center gap-0.5 py-0.5"
                onMouseEnter={() => canSellLimit && setRowHover({ price, side: "sell" })}
              >
                {askMine.map((o) => (
                  <OwnOrderBar
                    key={o.id}
                    side="sell"
                    order={o}
                    onCancel={() => onCancel(o.id)}
                  />
                ))}
                {askMine.length === 0 && askQty > 0 && (
                  <div className="relative flex h-6 w-full shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => askOther[0] && onFill(askOther[0].id)}
                      disabled={!askOther[0]}
                      className={`relative flex h-full w-full min-w-0 items-center justify-start pl-0.5 ${
                        askOther[0] ? "cursor-pointer" : "cursor-default"
                      }`}
                      title={askOther[0] ? "Fill ask" : undefined}
                    >
                      <span
                        className="absolute inset-y-0 left-0 bg-rose-600/70"
                        style={{
                          width: `${Math.min(
                            100,
                            ((askOther.length > 0 ? askOther.reduce((s, x) => s + x.qty, 0) : askQty) / maxQty) *
                              100
                          )}%`,
                        }}
                      />
                      <span className="relative z-10 shrink-0 font-display text-[10px] leading-none tabular-nums text-rose-500">
                        {fmtQty(askOther.length > 0 ? askOther.reduce((s, x) => s + x.qty, 0) : askQty)}
                      </span>
                    </button>
                  </div>
                )}
                {askMine.length > 0 && askOther.length > 0 && (
                  <div className="relative flex h-6 w-full shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => onFill(askOther[0].id)}
                      className="relative flex h-full w-full min-w-0 cursor-pointer items-center justify-start pl-0.5"
                      title="Fill ask"
                    >
                      <span
                        className="absolute inset-y-0 left-0 bg-rose-600/70"
                        style={{
                          width: `${Math.min(100, (askOther.reduce((s, x) => s + x.qty, 0) / maxQty) * 100)}%`,
                        }}
                      />
                      <span className="relative z-10 shrink-0 font-display text-[10px] leading-none tabular-nums text-rose-500">
                        {fmtQty(askOther.reduce((s, x) => s + x.qty, 0))}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* Buy: one highlight over bid side + price column */}
              <div
                className={`col-start-1 col-end-3 row-start-1 z-20 mx-0.5 grid items-stretch self-center overflow-hidden rounded-sm border border-emerald-600/45 bg-emerald-950/85 transition-opacity ${
                  showBuyBand ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
                }`}
                style={{
                  gridTemplateColumns: `minmax(0, 1fr) ${PRICE_COL}`,
                  minHeight: "1.625rem",
                }}
              >
                <div className="h-full min-w-0">
                  <SideAction side="buy" onPlace={() => onPlace("buy", price, ladderQty)} />
                </div>
                <div className="flex items-center justify-center">
                  <span className="font-display text-sm font-bold leading-none tabular-nums text-white">
                    {fmtPrice(price)}
                  </span>
                </div>
              </div>

              {/* Sell: one highlight over price column + ask side */}
              <div
                className={`col-start-2 col-end-4 row-start-1 z-20 mx-0.5 grid items-stretch self-center overflow-hidden rounded-sm border border-rose-600/45 bg-rose-950/85 transition-opacity ${
                  showSellBand ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
                }`}
                style={{
                  gridTemplateColumns: `${PRICE_COL} minmax(0, 1fr)`,
                  minHeight: "1.625rem",
                }}
              >
                <div className="flex items-center justify-center">
                  <span className="font-display text-sm font-bold leading-none tabular-nums text-white">
                    {fmtPrice(price)}
                  </span>
                </div>
                <div className="h-full min-w-0">
                  <SideAction side="sell" onPlace={() => onPlace("sell", price, ladderQty)} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
