"use client";
import { useState, useTransition } from "react";
import type { ActionState } from "@/lib/action-types";
import type { CsvMapping } from "@/lib/metrics";
import { FormMessage } from "./forms";

interface Preview {
  text: string;
  filename: string;
  headers: string[];
  sample: Record<string, string>[];
  rowCount: number;
  suggestion: CsvMapping;
  parseErrors: string[];
}

export function CsvImporter({
  preview,
  importCsv,
}: {
  preview: (p: ActionState, fd: FormData) => Promise<ActionState>;
  importCsv: (csv: string, filename: string, mapping: CsvMapping) => Promise<ActionState>;
}) {
  const [data, setData] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();

  const onFile = (fd: FormData) =>
    start(async () => {
      const r = await preview(null, fd);
      setState(r?.error ? r : null);
      if (r?.ok) {
        setData(r.data);
        setMapping(r.data.suggestion);
      }
    });

  const doImport = () =>
    start(async () => {
      if (!data || !mapping) return;
      const r = await importCsv(data.text, data.filename, mapping);
      setState(r);
      if (r?.ok) setData(null);
    });

  const col = (name: string, value: string | undefined, onChange: (v: string | undefined) => void, optional = true) => (
    <label className="text-sm">
      <span className="block font-medium text-slate-700">{name}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
        {optional && <option value="">— none —</option>}
        {data!.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      {!data && (
        <form action={onFile} className="flex flex-wrap items-center gap-3">
          <input type="file" name="file" accept=".csv,text/csv" required aria-label="CSV file" className="text-sm" />
          <button disabled={pending} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Reading…" : "Preview"}</button>
          <a href="/samples/clientwrap-sample.csv" className="text-xs text-indigo-600 underline" download>Download a sample CSV</a>
        </form>
      )}
      {data && mapping && (
        <div className="space-y-4 rounded-lg border border-slate-200 p-4">
          <p className="text-sm">
            <strong>{data.filename}</strong>: {data.rowCount} rows, columns: {data.headers.join(", ")}
          </p>
          {data.parseErrors.length > 0 && <p className="text-xs text-amber-700">{data.parseErrors.join(" · ")}</p>}
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={mapping.mode === "long"} onChange={() => setMapping({ mode: "long", metricColumn: data.headers[0], valueColumn: data.headers[1] })} />
              One row per value (metric, value columns)
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={mapping.mode === "wide"} onChange={() => setMapping({ mode: "wide", timestampColumn: data.headers[0], valueColumns: data.headers.slice(1) })} />
              One column per metric (spreadsheet style)
            </label>
          </div>
          {mapping.mode === "long" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {col("Metric column", mapping.metricColumn, (v) => setMapping({ ...mapping, metricColumn: v }), true)}
              {!mapping.metricColumn && (
                <label className="text-sm">
                  <span className="block font-medium text-slate-700">Metric name for every row</span>
                  <input value={mapping.fixedMetric ?? ""} onChange={(e) => setMapping({ ...mapping, fixedMetric: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
              )}
              {col("Value column", mapping.valueColumn, (v) => setMapping({ ...mapping, valueColumn: v ?? data.headers[0] }), false)}
              {col("Date column", mapping.timestampColumn, (v) => setMapping({ ...mapping, timestampColumn: v }))}
              {col("Unit column", mapping.unitColumn, (v) => setMapping({ ...mapping, unitColumn: v }))}
              {!mapping.unitColumn && (
                <label className="text-sm">
                  <span className="block font-medium text-slate-700">Unit for every row</span>
                  <input value={mapping.fixedUnit ?? ""} onChange={(e) => setMapping({ ...mapping, fixedUnit: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
              )}
              {col("Unique ID column (dedupe)", mapping.idempotencyColumn, (v) => setMapping({ ...mapping, idempotencyColumn: v }))}
            </div>
          ) : (
            <div className="space-y-3">
              {col("Date column", mapping.timestampColumn, (v) => setMapping({ ...mapping, timestampColumn: v ?? data.headers[0] }), false)}
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Metric columns to import</legend>
                <div className="mt-1 flex flex-wrap gap-3">
                  {data.headers.filter((h) => h !== mapping.timestampColumn).map((h) => (
                    <label key={h} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={mapping.valueColumns.includes(h)}
                        onChange={(e) => setMapping({ ...mapping, valueColumns: e.target.checked ? [...mapping.valueColumns, h] : mapping.valueColumns.filter((x) => x !== h) })}
                      />
                      {h}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>{data.headers.map((h) => <th key={h} className="border-b px-2 py-1 text-left">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.sample.map((r, i) => (
                  <tr key={i}>{data.headers.map((h) => <td key={h} className="border-b px-2 py-1">{r[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button onClick={doImport} disabled={pending} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{pending ? "Importing…" : `Import ${data.rowCount} rows`}</button>
            <button onClick={() => setData(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}
      <FormMessage state={state} />
      {state?.ok && state.data?.errors?.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Error report ({state.data.errors.length} shown)</p>
          <ul className="mt-2 max-h-48 list-disc overflow-auto pl-5 text-xs text-amber-900">
            {state.data.errors.map((e: any, i: number) => <li key={i}>Row {e.row}{e.column ? ` · ${e.column}` : ""}: {e.message}</li>)}
          </ul>
          {state.data.errorCsv && (
            <a className="mt-2 inline-block text-xs font-semibold text-amber-900 underline" download="clientwrap-import-errors.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(state.data.errorCsv)}`}>
              Download full error report (CSV)
            </a>
          )}
        </div>
      )}
    </div>
  );
}
