import Link from "next/link";
import { requireApp, inTenant } from "@/lib/auth";
import { Badge, Empty, LinkButton, PageHeader, Card } from "@/components/ui";
import { formatMoney, toIsoDate } from "@/lib/time";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const status = ["draft", "open", "paid", "void", "overdue"].includes(sp.status ?? "") ? sp.status : null;
  const ctx = await requireApp();
  const invoices = await inTenant(ctx, (q) =>
    q.many(
      `select i.*, c.name as client_name, c.reminders_paused,
        (select max(created_at) from message_log m where m.invoice_id = i.id and m.kind = 'reminder' and m.status = 'sent') as last_reminder
       from invoices i join clients c on c.id = i.client_id
       where ($1::text is null or (case when $1 = 'overdue' then i.status = 'open' and i.due_date < current_date else i.status = $1 end))
       order by i.created_at desc limit 200`,
      [status],
    ),
  );
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Invoices" subtitle="Clients pay through your own Stripe account. Reminders stop automatically on payment." actions={<LinkButton href="/app/invoices/new">New invoice</LinkButton>} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[null, "open", "overdue", "paid", "draft", "void"].map((s) => (
          <Link key={s ?? "all"} href={s ? `/app/invoices?status=${s}` : "/app/invoices"} className={`rounded-full px-3 py-1 ${status === s ? "bg-indigo-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>{s ?? "all"}</Link>
        ))}
      </div>
      {invoices.length === 0 ? (
        <Empty title="No invoices here yet"><Link className="text-indigo-600" href="/app/invoices/new">Create an invoice</Link></Empty>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-2">Number</th><th>Client</th><th>Due</th><th className="text-right">Amount</th><th className="px-4">Status</th><th>Last reminder</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((i) => {
                const overdue = i.status === "open" && toIsoDate(i.due_date) < today;
                return (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2"><Link className="font-medium text-indigo-700" href={`/app/invoices/${i.id}`}>{i.number}</Link></td>
                    <td>{i.client_name}</td>
                    <td>{toIsoDate(i.due_date)}</td>
                    <td className="text-right tabular-nums">{formatMoney(i.total_cents, i.currency)}</td>
                    <td className="px-4"><Badge tone={i.status === "paid" ? "green" : overdue ? "red" : i.status === "open" ? "blue" : "slate"}>{overdue ? "overdue" : i.status}</Badge>{i.reminders_paused && i.status === "open" ? <span className="ml-1 text-xs text-slate-500">(paused)</span> : null}</td>
                    <td className="text-xs text-slate-500">{i.last_reminder ? new Date(i.last_reminder).toLocaleDateString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
