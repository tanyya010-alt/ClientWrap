export function UsageMeter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max <= 0 ? (used > 0 ? 100 : 0) : Math.min(100, Math.round((used / max) * 100));
  const color = pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-indigo-500";
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="font-medium tabular-nums text-slate-900">
          {used.toLocaleString()} / {max <= 0 ? "not included" : max.toLocaleString()}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
