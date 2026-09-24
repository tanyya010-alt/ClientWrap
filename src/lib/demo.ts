import type { Q } from "./db";
import { getTemplate, metricConfigFromTemplate } from "./templates";
import { ensurePortalLink } from "./portal";
import { insertEvents, type CleanEvent } from "./metrics";
import { previousPeriod, periodBounds } from "./time";
import { currentPeriod } from "./entitlements";
import { buildSnapshot, templateNarrative } from "./reports";
import { saveInvoice } from "./invoices";
import type { Row } from "./db";

/** Deterministic pseudo-random so demo data looks organic but is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const BASE: Record<string, number> = {
  hours_saved: 38, tasks_automated: 1400, error_rate: 3.2, cost_saved: 2600,
  organic_sessions: 5200, keywords_top10: 24, leads: 31, backlinks: 12,
  sessions: 4, goals_completed: 3, confidence_score: 6, revenue: 8200,
  deliverables: 14, revision_rounds: 2.4, turnaround_days: 4.5, conversion_rate: 2.1, hours: 32,
};

export async function seedClientHistory(q: Q, workspaceId: string, clientId: string, templateKey: string, months = 7, seed = 7) {
  const t = getTemplate(templateKey);
  const rand = rng(seed);
  const events: CleanEvent[] = [];
  let period = currentPeriod();
  const periods: string[] = [];
  for (let i = 0; i < months; i++) {
    periods.unshift(period);
    period = previousPeriod(period);
  }
  periods.forEach((p, idx) => {
    const { start } = periodBounds(p);
    for (const m of t.metrics) {
      const base = BASE[m.key] ?? 50;
      const growth = m.better === "up" ? 1 + idx * 0.07 : 1 - idx * 0.05;
      const noise = 0.9 + rand() * 0.2;
      let v = base * growth * noise;
      if (m.unit === "%" || m.key === "confidence_score" || m.key === "revision_rounds" || m.key === "turnaround_days") v = Math.round(v * 10) / 10;
      else v = Math.round(v);
      // For "sum" metrics split the monthly value over a few entries, like real integrations do.
      const parts = m.agg === "sum" ? 3 : 1;
      const whole = Number.isInteger(v);
      for (let k = 0; k < parts; k++) {
        // Split whole-number totals into whole-number entries (the last one takes the remainder).
        const share = parts === 1 ? v : whole ? (k < parts - 1 ? Math.floor(v / parts) : v - Math.floor(v / parts) * (parts - 1)) : Math.round((v / parts) * 10) / 10;
        const day = 5 + k * 9;
        const d = new Date(start.getTime() + day * 86400_000);
        if (d > new Date()) continue;
        events.push({
          metric: m.key,
          label: m.label,
          value: share,
          unit: m.unit,
          occurredAt: d,
          idempotencyKey: `demo:${m.key}:${p}:${k}`,
        });
      }
    }
  });
  await insertEvents(q, workspaceId, clientId, events, "demo");
}

export const DEMO_CLIENTS = [
  { name: "Northwind Bakery", contact: "Maya Lopez", email: "maya@northwind-bakery.example", template: "seo", fee: 180000 },
  { name: "Brightpath Logistics", contact: "Sam Okafor", email: "sam@brightpath.example", template: "automation", fee: 250000 },
];

/**
 * One-click demo workspace: sample clients with 6 months of results, a sent wrap, an open overdue
 * invoice and a paid one. Demo clients are flagged is_demo and never count toward plan limits.
 * Demo contact emails use the reserved .example TLD, so nothing reaches a real inbox.
 */
export async function loadDemoWorkspace(q: Q, ws: Row, opts: { isDemo?: boolean; clients?: typeof DEMO_CLIENTS } = {}) {
  const isDemo = opts.isDemo ?? true;
  const created: Row[] = [];
  for (const [i, d] of (opts.clients ?? DEMO_CLIENTS).entries()) {
    const t = getTemplate(d.template);
    const existing = await q.maybe("select * from clients where workspace_id = $1 and name = $2", [ws.id, d.name]);
    const client: Row =
      existing ??
      (await q.one(
        `insert into clients (workspace_id, name, contact_name, contact_email, timezone, service_description, metric_config, monthly_fee_cents, is_demo, contract_end_date)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, current_date + 30) returning *`,
        [ws.id, d.name, d.contact, d.email, ws.timezone, t.serviceDescription, JSON.stringify(metricConfigFromTemplate(t)), d.fee, isDemo],
      ));
    await ensurePortalLink(q, ws.id, client.id);
    await seedClientHistory(q, ws.id, client.id, d.template, 7, 11 + i * 13);
    const last = previousPeriod(currentPeriod());
    const snap = await buildSnapshot(q, client, last);
    const n = templateNarrative(client.name, snap);
    await q.exec(
      `insert into reports (workspace_id, client_id, period, data_snapshot, narrative, next_step, status, sent_at, sent_to)
       values ($1,$2,$3,$4,$5,$6,'sent', now() - interval '3 days', $7) on conflict (client_id, period) do nothing`,
      [ws.id, client.id, last, JSON.stringify(snap), n.narrative, n.nextStep, client.contact_email],
    );
    const hasInvoices = await q.maybe("select 1 from invoices where client_id = $1", [client.id]);
    if (!hasInvoices) {
      const today = new Date();
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const paid = await saveInvoice(q, ws, {
        clientId: client.id,
        currency: ws.currency,
        issueDate: iso(new Date(today.getTime() - 40 * 86400_000)),
        dueDate: iso(new Date(today.getTime() - 26 * 86400_000)),
        items: [{ description: `${t.invoiceItem}`, quantity: 1, unitAmount: d.fee / 100 }],
      });
      await q.exec("update invoices set status = 'paid', paid_at = now() - interval '27 days', sent_at = now() - interval '40 days' where id = $1", [paid.id]);
      await q.exec("insert into payments (workspace_id, invoice_id, amount_cents, currency, method, paid_at) values ($1,$2,$3,$4,'manual', now() - interval '27 days')", [ws.id, paid.id, d.fee, ws.currency]);
      const open = await saveInvoice(q, ws, {
        clientId: client.id,
        currency: ws.currency,
        issueDate: iso(new Date(today.getTime() - (i === 0 ? 20 : 5) * 86400_000)),
        dueDate: iso(new Date(today.getTime() + (i === 0 ? -6 : 9) * 86400_000)),
        items: [{ description: `${t.invoiceItem}`, quantity: 1, unitAmount: d.fee / 100 }],
      });
      await q.exec("update invoices set status = 'open', sent_at = now() - interval '5 days' where id = $1", [open.id]);
    }
    const hasRenewal = await q.maybe("select 1 from renewal_suggestions where client_id = $1", [client.id]);
    if (!hasRenewal) {
      await q.exec(
        "insert into renewal_suggestions (workspace_id, client_id, title, body, visible_in_portal) values ($1,$2,$3,$4,true)",
        [ws.id, client.id, "Expand what's working", `Results are trending up month over month. We suggest continuing for another quarter and adding one focused initiative to push ${t.metrics[0].label.toLowerCase()} further.`],
      );
    }
    created.push(client);
  }
  return created;
}
