import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type AreaData,
  type Time,
} from "lightweight-charts";

export type HistoryPoint = { round: number; prices: Record<string, number> };

function roundToTime(round: number): Time {
  const d = new Date(Date.UTC(2024, 0, 1));
  d.setUTCDate(d.getUTCDate() + round);
  return d.toISOString().slice(0, 10) as Time;
}

export function PriceChart({
  history,
  round,
  livePrice,
  color,
}: {
  history: HistoryPoint[];
  round: number;
  livePrice: number;
  color: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

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
        vertLines: { color: "rgba(63,63,70,0.25)" },
        horzLines: { color: "rgba(63,63,70,0.25)" },
      },
      rightPriceScale: { borderColor: "#27272a" },
      timeScale: { borderColor: "#27272a", fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 },
    });
    const series = chart.addAreaSeries({ lineWidth: 2, priceLineVisible: false });
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

    const pts: HistoryPoint[] = [...history];
    const lastRound = pts.length ? pts[pts.length - 1].round : -1;
    if (round > lastRound) {
      pts.push({ round, prices: { [color]: livePrice } });
    }

    const data: AreaData[] = pts.map((p) => ({
      time: roundToTime(p.round),
      value: Math.round((p.prices[color] ?? 0) * 100) / 100,
    }));
    series.setData(data);

    const first = data[0]?.value ?? 100;
    const last = data[data.length - 1]?.value ?? 100;
    const up = last >= first;
    const line = up ? "#10b981" : "#ef4444";
    series.applyOptions({
      lineColor: line,
      topColor: up ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)",
      bottomColor: up ? "rgba(16,185,129,0.0)" : "rgba(239,68,68,0.0)",
    });
    chart.timeScale().fitContent();
  }, [history, round, livePrice, color]);

  return <div ref={containerRef} className="h-full w-full" />;
}
