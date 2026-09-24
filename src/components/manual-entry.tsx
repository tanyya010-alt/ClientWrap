"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "./forms";
import type { ActionState } from "@/lib/action-types";

export function ManualEntry({
  action,
  metrics,
  defaultDate,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  metrics: { key: string; label: string; unit: string }[];
  defaultDate: string;
}) {
  const [rows, setRows] = useState(metrics.length ? metrics.map((m) => ({ metric: m.label, unit: m.unit })) : [{ metric: "", unit: "" }]);
  return (
    <ActionForm action={action} resetOnSuccess>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-700">
          Date
          <input type="date" name="date" defaultValue={defaultDate} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
        </label>
        <p className="pb-2 text-xs text-slate-500">Use any day in the month the numbers belong to. Leave a value blank to skip it.</p>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input name="metric" defaultValue={r.metric} placeholder="Metric (e.g. Leads)" aria-label="Metric" className="col-span-5 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="value" inputMode="decimal" placeholder="Value" aria-label={`Value for ${r.metric || "metric"}`} className="col-span-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input name="unit" defaultValue={r.unit} placeholder="Unit" aria-label="Unit" className="col-span-3 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setRows([...rows, { metric: "", unit: "" }])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          + Add metric
        </button>
        <SubmitButton>Save values</SubmitButton>
      </div>
    </ActionForm>
  );
}
