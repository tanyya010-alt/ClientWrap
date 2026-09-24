import Papa from "papaparse";
import { z } from "zod";
import type { Q } from "./db";

export function metricKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s$€£¥%,]/g, "").replace(/^(USD|EUR|GBP)/i, "");
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function parseTimestamp(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" || (typeof v === "string" && /^\d{9,13}$/.test(v.trim()))) {
    const n = Number(v);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  // YYYY-MM -> first of month
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00Z`);
  // DD/MM/YYYY or MM/DD/YYYY: ambiguous; accept only when unambiguous or US-style when both <= 12
  const m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    const [month, day] = a > 12 ? [b, a] : [a, b];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(Date.UTC(y, month - 1, day, 12));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const metricEventSchema = z.object({
  metric: z.string().trim().min(1, "metric is required").max(64, "metric must be at most 64 characters"),
  value: z.union([z.number(), z.string()]),
  unit: z.string().trim().max(24, "unit must be at most 24 characters").optional().default(""),
  timestamp: z.union([z.string(), z.number()]).optional(),
  idempotency_key: z.string().trim().max(200).optional(),
});

export interface CleanEvent {
  metric: string;
  label: string;
  value: number;
  unit: string;
  occurredAt: Date;
  idempotencyKey: string | null;
}

export function cleanEvent(raw: unknown, now = new Date()): { ok: true; event: CleanEvent } | { ok: false; error: string } {
  const parsed = metricEventSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
  const value = parseNumber(parsed.data.value);
  if (value === null) return { ok: false, error: `value: "${parsed.data.value}" is not a number` };
  let occurredAt = now;
  if (parsed.data.timestamp !== undefined && parsed.data.timestamp !== "") {
    const d = parseTimestamp(parsed.data.timestamp);
    if (!d) return { ok: false, error: `timestamp: "${parsed.data.timestamp}" is not a valid date` };
    occurredAt = d;
  }
  if (occurredAt.getTime() > now.getTime() + 2 * 86400_000) return { ok: false, error: "timestamp: is more than 2 days in the future" };
  if (occurredAt.getFullYear() < 2000) return { ok: false, error: "timestamp: is before the year 2000" };
  const key = metricKey(parsed.data.metric);
  if (!key) return { ok: false, error: "metric: must contain letters or numbers" };
  return {
    ok: true,
    event: {
      metric: key,
      label: parsed.data.metric.trim(),
      value,
      unit: parsed.data.unit ?? "",
      occurredAt,
      idempotencyKey: parsed.data.idempotency_key || null,
    },
  };
}

/** Inserts events; duplicates (same idempotency key for the client) are ignored. */
export async function insertEvents(
  q: Q,
  workspaceId: string,
  clientId: string,
  events: CleanEvent[],
  source: "manual" | "csv" | "webhook" | "demo",
): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  for (const e of events) {
    const n = await q.exec(
      `insert into metric_events (workspace_id, client_id, metric, value, unit, occurred_at, source, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (client_id, idempotency_key) where idempotency_key is not null do nothing`,
      [workspaceId, clientId, e.metric, e.value, e.unit, e.occurredAt, source, e.idempotencyKey],
    );
    inserted += n;
  }
  // Register unknown metrics in the client's metric config so they show up in reports with a label.
  const newMetrics = new Map<string, CleanEvent>();
  for (const e of events) newMetrics.set(e.metric, e);
  if (newMetrics.size > 0) {
    const client = await q.one<{ metric_config: Record<string, any> }>("select metric_config from clients where id = $1", [clientId]);
    const cfg = { ...(client.metric_config ?? {}) };
    let changed = false;
    for (const [k, e] of newMetrics) {
      if (!cfg[k]) {
        cfg[k] = { label: e.label.length > 1 && e.label !== k ? e.label : titleCase(k), unit: e.unit, agg: "sum", better: "up" };
        changed = true;
      }
    }
    if (changed) await q.exec("update clients set metric_config = $2 where id = $1", [clientId, JSON.stringify(cfg)]);
  }
  return { inserted, duplicates: events.length - inserted };
}

export function titleCase(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ------------------------------------------------------------------ CSV import

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  parseErrors: string[];
}

export function parseCsv(text: string): CsvParseResult {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return {
    headers: (res.meta.fields ?? []).filter(Boolean),
    rows: res.data,
    parseErrors: res.errors.slice(0, 20).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`),
  };
}

