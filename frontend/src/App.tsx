import { useEffect, useRef, useState } from "react";
import { PriceChart, type HistoryPoint } from "./PriceChart";

const COLORS = ["red", "green", "blue", "yellow", "brown", "orange"] as const;
type Color = (typeof COLORS)[number];

const BG: Record<Color, string> = {
  red: "bg-red-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  yellow: "bg-yellow-400",
  brown: "bg-amber-700",
  orange: "bg-orange-500",
};

const TICKER: Record<Color, string> = {
  red: "RED",
  green: "GRN",
  blue: "BLU",
  yellow: "YEL",
  brown: "BRN",
  orange: "ORG",
};

type EventMsg = {
  kind: string;
  text?: string;
  who?: string;
  guess?: string[];
  drawn?: string[];
  won?: Record<string, number>;
  side?: string;
  trader?: string;
  other?: string;
  color?: string;
  qty?: number;
  price?: number;
};

type Player = {
  id: string;
  name: string;
  host?: boolean;
  you?: boolean;
  holdings?: Record<string, number>;
  reserved?: Record<string, number>;
  cash?: number;
  value?: number;
  pnl?: number;
  turn?: boolean;
};

type OrderRow = {
  id: number;
  ownerId: string;
  owner: string;
  side: "buy" | "sell";
  color: Color;
  qty: number;
  price: number;
};

type State = {
  phase: "lobby" | "playing" | "ended";
  room: string;
  host: string;
  you?: string;
  players: Player[];
  round?: number;
  poolTotal?: number;
  initial?: Record<string, number>;
  prices?: Record<string, number>;
  prevPrices?: Record<string, number>;
  history?: HistoryPoint[];
  orders?: OrderRow[];
  turn?: string;
  turnName?: string;
  canDraw?: boolean;
  event?: EventMsg;
  seq?: number;
  standings?: {
    name: string;
    score: number;
    cash: number;
    mmValue: number;
    holdings: Record<string, number>;
  }[];
};

type FeedItem = EventMsg & { seq: number };

function money(n: number | undefined, dp = 2): string {
  const v = n ?? 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

function useSocket() {
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const lastSeq = useRef<number>(-1);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const s = new WebSocket(`${proto}//${location.host}/ws`);
    s.onopen = () => setConnected(true);
    s.onclose = () => setConnected(false);
    s.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "error") setErr(m.msg);
      else if (m.type === "joined") setErr(null);
      else if (m.type === "state") {
        setState(m);
        setErr(null);
        if (typeof m.seq === "number" && m.seq !== lastSeq.current && m.event) {
          lastSeq.current = m.seq;
          setFeed((f) => [{ ...m.event, seq: m.seq }, ...f].slice(0, 30));
        }
      }
    };
    wsRef.current = s;
    return () => s.close();
  }, []);

  const send = (action: string, data: Record<string, unknown> = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErr("Not connected");
      return;
    }
    ws.send(JSON.stringify({ action, ...data }));
  };

  return { connected, err, setErr, state, feed, send };
}

