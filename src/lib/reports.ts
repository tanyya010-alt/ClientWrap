import type { Q, Row } from "./db";
import { formatNumber, periodBounds, periodLabel, previousPeriod } from "./time";
import { titleCase } from "./metrics";
import { generateText } from "./ai";
import { orderedMetrics } from "./templates";

export interface MetricSnapshot {
  key: string;
  label: string;
  unit: string;
  agg: "sum" | "last" | "avg";
  better: "up" | "down";
  value: number | null;
  previous: number | null;
  changePct: number | null;
  trend: "improved" | "declined" | "flat" | "new" | "no_data";
  history: { period: string; value: number | null }[];
}

export interface ReportSnapshot {
  period: string;
  previousPeriod: string;
  periodLabel: string;
  metrics: MetricSnapshot[];
  eventCount: number;
  generatedAt: string;
}

export function aggregate(values: { value: number; occurred_at: Date | string }[], agg: "sum" | "last" | "avg"): number | null {
  if (values.length === 0) return null;
  if (agg === "sum") return values.reduce((s, v) => s + Number(v.value), 0);
  if (agg === "avg") return values.reduce((s, v) => s + Number(v.value), 0) / values.length;
  const sorted = [...values].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  return Number(sorted[sorted.length - 1].value);
}

export function changePct(value: number | null, previous: number | null): number | null {
  if (value === null || previous === null) return null;
  if (previous === 0) return value === 0 ? 0 : null;
  return ((value - previous) / Math.abs(previous)) * 100;
}

export function classifyTrend(value: number | null, previous: number | null, better: "up" | "down"): MetricSnapshot["trend"] {
  if (value === null) return "no_data";
  if (previous === null) return "new";
  const pct = changePct(value, previous);
  if (value === previous || (pct !== null && Math.abs(pct) < 1)) return "flat";
  const up = value > previous;
  return up === (better === "up") ? "improved" : "declined";
}