export type CsvMapping =
  | {
      mode: "long";
      metricColumn?: string;
      fixedMetric?: string;
      valueColumn: string;
      unitColumn?: string;
      fixedUnit?: string;
      timestampColumn?: string;
      idempotencyColumn?: string;
    }
  | {
      mode: "wide";
      timestampColumn: string;
      valueColumns: string[];
      units?: Record<string, string>;
    };

export interface CsvRowError {
  row: number; // 1-based spreadsheet row (header = row 1)
  column?: string;
  message: string;
}

/** Suggests a mapping from headers (used to pre-fill the column-mapping UI). */
export function suggestMapping(headers: string[]): CsvMapping {
  const find = (...names: string[]) => headers.find((h) => names.includes(h.toLowerCase().trim()));
  const metric = find("metric", "name", "kpi", "measure");
  const value = find("value", "amount", "count", "total");
  const ts = find("timestamp", "date", "month", "period", "occurred_at", "day", "time");
  if (metric && value) {
    return {
      mode: "long",
      metricColumn: metric,
      valueColumn: value,
      unitColumn: find("unit", "units"),
      timestampColumn: ts,
      idempotencyColumn: find("id", "idempotency_key", "event_id"),
    };
  }
  return {
    mode: "wide",
    timestampColumn: ts ?? headers[0],
    valueColumns: headers.filter((h) => h !== (ts ?? headers[0])),
  };
}

export function applyMapping(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  opts: { now?: Date; fileKey?: string } = {},
): { events: CleanEvent[]; errors: CsvRowError[] } {
  const events: CleanEvent[] = [];
  const errors: CsvRowError[] = [];
  const now = opts.now ?? new Date();
  rows.forEach((row, i) => {
    const rowNo = i + 2;
    if (mapping.mode === "long") {
      const metric = mapping.metricColumn ? row[mapping.metricColumn] : mapping.fixedMetric;
      const unit = mapping.unitColumn ? row[mapping.unitColumn] : mapping.fixedUnit;
      const timestamp = mapping.timestampColumn ? row[mapping.timestampColumn] : undefined;
      const idem = mapping.idempotencyColumn ? row[mapping.idempotencyColumn] : undefined;
      const r = cleanEvent(
        {
          metric: metric ?? "",
          value: row[mapping.valueColumn] ?? "",
          unit: unit ?? "",
          timestamp,
          idempotency_key: idem ? `csv:${idem}` : `csv:${opts.fileKey ?? "file"}:${rowNo}`,
        },
        now,
      );
      if (r.ok) events.push(r.event);
      else errors.push({ row: rowNo, message: r.error });
    } else {
      const timestamp = row[mapping.timestampColumn];
      if (!timestamp || !parseTimestamp(timestamp)) {
        errors.push({ row: rowNo, column: mapping.timestampColumn, message: `"${timestamp ?? ""}" is not a valid date` });
        return;
      }
      for (const col of mapping.valueColumns) {
        const raw = row[col];
        if (raw === undefined || String(raw).trim() === "") continue; // blank cells are skipped, not errors
        const r = cleanEvent(
          {
            metric: col,
            value: raw,
            unit: mapping.units?.[col] ?? "",
            timestamp,
            idempotency_key: `csv:${metricKey(col)}:${parseTimestamp(timestamp)!.toISOString().slice(0, 10)}`,
          },
          now,
        );
        if (r.ok) events.push(r.event);
        else errors.push({ row: rowNo, column: col, message: r.error });
      }
    }
  });
  return { events, errors };
}

export function errorReportCsv(errors: CsvRowError[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ["row,column,error", ...errors.map((e) => [e.row, esc(e.column ?? ""), esc(e.message)].join(","))].join("\n");
}
