import { useEffect, useState, type ReactNode } from "react";
import landingImg from "../asset/landing.png";
import { InlineMath } from "./InlineMath";

const CANDY = [
  { color: "bg-red-500", label: "RED" },
  { color: "bg-green-500", label: "GRN" },
  { color: "bg-blue-500", label: "BLU" },
  { color: "bg-yellow-400", label: "YEL" },
  { color: "bg-[#4a3728]", label: "BRN" },
  { color: "bg-orange-500", label: "ORG" },
] as const;

type ModalId = "rules" | "faq" | "how";

type ModalSection = { heading?: string; items: ReactNode[] };

type ModalContent = { title: string; sections: ModalSection[] };

const MODALS: Record<ModalId, ModalContent> = {
  how: {
    title: "How to play",
    sections: [
      {
        heading: "Get in",
        items: [
          "Open a room or join with a 5-letter code. You need at least 2 players.",
          "The host starts the market when everyone's ready.",
        ],
      },
      {
        heading: "Your turn — draw from the bag",
        items: [
          "Players take turns. On your turn, pick exactly 3 colors (duplicates OK).",
          "The game draws 3 M&Ms from the communal bag — weighted by what's left.",
          "You win min(your guess, draw) for each color. Won candy goes to your inventory and leaves the bag.",
        ],
      },
      {
        heading: "Trade between draws",
        items: [
          "Six colors trade like tickers: RED, GRN, BLU, YEL, BRN, ORG.",
          "Post limit bids (buy) or asks (sell) on the order ladder or ticket.",
          "Crossing orders auto-match: best price first, partial fills OK, leftovers rest on the book.",
          "Click a ladder row to buy/sell at that price, fill someone else's order, or cancel yours.",
        ],
      },
      {
        heading: "Win",
        items: [
          "The game ends when the bag drops below 3 M&Ms (or the host calls settlement).",
          "True candy values are revealed — rarer colors from the starting mix are worth more.",
          "Highest portfolio value at settlement wins. Trade smart, draw luckier.",
        ],
      },
    ],
  },
  rules: {
    title: "Rules",
    sections: [
      {
        heading: "Setup",
        items: [
          "2+ players. Everyone starts with $0 cash and no candy.",
          "The bag holds a random mix (3–15 per color). The mix is hidden during play — only total M&Ms remaining is shown.",
          "All six colors quote at $100 until the first trade prints a new price.",
        ],
      },
      {
        heading: "Draws",
        items: [
          "Each player draws once per round, in turn order.",
          "Submit exactly 3 color guesses, then 3 M&Ms are drawn from the bag.",
          <>
            For each color: you receive{" "}
            <InlineMath math="\min(\text{guess},\, \text{drawn})" />. Unmatched draws stay in the bag
            (already removed from pool count).
          </>,
        ],
      },
      {
        heading: "Trading",
        items: [
          "Limit orders only. Buys may send your cash negative — the bank has your back.",
          "Sells require inventory; posting an ask reserves those M&Ms until filled or cancelled.",
          "Matching is price-time priority. Incoming orders sweep the book; unfilled quantity rests.",
          "You cannot match against your own orders. Last trade price becomes the market quote.",
        ],
      },
      {
        heading: "Scoring",
        items: [
          <>
            Portfolio = <InlineMath math="\text{cash} + \text{candy} \times \text{quote}" /> (including
            reserved inventory on open asks).
          </>,
          "Total PnL tracks net worth vs. a $100 par baseline for every M&M you've won from draws.",
          "Round PnL resets its baseline at each round boundary.",
          <>
            Settlement value per color:{" "}
            <InlineMath math="\dfrac{\text{starting count}}{\text{total starting M\&Ms}} \times \$600" />.
            Final score = <InlineMath math="\text{cash} + \text{candy at true prices}" />.
          </>,
        ],
      },
    ],
  },
  faq: {
    title: "FAQ",
    sections: [
      {
        items: [
          "Can I go negative cash? Yes. Buys borrow from the bank. You still owe the money at settlement.",
          "Why can't I sell? You need the candy in hand. Open sell orders lock inventory until filled or cancelled.",
          "Why did my order only partially fill? The book matched what it could at your limit; the rest stays live.",
          "What sets the price? The last executed trade per color. No trades = $100 default.",
          "Do I know how many of each color are in the bag? No — only the total count. That's the whole game.",
          "What happens to open orders at settlement? The book clears; reserved sell inventory is returned to holders.",
          "Does draw order matter? Yes — turn order is fixed. Watch who's drawing and what's left in the bag.",
          "Is brown the rarest? Not necessarily. The starting mix is random every game.",
        ],
      },
    ],
  },
};

