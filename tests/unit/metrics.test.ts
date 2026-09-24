import { describe, expect, it } from "vitest";
import { applyMapping, cleanEvent, errorReportCsv, parseCsv, parseNumber, parseTimestamp, suggestMapping, metricKey } from "@/lib/metrics";

describe("parsing", () => {
  it("parses messy numbers", () => {
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("$2,000")).toBe(2000);
    expect(parseNumber("12%")).toBe(12);
    expect(parseNumber("(50)")).toBe(-50);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
  it("parses timestamps", () => {
    expect(parseTimestamp("2026-08")?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(parseTimestamp("2026-08-15")?.toISOString().slice(0, 10)).toBe("2026-08-15");
    expect(parseTimestamp("25/08/2026")?.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(parseTimestamp(1756684800)?.toISOString().slice(0, 10)).toBe("2025-09-01");
    expect(parseTimestamp("not a date")).toBeNull();
  });
  it("normalizes metric keys", () => {
    expect(metricKey("  Organic Sessions ")).toBe("organic_sessions");
  });
  it("validates events", () => {
    const now = new Date("2026-09-24T00:00:00Z");
    expect(cleanEvent({ metric: "Leads", value: "12", unit: "leads", timestamp: "2026-09-01" }, now)).toMatchObject({ ok: true, event: { metric: "leads", value: 12 } });
    expect(cleanEvent({ value: 1 }, now).ok).toBe(false);
    expect(cleanEvent({ metric: "x", value: "ten" }, now).ok).toBe(false);
    expect(cleanEvent({ metric: "x", value: 1, timestamp: "2030-01-01" }, now).ok).toBe(false);
  });
});

describe("CSV import", () => {
  const long = `metric,value,unit,date\nLeads,10,leads,2026-08-01\nLeads,abc,leads,2026-08-02\nRevenue,"$1,200",USD,2026-08-03\n,5,,2026-08-04`;
  it("suggests a long-format mapping and reports per-row errors", () => {
    const parsed = parseCsv(long);
    const mapping = suggestMapping(parsed.headers);
    expect(mapping).toMatchObject({ mode: "long", metricColumn: "metric", valueColumn: "value", unitColumn: "unit", timestampColumn: "date" });
    const { events, errors } = applyMapping(parsed.rows, mapping, { fileKey: "f1", now: new Date("2026-09-24") });
    expect(events.map((e) => [e.metric, e.value])).toEqual([["leads", 10], ["revenue", 1200]]);
    expect(errors.map((e) => e.row)).toEqual([3, 5]);
    expect(errorReportCsv(errors)).toContain("row,column,error");
  });
  it("supports wide spreadsheets (date + one column per metric)", () => {
    const wide = `Month,Sessions,Leads,Notes\n2026-07,1000,20,\n2026-08,1200,,\nbad,1,2,`;
    const parsed = parseCsv(wide);
    const { events, errors } = applyMapping(parsed.rows, { mode: "wide", timestampColumn: "Month", valueColumns: ["Sessions", "Leads"] }, { now: new Date("2026-09-24") });
    expect(events).toHaveLength(3); // blank Leads cell for August is skipped
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(4);
  });
  it("gives stable idempotency keys so re-importing the same file is a no-op", () => {
    const parsed = parseCsv(long);
    const a = applyMapping(parsed.rows, suggestMapping(parsed.headers), { fileKey: "same", now: new Date("2026-09-24") });
    const b = applyMapping(parsed.rows, suggestMapping(parsed.headers), { fileKey: "same", now: new Date("2026-09-24") });
    expect(a.events.map((e) => e.idempotencyKey)).toEqual(b.events.map((e) => e.idempotencyKey));
  });
});
