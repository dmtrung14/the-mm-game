import { useEffect, useRef, useState } from "react";
import { LandingPage } from "./LandingPage";
import { OrderLadder } from "./OrderLadder";
import { PortfolioChart, type PortfolioPoint } from "./PortfolioChart";
import { PriceChart, type HistoryPoint } from "./PriceChart";

const COLORS = ["red", "green", "blue", "yellow", "brown", "orange"] as const;
type Color = (typeof COLORS)[number];

const BG: Record<Color, string> = {
  red: "bg-red-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  yellow: "bg-yellow-400",
  brown: "bg-[#4a3728]",
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
  pnlRound?: number;
  portfolioHistory?: { round: number; value: number }[];
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
  drawnCounts?: Record<string, number>;
  pickedCounts?: Record<string, number>;
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

const SESSION_KEY = "mm-game-session";

type Session = { room: string; id: string };

type SocketListener = {
  onConnected: (v: boolean) => void;
  onErr: (v: string | null) => void;
  onState: (m: State) => void;
  onFeed: (item: FeedItem) => void;
};

let socket: WebSocket | null = null;
let listener: SocketListener | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastSeq = 0;

function saveSession(room: string, id: string) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ room, id }));
}

function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s.room && s.id ? s : null;
  } catch {
    return null;
  }
}

