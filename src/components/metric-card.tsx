import type { MetricSnapshot } from "@/lib/reports";
import { fmtChange, fmtValue } from "@/lib/reports";

export function Sparkline({ values, color = "#4f46e5" }: { values: (number | null)[]; color?: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null) as { v: number; i: number }[];
  if (pts.length < 2) return <div className="h-8" />;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const w = 100, h = 28;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => (max === min ? h / 2 : h - ((v - min) / (max - min)) * (h - 4) - 2);
  const d = pts.map((p, idx) => `${idx === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function MetricCard({ m, color }: { m: MetricSnapshot; color?: string }) {
  const tone = m.trend === "improved" ? "text-emerald-700 bg-emerald-50" : m.trend === "declined" ? "text-rose-700 bg-rose-50" : "text-slate-600 bg-slate-100";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">{m.label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p className="text-2xl font-bold tabular-nums text-slate-900">{fmtValue(m)}</p>
        {m.value !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{fmtChange(m.changePct)}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">Last month: {fmtValue({ value: m.previous, unit: m.unit })}</p>
      <div className="mt-2">
        <Sparkline values={m.history.map((h) => h.value)} color={color} />
      </div>
    </div>
  );
}
