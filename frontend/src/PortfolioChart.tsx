import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Time,
} from "lightweight-charts";

export type PortfolioPoint = { index: number; round: number; value: number };

type Period = "1R" | "3R" | "ALL";

const PERIODS: { id: Period; label: string; caption: string }[] = [
  { id: "1R", label: "1R", caption: "This round" },
  { id: "3R", label: "3R", caption: "Past 3 rounds" },
  { id: "ALL", label: "All", caption: "All time" },
];

function indexToTime(i: number): Time {
  const d = new Date(Date.UTC(2024, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10) as Time;
}

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function filterPoints(points: PortfolioPoint[], period: Period, currentRound: number): PortfolioPoint[] {
  if (points.length === 0) return [{ index: 0, round: 0, value: 0 }];
  if (period === "ALL") return points;
  if (period === "1R") {
    const start = currentRound <= 1 ? 0 : currentRound - 1;
    const sliced = points.filter((p) => p.round >= start);
    return sliced.length >= 2 ? sliced : points.slice(-Math.max(2, points.length));
  }
  const startRound = Math.max(0, currentRound - 3);
  const sliced = points.filter((p) => p.round >= startRound);
  return sliced.length >= 2 ? sliced : points;
}

export function PortfolioChart({
  value,
  points,
  currentRound,
}: {
  value: number;
  points: PortfolioPoint[];
  currentRound: number;
}) {
  const [period, setPeriod] = useState<Period>("ALL");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const visible = useMemo(
    () => filterPoints(points, period, currentRound),
    [points, period, currentRound]
  );

  const startVal = visible[0]?.value ?? 0;
  const endVal = value;
  const change = endVal - startVal;
  const pct = startVal !== 0 ? (change / Math.abs(startVal)) * 100 : startVal === 0 && endVal !== 0 ? 100 : 0;
  const up = change >= 0;
  const caption = PERIODS.find((p) => p.id === period)?.caption ?? "";

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: "#71717a",
        fontFamily: "DM Sans, sans-serif",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { visible: false },
      timeScale: { visible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addLineSeries({
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    const data: LineData[] = visible.map((p) => ({
      time: indexToTime(p.index),
      value: p.value,
    }));
    if (data.length === 0 || data[data.length - 1].value !== endVal) {
      const nextIndex = (visible[visible.length - 1]?.index ?? 0) + 1;
      data.push({ time: indexToTime(nextIndex), value: endVal });
    }

    series.setData(data);
    series.applyOptions({
      color: up ? "#34d399" : "#f87171",
    });
    chart.timeScale().fitContent();
  }, [visible, endVal, up]);

  return (
    <div className="px-4 pb-3 pt-4">
      <div className="font-display text-3xl font-bold tabular-nums tracking-tight text-zinc-100">
        {money(endVal)}
      </div>
      <div className="mt-1 flex items-baseline gap-2 text-sm">
        <span className={`font-display tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
          {up ? "▲" : "▼"} {money(Math.abs(change))} ({Math.abs(pct).toFixed(2)}%)
        </span>
        <span className="text-zinc-500">{caption}</span>
      </div>
      <div ref={containerRef} className="mt-3 h-36 w-full" />
      <div className="mt-2 flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`rounded-md px-3 py-1 font-display text-xs font-semibold transition ${
              period === p.id
                ? "bg-emerald-400 text-zinc-950"
                : "text-emerald-400 hover:text-emerald-300"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