function dispatchMessage(m: Record<string, unknown>) {
  if (!listener) return;
  if (m.type === "error") listener.onErr(String(m.msg));
  else if (m.type === "joined") {
    listener.onErr(null);
    saveSession(String(m.room), String(m.id));
  } else if (m.type === "state") {
    listener.onErr(null);
    listener.onState(m as State);
    const seq = m.seq as number | undefined;
    const event = m.event as EventMsg | undefined;
    if (typeof seq === "number" && seq !== lastSeq && event) {
      lastSeq = seq;
      listener.onFeed({ ...event, seq });
    }
    const you = m.you as string | undefined;
    const room = m.room as string | undefined;
    if (you && room) saveSession(room, you);
  }
}

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket;
  }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const s = new WebSocket(`${proto}//${location.host}/ws`);
  socket = s;

  s.onopen = () => {
    listener?.onConnected(true);
    const session = loadSession();
    if (session) {
      s.send(JSON.stringify({ action: "rejoin", room: session.room, id: session.id }));
    }
  };

  s.onclose = () => {
    listener?.onConnected(false);
    socket = null;
    if (listener && loadSession()) {
      reconnectTimer = setTimeout(connectSocket, 1000);
    }
  };

  s.onmessage = (e) => {
    try {
      dispatchMessage(JSON.parse(e.data));
    } catch {
      listener?.onErr("Bad server message");
    }
  };

  return s;
}

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

  useEffect(() => {
    listener = {
      onConnected: setConnected,
      onErr: setErr,
      onState: setState,
      onFeed: (item) => setFeed((f) => [item, ...f].slice(0, 30)),
    };
    connectSocket();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      listener = null;
      // Keep socket open across HMR; only close on full page unload.
    };
  }, []);

  useEffect(() => {
    const onUnload = () => {
      socket?.close();
      socket = null;
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const send = (action: string, data: Record<string, unknown> = {}) => {
    const ws = socket ?? connectSocket();
    if (ws.readyState !== WebSocket.OPEN) {
      setErr("Not connected");
      return;
    }
    ws.send(JSON.stringify({ action, ...data }));
  };

  return { connected, err, setErr, state, feed, send };
}

function usePortfolioPoints(
  me: Player | undefined,
  round: number,
  seq?: number
): PortfolioPoint[] {
  const [points, setPoints] = useState<PortfolioPoint[]>([{ index: 0, round: 0, value: 0 }]);
  const nextIndex = useRef(1);
  const seeded = useRef(false);

  useEffect(() => {
    if (!me?.portfolioHistory?.length) return;
    const fromServer: PortfolioPoint[] = me.portfolioHistory.map((p, i) => ({
      index: i,
      round: p.round,
      value: p.value,
    }));
    nextIndex.current = fromServer.length;
    setPoints(fromServer);
    seeded.current = true;
  }, [me?.portfolioHistory?.length, me?.id]);

  useEffect(() => {
    if (me?.value === undefined) return;
    setPoints((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.value === me.value && last.round === round) return prev;
      const pt: PortfolioPoint = { index: nextIndex.current++, round, value: me.value! };
      return [...prev, pt];
    });
  }, [me?.value, round, seq]);

  useEffect(() => {
    if (!me) {
      seeded.current = false;
      nextIndex.current = 1;
      setPoints([{ index: 0, round: 0, value: 0 }]);
    }
  }, [me?.id]);

  return points;
}

function Dot({ color, size = 3 }: { color: Color; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full ${BG[color]}`}
      style={{ width: size * 4, height: size * 4 }}
    />
  );
}

function tk(c?: string): string {
  return c && c in TICKER ? TICKER[c as Color] : (c ?? "");
}

function FeedRow({ e }: { e: EventMsg }) {
  if (e.kind === "trade") {
    const buy = e.side === "buy";
    return (
      <div className="flex items-center gap-1.5 border-b border-zinc-800/50 px-3 py-1 text-[11px] leading-tight">
        <span className={`font-display ${buy ? "text-emerald-400" : "text-rose-400"}`}>
          {buy ? "▲" : "▼"}
        </span>
        {e.color && <Dot color={e.color as Color} size={2} />}
        <span className="text-zinc-200">{e.trader}</span>
        <span className="text-zinc-500">{buy ? "bought" : "sold"}</span>
        <span className="font-display tabular-nums text-zinc-200">
          {e.qty} {tk(e.color)}
        </span>
        <span className="font-display tabular-nums text-zinc-400">@{money(e.price)}</span>
        {e.other && <span className="ml-auto truncate text-zinc-600">↔ {e.other}</span>}
      </div>
    );
  }
  if (e.kind === "place") {
    const bid = e.side === "buy";
    return (
      <div className="flex items-center gap-1.5 border-b border-zinc-800/50 px-3 py-1 text-[11px] leading-tight text-zinc-500">
        {e.color && <Dot color={e.color as Color} size={2} />}
        <span className="text-zinc-300">{e.who}</span>
        <span className={bid ? "text-emerald-500/80" : "text-rose-500/80"}>{bid ? "bid" : "ask"}</span>
        <span className="font-display tabular-nums text-zinc-400">
          {e.qty} {tk(e.color)}
        </span>
        <span className="font-display tabular-nums">@{money(e.price)}</span>
      </div>
    );
  }
  if (e.kind === "guess") {
    const won = e.won || {};
    const wonTotal = Object.values(won).reduce((a, b) => a + b, 0);
    // Walk the draw and flag each dot that fills one of the matched units.
    const left: Record<string, number> = { ...won };
    return (
      <div className="flex items-center gap-1.5 border-b border-zinc-800/50 px-3 py-1 text-[11px] leading-tight">
        <span className="text-zinc-300">{e.who}</span>
        <span className="text-zinc-600">guessed</span>
        <span className="flex items-center gap-0.5">
          {e.guess?.map((c, i) => <Dot key={i} color={c as Color} size={2} />)}
        </span>
        <span className="text-zinc-600">· drew</span>
        <span className="flex items-center gap-0.5">
          {e.drawn?.map((c, i) => {
            const hit = (left[c] ?? 0) > 0;
            if (hit) left[c] -= 1;
            return (
              <span
                key={i}
                className={hit ? "rounded-full ring-2 ring-emerald-400 ring-offset-1 ring-offset-[#0a0d0a]" : ""}
              >
                <Dot color={c as Color} size={2} />
              </span>
            );
          })}
        </span>
        <span className={`ml-auto font-display tabular-nums ${wonTotal ? "text-emerald-300" : "text-zinc-600"}`}>
          {wonTotal ? `+${wonTotal}` : "no match"}
        </span>
      </div>
    );
  }
  return (
    <div className="border-b border-zinc-800/50 px-3 py-1 text-[11px] leading-tight text-zinc-400">
      {e.text || ""}
    </div>
  );
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
  const portfolioPoints = usePortfolioPoints(
    phase === "playing" ? me : undefined,
    state?.round ?? 1,
    state?.seq
  );

  const placeOrder = () => {
    const p = parseFloat(price);
    if (!p || p <= 0) return setErr("Enter a limit price");
    send("place", { side, color: sel, qty, price: p });
    setPrice("");
  };

  // ---------- JOIN ----------
  if (phase === "join") {
    return (
      <LandingPage
        name={name}
        setName={setName}
        roomIn={roomIn}
        setRoomIn={setRoomIn}
        connected={connected}
        err={err}
        onCreate={() =>
          name.trim() ? send("create", { name: name.trim() }) : setErr("Enter a name")
        }
        onJoin={() =>
          name.trim() && roomIn.trim()
            ? send("join", { name: name.trim(), room: roomIn.trim() })
            : setErr("Name + room code required")
        }
      />
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
    const drawnCounts = state.drawnCounts ?? {};
    const pickedCounts = state.pickedCounts ?? {};
    const colorOrders = (state.orders ?? []).filter((o) => o.color === sel);
    const cash = me.cash ?? 0;
    const pnl = me.pnl ?? 0;
    const pnlRound = me.pnlRound ?? 0;

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
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Room</div>
              <code className="font-display text-sm font-bold tracking-widest text-emerald-400">{state.room}</code>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Players</div>
              <div className="font-display text-sm font-bold tabular-nums text-zinc-100">{state.players.length}</div>
            </div>
            {state.you === state.host && (
              <button className="rounded bg-rose-900/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-900/70" onClick={() => confirm("Call settlement now?") && send("end")}>
                End
              </button>
            )}
          </div>
        </TopBar>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_1fr_340px]">
          {/* LEFT: watchlist + positions */}
          <div className="flex min-h-0 flex-col border-r border-zinc-800">
            <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Watchlist
            </div>
            <div className="grid grid-cols-[1fr_2.5rem_2.5rem_4.5rem_3rem] items-center gap-x-1 border-b border-zinc-800/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-600">
              <span>Symbol</span>
              <span className="text-center" title="Times drawn from the bag">Out</span>
              <span className="text-center" title="Times picked up by players">Got</span>
              <span className="text-right">Price</span>
              <span className="text-right">Chg</span>
            </div>
            <div className="overflow-auto">
              {COLORS.map((c) => {
                const chg = (prices[c] ?? 100) - (prev[c] ?? 100);
                const drawn = drawnCounts[c] ?? 0;
                const picked = pickedCounts[c] ?? 0;
                return (
                  <button
                    key={c}
                    onClick={() => setSel(c)}
                    className={`grid w-full grid-cols-[1fr_2.5rem_2.5rem_4.5rem_3rem] items-center gap-x-1 px-3 py-2.5 text-left transition ${
                      sel === c ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Dot color={c} />
                      <span className="font-display text-sm text-zinc-100">{TICKER[c]}</span>
                    </span>
                    <span className="text-center font-display text-sm tabular-nums text-zinc-300">{drawn}</span>
                    <span className={`text-center font-display text-sm tabular-nums ${picked > 0 ? "text-emerald-400" : "text-zinc-600"}`}>
                      {picked}
                    </span>
                    <span className="text-right font-display text-sm tabular-nums text-zinc-100">{money(prices[c], 1)}</span>
                    <span className={`text-right text-xs tabular-nums ${chg >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {chg >= 0 ? "+" : ""}
                      {chg.toFixed(1)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-y border-zinc-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Positions
            </div>
            <div className="overflow-auto">
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
            <div className="mt-2 border-y border-zinc-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Open orders
            </div>
            <div className="grid grid-cols-[2.5rem_2rem_2rem_2rem_1.5rem_1fr] items-center gap-x-1 border-b border-zinc-800/60 px-3 py-1.5 text-[9px] uppercase tracking-wider text-zinc-600">
              <span>Sym</span>
              <span>Stat</span>
              <span>Side</span>
              <span>Type</span>
              <span className="text-center">Qty</span>
              <span className="text-right">Limit</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {(() => {
                const mine = (state.orders ?? []).filter((o) => o.ownerId === state.you);
                if (mine.length === 0) {
                  return <p className="px-3 py-2 text-sm text-zinc-600">None</p>;
                }
                return mine.map((o) => {
                  const c = o.color as Color;
                  const bid = o.side === "buy";
                  return (
                    <button
                      key={o.id}
                      onClick={() => setSel(c)}
                      className="grid w-full grid-cols-[2.5rem_2rem_2rem_2rem_1.5rem_1fr] items-center gap-x-1 px-3 py-2 text-left text-[11px] transition hover:bg-zinc-800/40"
                    >
                      <span className="flex items-center gap-1">
                        <Dot color={c} size={2} />
                        <span className="font-display text-zinc-200">{TICKER[c]}</span>
                      </span>
                      <span className="text-zinc-500">Open</span>
                      <span className={`font-semibold uppercase ${bid ? "text-emerald-400" : "text-rose-400"}`}>
                        {bid ? "Buy" : "Sell"}
                      </span>
                      <span className="text-zinc-500">Limit</span>
                      <span className="text-center font-display tabular-nums text-zinc-300">{o.qty}</span>
                      <span className="text-right font-display tabular-nums text-zinc-200">{money(o.price, 2)}</span>
                    </button>
                  );
                });
              })()}
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
            <div className="flex min-h-0 flex-1 border-b border-zinc-800">
              <div className="w-[30%] min-w-[180px] max-w-[240px] shrink-0 border-r border-zinc-800">
                <OrderLadder
                  ticker={TICKER[sel]}
                  marketPrice={prices[sel] ?? 100}
                  qty={qty}
                  orders={colorOrders.map((o) => ({
                    id: o.id,
                    ownerId: o.ownerId,
                    side: o.side,
                    qty: o.qty,
                    price: o.price,
                  }))}
                  you={state.you}
                  onPlace={(side, price) => send("place", { side, color: sel, qty, price })}
                  onFill={(orderId) => send("fill", { orderId })}
                  onCancel={(orderId) => send("cancel", { orderId })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <PriceChart
                  history={state.history ?? []}
                  round={state.round ?? 1}
                  livePrice={prices[sel] ?? 100}
                  color={sel}
                />
              </div>
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
                <p className="px-3 py-2 text-xs text-zinc-600">No activity yet.</p>
              ) : (
                feed.map((f) => <FeedRow key={f.seq} e={f} />)
              )}
            </div>
          </div>

          {/* RIGHT: account + ticket + order book + traders */}
          <div className="flex min-h-0 flex-col overflow-auto">
            <div className="border-b border-zinc-800">
              <PortfolioChart
                value={me.value ?? 0}
                points={portfolioPoints}
                currentRound={state.round ?? 1}
              />
              <div className="space-y-1 border-t border-zinc-800/60 px-4 pb-3 pt-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">Cash (bank credit)</span>
                  <span className={`font-display text-sm tabular-nums ${cash < 0 ? "text-rose-400" : "text-zinc-300"}`}>
                    {money(cash)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-zinc-500">PnL (vs $100)</span>
                  <span className={`font-display tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {pnl >= 0 ? "+" : ""}
                    {money(pnl)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-zinc-500">PnL (this round)</span>
                  <span className={`font-display tabular-nums ${pnlRound >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {pnlRound >= 0 ? "+" : ""}
                    {money(pnlRound)}
                  </span>
                </div>
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
          </div>
        </div>
      </div>
    );
  }

  return <Shell />;
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
