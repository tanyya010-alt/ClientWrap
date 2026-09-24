import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolvePortal, asOwner } from "@/lib/public-access";
import { withService } from "@/lib/db";
import { PortalShell } from "@/components/portal-shell";
import { MetricCard } from "@/components/metric-card";
import { showPoweredBy } from "@/lib/messaging";
import { buildSnapshot, type ReportSnapshot } from "@/lib/reports";
import { formatMoney, periodLabel, toIsoDate } from "@/lib/time";
import { payUrl } from "@/lib/reminders";
import { signedToken } from "@/lib/crypto";
import { currentPeriod } from "@/lib/entitlements";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your results", robots: { index: false, follow: false } };

export default async function Portal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const h = await headers();
  const ctx = await resolvePortal(token, h.get("host"));
  if (!ctx) notFound();
  const { workspace: ws, client, ent } = ctx;
  const brand = { name: ws.name, color: client.brand_color || ws.brand_color, logo: ws.logo_data, clientLogo: client.logo_data };
  const poweredBy = showPoweredBy(ws, ent);
  if (ent.mode !== "full") {
    return (
      <PortalShell brand={brand} poweredBy={poweredBy}>
        <p className="rounded-xl bg-white p-6 text-center text-slate-700">This results page is temporarily unavailable. Please contact {ws.name}.</p>
      </PortalShell>
    );
  }
  await withService((q) => q.exec("update portal_links set view_count = view_count + 1, last_viewed_at = now() where id = $1", [ctx.link.id]));
  const data = await asOwner(ctx, async (q) => {
    const reports = await q.many("select id, period, data_snapshot, narrative, next_step, sent_at from reports where client_id = $1 and status = 'sent' order by period desc", [client.id]);
    const invoices = await q.many("select * from invoices where client_id = $1 and status in ('open','paid') order by issue_date desc limit 24", [client.id]);
    const renewal = await q.maybe("select * from renewal_suggestions where client_id = $1 and visible_in_portal order by created_at desc limit 1", [client.id]);
    const cases = await q.many("select id, title, status from case_studies where client_id = $1 and status = 'pending_approval'", [client.id]);
    const live = reports.length === 0 ? await buildSnapshot(q, client, currentPeriod()) : null;
    return { reports, invoices, renewal, cases, live };
  });
  const selected = data.reports.find((r) => r.period === sp.report) ?? data.reports[0];
  const snap: ReportSnapshot | null = selected ? (selected.data_snapshot as ReportSnapshot) : data.live;
  const color = brand.color;
  const open = data.invoices.filter((i) => i.status === "open");
  return (
    <PortalShell brand={brand} poweredBy={poweredBy}>
      <div className="mb-6">
        <p className="text-sm text-slate-500">Results for</p>
        <h1 className="text-2xl font-bold text-slate-900">{client.name}</h1>
      </div>

      {open.length > 0 && (
        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Open invoice{open.length > 1 ? "s" : ""}</h2>
          <ul className="mt-2 space-y-2">
            {open.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{i.number} · {formatMoney(i.total_cents, i.currency)} · due {toIsoDate(i.due_date)}</span>
                <a href={payUrl(i.id)} className="rounded-lg px-3 py-1.5 font-medium text-white" style={{ background: color }}>Pay now</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.cases.length > 0 && (
        <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm">
          <p className="font-semibold text-indigo-900">{ws.name} asked for your approval on a case study</p>
          {data.cases.map((c) => (
            <a key={c.id} className="mt-1 block text-indigo-700 underline" href={`/approve/${signedToken(c.id, "cs-approve")}`}>Review “{c.title}” →</a>
          ))}
        </section>
      )}

      {data.reports.length > 1 && (
        <nav className="mb-4 flex gap-2 overflow-x-auto" aria-label="Months">
          {data.reports.map((r) => (
            <a key={r.id} href={`?report=${r.period}`} className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${r.period === selected?.period ? "text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`} style={r.period === selected?.period ? { background: color } : undefined}>
              {periodLabel(r.period)}
            </a>
          ))}
        </nav>
      )}

      {snap ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{snap.periodLabel}{!selected && " (so far)"}</h2>
            {selected && <a className="text-sm underline" style={{ color }} href={`/p/${encodeURIComponent(token)}/report/${selected.period}/pdf`}>Download PDF</a>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {snap.metrics.filter((m) => m.value !== null).map((m) => <MetricCard key={m.key} m={m} color={color} />)}
          </div>
          {selected && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold">What changed</h3>
                <p className="mt-2 whitespace-pre-line text-slate-700">{selected.narrative}</p>
              </div>
              <div className="rounded-xl border-2 bg-white p-5" style={{ borderColor: color }}>
                <h3 className="font-semibold">Suggested next step</h3>
                <p className="mt-2 whitespace-pre-line text-slate-700">{selected.next_step}</p>
              </div>
            </>
          )}
          {snap.metrics.every((m) => m.value === null) && <p className="rounded-xl bg-white p-6 text-center text-slate-500">Results will appear here soon.</p>}
        </section>
      ) : (
        <p className="rounded-xl bg-white p-6 text-center text-slate-500">Your first monthly results will appear here soon.</p>
      )}

      {data.renewal && (
        <section className="mt-6 rounded-xl p-5 text-white" style={{ background: color }}>
          <h3 className="font-semibold">Looking ahead: {data.renewal.title}</h3>
          <p className="mt-2 whitespace-pre-line opacity-95">{data.renewal.body}</p>
          {ws.reply_to_email && <a href={`mailto:${ws.reply_to_email}?subject=${encodeURIComponent(`Next steps for ${client.name}`)}`} className="mt-3 inline-block rounded-lg bg-white px-3 py-1.5 text-sm font-medium" style={{ color }}>Let's talk</a>}
        </section>
      )}

      {data.invoices.some((i) => i.status === "paid") && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-semibold">Paid invoices</h3>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.invoices.filter((i) => i.status === "paid").map((i) => (
              <li key={i.id} className="flex justify-between py-2">
                <span>{i.number} · {toIsoDate(i.issue_date)}</span>
                <span className="flex gap-3"><span>{formatMoney(i.total_cents, i.currency)}</span><a className="underline" href={`${payUrl(i.id)}/pdf`}>PDF</a></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PortalShell>
  );
}
