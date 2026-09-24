import { describe, expect, it } from "vitest";
import { buildSnapshotFromEvents, changePct, classifyTrend, templateNarrative, fmtValue } from "@/lib/reports";

const events = [
  { metric: "leads", value: 10, unit: "leads", occurred_at: "2026-07-05T00:00:00Z" },
  { metric: "leads", value: 10, unit: "leads", occurred_at: "2026-07-20T00:00:00Z" },
  { metric: "leads", value: 30, unit: "leads", occurred_at: "2026-08-10T00:00:00Z" },
  { metric: "rank", value: 9, unit: "", occurred_at: "2026-07-31T00:00:00Z" },
  { metric: "rank", value: 5, unit: "", occurred_at: "2026-08-01T00:00:00Z" },
  { metric: "rank", value: 4, unit: "", occurred_at: "2026-08-30T00:00:00Z" },
  { metric: "leads", value: 999, unit: "leads", occurred_at: "2026-09-01T00:00:00Z" },
];

describe("report snapshot", () => {
  const snap = buildSnapshotFromEvents("2026-08", events, {
    leads: { label: "Leads", agg: "sum", better: "up" },
    rank: { label: "Avg. position", agg: "last", better: "down" },
    unused: { label: "Unused" },
  });
  it("aggregates the period and compares with last month", () => {
    const leads = snap.metrics.find((m) => m.key === "leads")!;
    expect(leads).toMatchObject({ value: 30, previous: 20, trend: "improved" });
    expect(leads.changePct).toBeCloseTo(50);
    const rank = snap.metrics.find((m) => m.key === "rank")!;
    expect(rank).toMatchObject({ value: 4, previous: 9, trend: "improved" }); // lower is better
    expect(snap.metrics[snap.metrics.length - 1].key).toBe("unused");
    expect(snap.periodLabel).toBe("August 2026");
    expect(leads.history).toHaveLength(6);
  });
  it("change and trend helpers", () => {
    expect(changePct(10, 0)).toBeNull();
    expect(changePct(0, 0)).toBe(0);
    expect(classifyTrend(null, 1, "up")).toBe("no_data");
    expect(classifyTrend(5, null, "up")).toBe("new");
    expect(classifyTrend(100, 100.5, "up")).toBe("flat");
    expect(classifyTrend(90, 100, "down")).toBe("improved");
  });
  it("template narrative never invents numbers", () => {
    const n = templateNarrative("Acme", snap);
    expect(n.narrative).toContain("August 2026");
    expect(n.narrative).toContain("30 leads");
    expect(n.nextStep.length).toBeGreaterThan(10);
  });
  it("formats units", () => {
    expect(fmtValue({ value: 1200, unit: "USD" })).toBe("$1,200");
    expect(fmtValue({ value: 12.5, unit: "%" })).toBe("12.5%");
    expect(fmtValue({ value: null, unit: "x" })).toBe("—");
  });
});