/** Pure: builds a snapshot from raw events (exported for unit tests). */
export function buildSnapshotFromEvents(
  period: string,
  events: { metric: string; value: number; unit: string; occurred_at: Date | string }[],
  metricConfig: Record<string, { label?: string; unit?: string; agg?: "sum" | "last" | "avg"; better?: "up" | "down"; hidden?: boolean; position?: number }>,
  historyMonths = 6,
): ReportSnapshot {
  const periods: string[] = [period];
  for (let i = 1; i < historyMonths; i++) periods.unshift(previousPeriod(periods[0]));
  const prev = previousPeriod(period);
  const byMetric = new Map<string, typeof events>();
  for (const e of events) {
    const list = byMetric.get(e.metric) ?? [];
    list.push(e);
    byMetric.set(e.metric, list);
  }
  const keys = new Set<string>([...Object.keys(metricConfig).filter((k) => !metricConfig[k]?.hidden), ...byMetric.keys()]);
  const metrics: MetricSnapshot[] = [];
  let eventCount = 0;
  for (const key of keys) {
    if (metricConfig[key]?.hidden) continue;
    const cfg = metricConfig[key] ?? {};
    const agg = cfg.agg ?? "sum";
    const better = cfg.better ?? "up";
    const list = byMetric.get(key) ?? [];
    const inPeriod = (p: string) => {
      const { start, end } = periodBounds(p);
      return list.filter((e) => {
        const t = new Date(e.occurred_at).getTime();
        return t >= start.getTime() && t < end.getTime();
      });
    };
    const cur = inPeriod(period);
    eventCount += cur.length;
    const value = aggregate(cur, agg);
    const previous = aggregate(inPeriod(prev), agg);
    const unit = cfg.unit ?? list.find((e) => e.unit)?.unit ?? "";
    metrics.push({
      key,
      label: cfg.label ?? titleCase(key),
      unit,
      agg,
      better,
      value,
      previous,
      changePct: changePct(value, previous),
      trend: classifyTrend(value, previous, better),
      history: periods.map((p) => ({ period: p, value: aggregate(inPeriod(p), agg) })),
    });
  }
  // Metrics with data first, then by config order.
  const order = orderedMetrics(metricConfig).map(([k]) => k);
  metrics.sort((a, b) => {
    const da = a.value === null ? 1 : 0;
    const db = b.value === null ? 1 : 0;
    if (da !== db) return da - db;
    const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  return {
    period,
    previousPeriod: prev,
    periodLabel: periodLabel(period),
    metrics,
    eventCount,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildSnapshot(q: Q, client: Row, period: string): Promise<ReportSnapshot> {
  const { end } = periodBounds(period);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 6);
  const events = await q.many<{ metric: string; value: number; unit: string; occurred_at: Date }>(
    `select metric, value::float8 as value, unit, occurred_at from metric_events
     where client_id = $1 and occurred_at >= $2 and occurred_at < $3`,
    [client.id, start, end],
  );
  return buildSnapshotFromEvents(period, events, client.metric_config ?? {});
}

export function fmtValue(m: { value: number | null; unit: string }): string {
  if (m.value === null) return "—";
  const u = m.unit;
  if (u === "USD" || u === "$") return `$${formatNumber(m.value)}`;
  if (u === "EUR") return `€${formatNumber(m.value)}`;
  if (u === "GBP") return `£${formatNumber(m.value)}`;
  if (u === "%") return `${formatNumber(m.value)}%`;
  if (u.startsWith("/")) return `${formatNumber(m.value)}${u}`;
  return u ? `${formatNumber(m.value)} ${u}` : formatNumber(m.value);
}

export function fmtChange(pct: number | null): string {
  if (pct === null) return "new";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
}

/** Deterministic narrative used when no AI key is configured (or the AI call fails). */
export function templateNarrative(clientName: string, snap: ReportSnapshot): { narrative: string; nextStep: string } {
  const withData = snap.metrics.filter((m) => m.value !== null);
  if (withData.length === 0) {
    return {
      narrative: `No results were recorded for ${snap.periodLabel} yet. Once data comes in, this summary will highlight what changed.`,
      nextStep: "Agree on the two or three numbers that matter most so next month's wrap tells a clear story.",
    };
  }
  const improved = withData.filter((m) => m.trend === "improved").sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
  const declined = withData.filter((m) => m.trend === "declined").sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
  const flat = withData.filter((m) => m.trend === "flat");
  const lines: string[] = [];
  const headline = withData[0];
  lines.push(
    `In ${snap.periodLabel}, ${headline.label.toLowerCase()} came in at ${fmtValue(headline)}` +
      (headline.previous !== null ? ` (${fmtChange(headline.changePct)} vs. last month).` : "."),
  );
  if (improved.length) {
    lines.push(
      `Wins: ${improved
        .slice(0, 3)
        .map((m) => `${m.label.toLowerCase()} ${m.changePct !== null ? fmtChange(m.changePct) : "improved"} to ${fmtValue(m)}`)
        .join(", ")}.`,
    );
  }
  if (declined.length) {
    lines.push(
      `Needs attention: ${declined
        .slice(0, 2)
        .map((m) => `${m.label.toLowerCase()} moved ${fmtChange(m.changePct)} to ${fmtValue(m)}`)
        .join(", ")}.`,
    );
  }
  if (flat.length && !improved.length && !declined.length) lines.push("Results held steady compared with last month.");
  const nextStep = declined.length
    ? `Focus next month on ${declined[0].label.toLowerCase()}: we'll review what changed and propose one concrete fix in our next check-in.`
    : improved.length
      ? `Build on the momentum in ${improved[0].label.toLowerCase()}: next month we'll double down on what worked and set a stretch target together.`
      : `Let's pick one metric to push next month and agree on a target in our next check-in.`;
  return { narrative: lines.join(" "), nextStep };
}

const REPORT_SYSTEM = `You write the monthly results summary that a freelancer or small agency sends to their client.
Rules: plain, warm, professional English; 90-160 words; no headings or bullet symbols; never invent numbers that are not in the data;
mention the most important wins and anything that declined honestly; do not use hype words. Output exactly two sections separated by a line containing only ---:
first the summary paragraph(s), then a single-sentence "next step" recommendation for the coming month.`;

export async function generateNarrative(ws: Row, client: Row, snap: ReportSnapshot): Promise<{ narrative: string; nextStep: string; ai: boolean }> {
  const fallback = templateNarrative(client.name, snap);
  const data = snap.metrics
    .filter((m) => m.value !== null || m.previous !== null)
    .map((m) => `- ${m.label}: ${fmtValue(m)} (previous month: ${fmtValue({ value: m.previous, unit: m.unit })}; change: ${fmtChange(m.changePct)}; higher is ${m.better === "up" ? "better" : "worse"})`)
    .join("\n");
  if (!data) return { ...fallback, ai: false };
  const prompt = `Client: ${client.name}\nService: ${client.service_description ?? ws.service_type}\nPeriod: ${snap.periodLabel}\nResults:\n${data}`;
  const text = await generateText(ws, REPORT_SYSTEM, prompt, 800);
  if (!text) return { ...fallback, ai: false };
  const [narrative, nextStep] = text.split(/\n-{3,}\n/);
  return { narrative: narrative.trim(), nextStep: (nextStep ?? fallback.nextStep).trim(), ai: true };
}
