import Link from "next/link";
import { requireApp, inTenant } from "@/lib/auth";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";

export const metadata = { title: "Message log" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const kind = ["reminder", "report", "invoice", "referral", "case_study_approval", "receipt"].includes(sp.kind ?? "") ? sp.kind : null;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const rows = await inTenant(ctx, (q) =>
    q.many(
      `select m.*, c.name as client_name, i.number as invoice_number from message_log m
       left join clients c on c.id = m.client_id left join invoices i on i.id = m.invoice_id
       where ($1::text is null or m.kind = $1) order by m.created_at desc limit 50 offset $2`,
      [kind, page * 50],
    ),
  );
  return (
    <>
      <PageHeader title="Message log" subtitle="Every email, SMS and WhatsApp message ClientWrap sent or skipped on your behalf, with the reason." />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[null, "reminder", "report", "invoice", "receipt", "referral", "case_study_approval"].map((k) => (
          <Link key={k ?? "all"} href={k ? `/app/messages?kind=${k}` : "/app/messages"} className={`rounded-full px-3 py-1 ${kind === k ? "bg-indigo-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>{k?.replace(/_/g, " ") ?? "all"}</Link>
        ))}
      </div>
      {rows.length === 0 ? <Empty title="No messages yet" /> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-2">When</th><th>Status</th><th>Kind</th><th>Channel</th><th>Client</th><th>To</th><th className="px-4">Subject / detail</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((m) => (
                <tr key={m.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-xs">{new Date(m.created_at).toLocaleString()}</td>
                  <td><Badge tone={m.status === "sent" ? "green" : m.status === "failed" ? "red" : "amber"}>{m.status}</Badge></td>
                  <td className="text-xs">{m.kind.replace(/_/g, " ")}{m.step_key ? ` (${m.step_key})` : ""}</td>
                  <td className="text-xs">{m.channel}</td>
                  <td className="text-xs">{m.client_name}{m.invoice_number ? ` · ${m.invoice_number}` : ""}</td>
                  <td className="text-xs">{m.recipient}</td>
                  <td className="px-4 text-xs">
                    {m.subject}
                    {(m.skip_reason || m.error) && <div className="text-amber-700">{m.skip_reason ?? m.error}</div>}
                    {m.body && <details><summary className="cursor-pointer text-slate-500">body</summary><pre className="mt-1 max-w-md whitespace-pre-wrap text-xs">{m.body}</pre></details>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="mt-4 flex gap-3 text-sm">
        {page > 0 && <Link href={`/app/messages?${new URLSearchParams({ ...(kind ? { kind } : {}), page: String(page - 1) })}`} className="text-indigo-600">← Newer</Link>}
        {rows.length === 50 && <Link href={`/app/messages?${new URLSearchParams({ ...(kind ? { kind } : {}), page: String(page + 1) })}`} className="text-indigo-600">Older →</Link>}
      </div>
    </>
  );
}
