"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "./forms";
import type { ActionState } from "@/lib/action-types";

interface Item {
  description: string;
  quantity: number;
  unitAmount: number;
}

export function InvoiceEditor({
  action,
  clients,
  currencies,
  initial,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  clients: { id: string; name: string; fee: number | null }[];
  currencies: string[];
  initial: { clientId: string; currency: string; issueDate: string; dueDate: string; notes: string; items: Item[] };
}) {
  const [items, setItems] = useState<Item[]>(initial.items);
  const [currency, setCurrency] = useState(initial.currency);
  const total = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitAmount) || 0), 0);
  const set = (idx: number, patch: Partial<Item>) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
    } catch {
      return n.toFixed(2);
    }
  };
  return (
    <ActionForm action={action}>
      <input type="hidden" name="items" value={JSON.stringify(items.map((i) => ({ ...i, quantity: Number(i.quantity), unitAmount: Number(i.unitAmount) })))} />
      <div className="grid gap-4 sm:grid-cols-4">
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">
          Client
          <select name="client_id" defaultValue={initial.clientId} required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Choose…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Currency
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {currencies.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <div />
        <label className="text-sm font-medium text-slate-700">
          Issue date
          <input type="date" name="issue_date" defaultValue={initial.issueDate} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Due date
          <input type="date" name="due_date" defaultValue={initial.dueDate} required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <div className="space-y-2">
        <div className="hidden grid-cols-12 gap-2 text-xs font-medium uppercase text-slate-500 sm:grid">
          <span className="col-span-6">Description</span><span className="col-span-2">Qty</span><span className="col-span-2">Price</span><span className="col-span-2 text-right">Amount</span>
        </div>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2">
            <input value={it.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Description" aria-label="Description" className="col-span-12 rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-6" />
            <input value={it.quantity} onChange={(e) => set(i, { quantity: e.target.value as any })} inputMode="decimal" aria-label="Quantity" className="col-span-3 rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
            <input value={it.unitAmount} onChange={(e) => set(i, { unitAmount: e.target.value as any })} inputMode="decimal" aria-label="Unit price" className="col-span-4 rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2" />
            <span className="col-span-3 text-right text-sm tabular-nums sm:col-span-1">{fmt((Number(it.quantity) || 0) * (Number(it.unitAmount) || 0))}</span>
            <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="col-span-2 text-xs text-rose-600 sm:col-span-1" aria-label="Remove line" disabled={items.length === 1}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setItems([...items, { description: "", quantity: 1, unitAmount: 0 }])} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
          + Add line
        </button>
      </div>
      <p className="text-right text-lg font-semibold">Total: {fmt(total)}</p>
      <label className="block text-sm font-medium text-slate-700">
        Notes (shown on the invoice)
        <textarea name="notes" defaultValue={initial.notes} rows={2} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="secondary">Save draft</SubmitButton>
        <button name="intent" value="send" className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Save & send to client
        </button>
      </div>
    </ActionForm>
  );
}
