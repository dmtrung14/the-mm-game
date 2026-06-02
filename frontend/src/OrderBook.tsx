type Color = string;

type OrderRow = {
  id: number;
  side: "buy" | "sell";
  color: Color;
  qty: number;
  price: number;
};

const ROW =
  "grid w-full grid-cols-[11%_13%_11%_18%_18%_1fr] items-center gap-x-[0.6vw] px-[0.8vw]";

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

export function OrderBook({
  orders,
  prices,
  ticker,
  onFill,
}: {
  orders: OrderRow[];
  prices: Record<string, number>;
  ticker: Record<string, string>;
  onFill: (orderId: number) => void;
}) {
  const sorted = [...orders].sort((a, b) => {
    const sym = (ticker[a.color] ?? a.color).localeCompare(ticker[b.color] ?? b.color);
    if (sym !== 0) return sym;
    if (a.side !== b.side) return a.side === "sell" ? -1 : 1;
    return a.side === "sell" ? a.price - b.price : b.price - a.price;
  });

  return (
    <div className="mt-3 w-full border-t border-zinc-800 pt-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Order book</div>

      {sorted.length === 0 ? (
        <p className="py-3 text-xs text-zinc-600">No orders to fill.</p>
      ) : (
        <>
          <div className={`${ROW} mt-2 pb-1.5 text-[9px] uppercase tracking-wider text-zinc-600`}>
            <span>Sym</span>
            <span>Side</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Price</span>
            <span className="text-right">Strike</span>
            <span />
          </div>

          <div className="max-h-[28vh] w-full overflow-y-auto rounded-md border border-zinc-800/80 bg-zinc-950/40">
            {sorted.map((o) => {
              const bid = o.side === "buy";
              const strike = prices[o.color] ?? 100;
              return (
                <div
                  key={o.id}
                  className={`group ${ROW} border-b border-zinc-800/50 py-[0.55vh] text-[10px] transition-colors last:border-0 hover:bg-zinc-800/30`}
                >
                  <span className="truncate font-display text-zinc-200">{ticker[o.color] ?? o.color}</span>
                  <span className={`truncate font-semibold uppercase ${bid ? "text-emerald-400" : "text-rose-400"}`}>
                    {bid ? "Buy" : "Sell"}
                  </span>
                  <span className="text-right font-display tabular-nums text-zinc-300">{o.qty}</span>
                  <span className="text-right font-display tabular-nums text-zinc-200">{fmtPrice(o.price)}</span>
                  <span className="text-right font-display tabular-nums text-zinc-500">{fmtPrice(strike)}</span>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => onFill(o.id)}
                      className={`translate-x-[0.4vw] rounded px-[0.6vw] py-[0.25vh] text-[9px] font-semibold opacity-0 transition-opacity group-hover:opacity-100 ${
                        bid
                          ? "bg-rose-900/50 text-rose-300 hover:bg-rose-900/80"
                          : "bg-emerald-900/50 text-emerald-300 hover:bg-emerald-900/80"
                      }`}
                    >
                      Fill
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