function Dot({ color, size = 3 }: { color: Color; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full ${BG[color]}`}
      style={{ width: size * 4, height: size * 4 }}
    />
  );
}

function feedLine(e: EventMsg): { text: string; tone: string } {
  if (e.kind === "trade") {
    const buy = e.side === "buy";
    return {
      text: `${e.trader} ${buy ? "bought" : "sold"} ${e.qty} ${e.color} @ ${money(e.price)}`,
      tone: buy ? "text-emerald-400" : "text-rose-400",
    };
  }
  if (e.kind === "place") {
    return {
      text: `${e.who} posted ${e.side} ${e.qty} ${e.color} @ ${money(e.price)}`,
      tone: "text-zinc-400",
    };
  }
  if (e.kind === "guess") {
    const won = Object.entries(e.won || {})
      .map(([c, n]) => `${n} ${c}`)
      .join(", ");
    return {
      text: `${e.who} drew [${e.drawn?.join(", ")}]${won ? ` · won ${won}` : " · no match"}`,
      tone: won ? "text-emerald-300" : "text-zinc-500",
    };
  }
  return { text: e.text || "", tone: "text-zinc-400" };
}

export default function App() {
  const { connected, err, setErr, state, feed, send } = useSocket();
  const [name, setName] = useState("");
  const [roomIn, setRoomIn] = useState("");
  const [pick, setPick] = useState<Color[]>([]);

  const [sel, setSel] = useState<Color>("red");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");

  const phase = state?.phase ?? "join";
  const me = state?.players.find((p) => p.you);
  const myTurn = state?.turn === state?.you && state?.canDraw;

  const placeOrder = () => {
    const p = parseFloat(price);
    if (!p || p <= 0) return setErr("Enter a limit price");
    send("place", { side, color: sel, qty, price: p });
    setPrice("");
  };

  // ---------- JOIN ----------
  if (phase === "join") {
    return (
      <Shell>
        <Centered>
          <h2 className="font-display text-lg font-semibold text-zinc-100">Sign in to the desk</h2>
          <Field label="Trader name">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane"
            />
          </Field>
          <button
            className="btn-buy mt-4 w-full"
            disabled={!connected}
            onClick={() => (name.trim() ? send("create", { name: name.trim() }) : setErr("Enter a name"))}
          >
            Open new room
          </button>
          <div className="divider">or join</div>
          <Field label="Room code">
            <input
              className="input text-center font-display text-lg uppercase tracking-[0.3em]"
              value={roomIn}
              maxLength={5}
              onChange={(e) => setRoomIn(e.target.value.toUpperCase())}
            />
          </Field>
          <button
            className="btn-ghost mt-3 w-full"
            disabled={!connected}
            onClick={() =>
              name.trim() && roomIn.trim()
                ? send("join", { name: name.trim(), room: roomIn.trim() })
                : setErr("Name + room code required")
            }
          >
            Join room
          </button>
          {err && <p className="mt-3 text-sm text-rose-400">{err}</p>}
          <p className="mt-3 text-center text-[11px] text-zinc-600">
            {connected ? "● live" : "connecting…"}
          </p>
        </Centered>
      </Shell>
    );
  }

  // ---------- LOBBY ----------
  if (phase === "lobby" && state) {
    return (
      <Shell room={state.room}>
        <Centered>
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-wider text-zinc-500">Room</span>
            <code className="font-display text-2xl tracking-[0.3em] text-emerald-400">
              {state.room}
            </code>
            <button className="text-xs text-zinc-400 underline" onClick={() => navigator.clipboard?.writeText(state.room)}>
              copy
            </button>
          </div>
          <ul className="mt-5 divide-y divide-zinc-800">
            {state.players.map((p) => (
              <li key={p.id} className="flex justify-between py-2.5 text-sm">
                <span>{p.name}</span>
                <span className="text-xs text-zinc-500">
                  {p.host && "host "}
                  {p.you && "· you"}
                </span>
              </li>
            ))}
          </ul>
          {state.you === state.host ? (
            <button className="btn-buy mt-4 w-full" disabled={state.players.length < 2} onClick={() => send("start")}>
              Open market
            </button>
          ) : (
            <p className="mt-4 text-center text-sm text-zinc-500">Waiting for host…</p>
          )}
          {err && <p className="mt-2 text-sm text-rose-400">{err}</p>}
        </Centered>
      </Shell>
    );
  }

  // ---------- ENDED ----------
  if (phase === "ended" && state) {
    return (
      <Shell room={state.room}>
        <div className="mx-auto mt-8 max-w-2xl space-y-4 px-3">
          <Panel title="Settlement — true prices revealed">
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
              {COLORS.map((c) => (
                <div key={c} className="flex items-center justify-between rounded-md bg-zinc-950/60 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 capitalize">
                    <Dot color={c} /> {c} ×{state.initial?.[c] ?? "?"}
                  </span>
                  <span className="font-display text-emerald-400">{money(state.prices?.[c])}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Final portfolio value">
            <ol className="space-y-2 p-3">
              {state.standings?.map((s, i) => (
                <li key={s.name} className="flex items-center gap-3 border-b border-zinc-800 pb-2">
                  <span className={`font-display text-xl ${i === 0 ? "text-emerald-400" : "text-zinc-600"}`}>#{i + 1}</span>
                  <div className="flex-1">
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-zinc-500">
                      {money(s.cash)} cash + {money(s.mmValue)} candy
                    </div>
                  </div>
                  <span className={`font-display text-lg ${s.score >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {money(s.score)}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
          <button className="btn-ghost w-full" onClick={() => location.reload()}>
            New game
          </button>
        </div>
      </Shell>
    );
  }

  // ---------- PLAYING ----------
  if (phase === "playing" && state && me) {
    const prices = state.prices ?? {};
    const prev = state.prevPrices ?? {};
    const orders = (state.orders ?? []).filter((o) => o.color === sel);
    const asks = orders.filter((o) => o.side === "sell").sort((a, b) => a.price - b.price);
    const bids = orders.filter((o) => o.side === "buy").sort((a, b) => b.price - a.price);
    const cash = me.cash ?? 0;
    const pnl = me.pnl ?? 0;

    return (
      <div className="flex h-screen flex-col bg-[#0a0d0a] text-zinc-200">
        <TopBar room={state.room}>
          <span className="text-xs text-zinc-400">
            Round <strong className="text-zinc-100">{state.round}</strong>
          </span>
          <span className="text-xs text-zinc-400">
            Bag <strong className="text-zinc-100">{state.poolTotal}</strong>
          </span>
          <span className={`text-xs ${myTurn ? "font-semibold text-emerald-400" : "text-zinc-400"}`}>
            {myTurn ? "● your turn to draw" : `${state.turnName} drawing`}
          </span>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Portfolio</div>
              <div className="font-display text-sm font-bold tabular-nums text-zinc-100">{money(me.value)}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">PnL</div>
              <div className={`font-display text-sm font-bold tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {pnl >= 0 ? "▲" : "▼"} {money(Math.abs(pnl))}
              </div>
            </div>
            {state.you === state.host && (
              <button className="rounded bg-rose-900/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/70" onClick={() => confirm("Call settlement now?") && send("end")}>
                End
              </button>
            )}
          </div>
        </TopBar>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_1fr_340px]">
          {/* LEFT: watchlist + positions */}
          <div className="flex min-h-0 flex-col border-r border-zinc-800">
            <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Watchlist
            </div>
            <div className="overflow-auto">
              {COLORS.map((c) => {
                const chg = (prices[c] ?? 100) - (prev[c] ?? 100);
                return (
                  <button
                    key={c}
                    onClick={() => setSel(c)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                      sel === c ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                    }`}
                  >
                    <Dot color={c} />
                    <span className="font-display w-9 text-zinc-200">{TICKER[c]}</span>
                    <span className="ml-auto text-right">
                      <span className="block font-display tabular-nums text-zinc-100">{money(prices[c], 1)}</span>
                      <span className={`block text-[10px] tabular-nums ${chg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {chg >= 0 ? "+" : ""}
                        {chg.toFixed(1)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 border-y border-zinc-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Positions
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {COLORS.filter((c) => (me.holdings?.[c] ?? 0) + (me.reserved?.[c] ?? 0) > 0).length === 0 ? (
                <p className="px-3 py-2 text-sm text-zinc-600">Flat</p>
              ) : (
                COLORS.map((c) => {
                  const h = me.holdings?.[c] ?? 0;
                  const r = me.reserved?.[c] ?? 0;
                  if (h + r === 0) return null;
                  return (
                    <div key={c} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="flex items-center gap-2 capitalize">
                        <Dot color={c} /> {c}
                      </span>
                      <span className="font-display tabular-nums">
                        {h}
                        {r > 0 && <span className="text-zinc-500"> (+{r} working)</span>}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* CENTER: chart + draw + activity */}
          <div className="flex min-h-0 flex-col border-r border-zinc-800">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
              <Dot color={sel} size={4} />
              <span className="font-display text-lg font-bold text-zinc-100">{TICKER[sel]}</span>
              <span className="text-xs capitalize text-zinc-500">{sel}</span>
              <span className="font-display ml-3 text-xl tabular-nums text-zinc-100">{money(prices[sel])}</span>
              {(() => {
                const chg = (prices[sel] ?? 100) - (prev[sel] ?? 100);
                return (
                  <span className={`text-sm tabular-nums ${chg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}
                  </span>
                );
              })()}
            </div>
            <div className="min-h-0 flex-1">
              <PriceChart
                history={state.history ?? []}
                round={state.round ?? 1}
                livePrice={prices[sel] ?? 100}
                color={sel}
              />
            </div>

            {/* draw bar */}
            <div className="border-t border-zinc-800 px-4 py-2">
              {myTurn ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-zinc-500">Draw — guess 3:</span>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      disabled={pick.length >= 3}
                      onClick={() => setPick([...pick, c])}
                      title={c}
                      className={`h-8 w-8 rounded-full border-2 border-white/10 ${BG[c]} transition hover:scale-110 disabled:opacity-40`}
                    />
                  ))}
                  <span className="font-display ml-2 text-sm text-zinc-300">{pick.join(" · ") || "—"}</span>
                  <button className="btn-ghost ml-auto !py-1 !px-3 text-xs" onClick={() => setPick([])}>
                    Clear
                  </button>
                  <button
                    className="btn-buy !py-1 !px-4 text-xs"
                    disabled={pick.length !== 3}
                    onClick={() => {
                      send("guess", { colors: pick });
                      setPick([]);
                    }}
                  >
                    Draw
                  </button>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  Waiting for <span className="text-zinc-300">{state.turnName}</span> to draw — trade meanwhile.
                </p>
              )}
            </div>

            {/* activity */}
            <div className="h-40 overflow-auto border-t border-zinc-800">
              <div className="sticky top-0 bg-[#0a0d0a] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Recent activity
              </div>
              {feed.length === 0 ? (
                <p className="px-3 py-2 text-sm text-zinc-600">No activity yet.</p>
              ) : (
                feed.map((f) => {
                  const { text, tone } = feedLine(f);
                  return (
                    <div key={f.seq} className={`border-b border-zinc-800/50 px-3 py-1 text-xs ${tone}`}>
                      {text}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT: account + ticket + order book + traders */}
          <div className="flex min-h-0 flex-col overflow-auto">
            <div className="border-b border-zinc-800 p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Cash (bank credit)</div>
              <div className={`font-display text-2xl font-bold tabular-nums ${cash < 0 ? "text-rose-400" : "text-zinc-100"}`}>
                {money(cash)}
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-zinc-500">Portfolio</span>
                <span className="font-display tabular-nums text-zinc-200">{money(me.value)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">PnL (since start)</span>
                <span className={`font-display tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {pnl >= 0 ? "+" : ""}
                  {money(pnl)}
                </span>
              </div>
            </div>

            {/* order ticket */}
            <div className="border-b border-zinc-800 p-3">
              <div className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-zinc-950 p-1">
                <button
                  className={`rounded py-1.5 text-sm font-semibold ${side === "buy" ? "bg-emerald-500 text-zinc-950" : "text-zinc-400"}`}
                  onClick={() => setSide("buy")}
                >
                  Buy / Bid
                </button>
                <button
                  className={`rounded py-1.5 text-sm font-semibold ${side === "sell" ? "bg-rose-500 text-zinc-950" : "text-zinc-400"}`}
                  onClick={() => setSide("sell")}
                >
                  Sell / Ask
                </button>
              </div>
              <div className="flex items-center gap-2 rounded-md bg-zinc-950/60 px-3 py-1.5 text-sm">
                <Dot color={sel} /> <span className="font-display">{TICKER[sel]}</span>
                <span className="text-xs capitalize text-zinc-500">{sel}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-[11px] uppercase tracking-wider text-zinc-500">
                  Qty
                  <input
                    type="number"
                    min={1}
                    className="input mt-1"
                    value={qty}
                    onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  />
                </label>
                <label className="text-[11px] uppercase tracking-wider text-zinc-500">
                  Limit $/unit
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input mt-1"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="100"
                  />
                </label>
              </div>
              <button
                className={`mt-2 w-full rounded-md py-2 text-sm font-semibold text-zinc-950 ${side === "buy" ? "bg-emerald-500 hover:bg-emerald-400" : "bg-rose-500 hover:bg-rose-400"}`}
                onClick={placeOrder}
              >
                Post {side === "buy" ? "bid" : "ask"}
              </button>
              {err && <p className="mt-1 text-xs text-rose-400">{err}</p>}
            </div>

            {/* order book */}
            <div className="border-b border-zinc-800">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Order book · {TICKER[sel]}
              </div>
              <div className="grid grid-cols-3 px-3 text-[10px] uppercase tracking-wider text-zinc-600">
                <span>Price</span>
                <span className="text-center">Qty</span>
                <span className="text-right">Who</span>
              </div>
              {asks.length === 0 && <div className="px-3 py-0.5 text-xs text-zinc-700">no asks</div>}
              {asks
                .slice()
                .reverse()
                .map((o) => (
                  <BookRow key={o.id} o={o} you={state.you} onFill={() => send("fill", { orderId: o.id })} onCancel={() => send("cancel", { orderId: o.id })} tone="rose" />
                ))}
              <div className="my-1 border-t border-dashed border-zinc-800" />
              {bids.map((o) => (
                <BookRow key={o.id} o={o} you={state.you} onFill={() => send("fill", { orderId: o.id })} onCancel={() => send("cancel", { orderId: o.id })} tone="emerald" />
              ))}
              {bids.length === 0 && <div className="px-3 py-0.5 pb-2 text-xs text-zinc-700">no bids</div>}
            </div>

            {/* traders */}
            <div>
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Leaderboard</div>
              {state.players
                .slice()
                .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
                .map((p) => (
                  <div key={p.id} className={`flex items-center justify-between px-3 py-1.5 text-sm ${p.turn ? "bg-emerald-500/5" : ""}`}>
                    <span>
                      {p.name}
                      {p.you && <span className="ml-1 text-xs text-emerald-400">you</span>}
                    </span>
                    <span className={`font-display tabular-nums text-xs ${(p.value ?? 0) >= 0 ? "text-zinc-300" : "text-rose-400"}`}>
                      {money(p.value)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <Shell />;
}

function BookRow({
  o,
  you,
  onFill,
  onCancel,
  tone,
}: {
  o: OrderRow;
  you?: string;
  onFill: () => void;
  onCancel: () => void;
  tone: "rose" | "emerald";
}) {
  const mine = o.ownerId === you;
  return (
    <div className="grid grid-cols-3 items-center px-3 py-0.5 text-xs">
      <span className={`font-display tabular-nums ${tone === "rose" ? "text-rose-400" : "text-emerald-400"}`}>
        {money(o.price, 2)}
      </span>
      <span className="text-center tabular-nums text-zinc-300">{o.qty}</span>
      <span className="flex items-center justify-end gap-1">
        <span className="truncate text-zinc-500">{mine ? "you" : o.owner}</span>
        {mine ? (
          <button className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700" onClick={onCancel}>
            ✕
          </button>
        ) : (
          <button className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-100 hover:bg-zinc-600" onClick={onFill}>
            fill
          </button>
        )}
      </span>
    </div>
  );
}

function Shell({ children, room }: { children?: React.ReactNode; room?: string }) {
  return (
    <div className="min-h-screen bg-[#0a0d0a] text-zinc-200">
      <TopBar room={room} />
      <main>{children}</main>
    </div>
  );
}

function TopBar({ children, room }: { children?: React.ReactNode; room?: string }) {
  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 bg-gradient-to-r from-emerald-950/40 to-zinc-950 px-4 py-2">
      <span className="font-display text-lg font-bold tracking-tight text-emerald-400">M&M</span>
      <span className="text-sm font-semibold text-zinc-300">Trading Desk</span>
      {room && !children && (
        <span className="ml-auto text-xs text-zinc-500">
          room <code className="font-display tracking-widest text-emerald-400">{room}</code>
        </span>
      )}
      {children}
    </header>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/70">
      <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </div>
      {children}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto mt-10 max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/70 p-6">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-4 block text-xs uppercase tracking-wider text-zinc-500">
      {label}
      {children}
    </label>
  );
}