type Props = {
  name: string;
  setName: (v: string) => void;
  roomIn: string;
  setRoomIn: (v: string) => void;
  connected: boolean;
  err: string | null;
  onCreate: () => void;
  onJoin: () => void;
};

function InfoModal({
  title,
  sections,
  onClose,
}: {
  title: string;
  sections: ModalSection[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          ×
        </button>

        <div className="border-b border-zinc-800 px-6 py-5 pr-12">
          <h2 id="modal-title" className="font-display text-lg font-bold text-zinc-100">
            {title}
          </h2>
        </div>

        <div className="overflow-y-auto px-6 py-4">
          {sections.map((section, i) => (
            <section key={i} className={i > 0 ? "mt-5 border-t border-zinc-800/60 pt-5" : ""}>
              {section.heading && (
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-500">
                  {section.heading}
                </h3>
              )}
              <ul className="space-y-2.5">
                {section.items.map((item, j) => (
                  <li key={j} className="flex gap-2 text-sm leading-relaxed text-zinc-400">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="border-t border-zinc-800 px-6 py-4">
          <button type="button" className="btn-ghost w-full" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function LandingPage({
  name,
  setName,
  roomIn,
  setRoomIn,
  connected,
  err,
  onCreate,
  onJoin,
}: Props) {
  const [modal, setModal] = useState<ModalId | null>(null);
  const open = modal ? MODALS[modal] : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0d0a] text-zinc-200 lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* Hero — full viewport height */}
      <div className="relative flex h-[100svh] shrink-0 items-center justify-center overflow-hidden lg:h-screen lg:w-[48%] xl:w-[50%]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_40%_50%,rgba(16,185,129,0.14),transparent_55%)]" />
        <img
          src={landingImg}
          alt="M&M trader"
          className="relative h-[100svh] w-auto max-w-none object-contain lg:h-screen"
        />
      </div>

      {/* Copy + join */}
      <div className="flex flex-1 flex-col justify-center overflow-y-auto px-6 py-10 lg:px-12 lg:py-12 xl:px-16">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-5 flex items-center gap-2">
            {CANDY.map((c) => (
              <span
                key={c.label}
                className={`h-2 w-2 rounded-full ${c.color} opacity-80`}
                title={c.label}
              />
            ))}
          </div>

          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-zinc-50 sm:text-5xl">
            <span className="text-emerald-400">M&amp;M</span>
            <br />
            Trading Game
          </h1>

          <p className="mt-4 text-lg font-semibold leading-snug text-zinc-300 sm:text-xl">
          It's not gambling if I call it price discovery.{" "}
            <span className="text-emerald-400">Bag holding, literally.</span>
          </p>

          <div className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-xl shadow-black/20 backdrop-blur-sm">
            <label className="block text-xs uppercase tracking-wider text-zinc-500">
              Trader name
              <input
                className="input mt-1.5"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. DeepValueDegenerate"
                onKeyDown={(e) => e.key === "Enter" && onCreate()}
              />
            </label>

            <button
              type="button"
              className="btn-buy mt-4 w-full"
              disabled={!connected}
              onClick={onCreate}
            >
              Open new room
            </button>

            <div className="divider">or join</div>

            <label className="block text-xs uppercase tracking-wider text-zinc-500">
              Room code
              <input
                className="input mt-1.5 text-center font-display text-lg uppercase tracking-[0.3em]"
                value={roomIn}
                maxLength={5}
                onChange={(e) => setRoomIn(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && onJoin()}
              />
            </label>

            <button type="button" className="btn-ghost mt-3 w-full" disabled={!connected} onClick={onJoin}>
              Join room
            </button>

            {err && <p className="mt-3 text-sm text-rose-400">{err}</p>}

            <p className="mt-4 text-center text-[11px] text-zinc-600">
              {connected ? (
                <span>
                  <span className="text-emerald-500">●</span> connected
                </span>
              ) : (
                "connecting…"
              )}
            </p>
          </div>

          <nav className="mt-8 flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-sm text-zinc-500">
            {(
              [
                ["rules", "Rules"],
                ["how", "How to play"],
                ["faq", "FAQ"],
              ] as const
            ).map(([id, label], i, arr) => (
              <span key={id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => setModal(id)}
                  className="text-zinc-400 underline decoration-zinc-700 underline-offset-2 transition hover:text-emerald-400 hover:decoration-emerald-600"
                >
                  {label}
                </button>
                {i < arr.length - 1 && <span className="mx-2 text-zinc-700">·</span>}
              </span>
            ))}
          </nav>
        </div>
      </div>

      {open && (
        <InfoModal title={open.title} sections={open.sections} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
