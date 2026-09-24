import Link from "next/link";
import { requireApp, inTenant } from "@/lib/auth";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { limit } from "@/lib/tiers";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const archived = sp.archived === "1";
  const clients = await inTenant(ctx, (q) =>
    q.many(
      `select c.*, (select max(occurred_at) from metric_events e where e.client_id = c.id) as last_data,
              (select count(*)::int from invoices i where i.client_id = c.id and i.status = 'open') as open_invoices,
              (select max(period) from reports r where r.client_id = c.id and r.status = 'sent') as last_sent
       from clients c where (c.archived_at is not null) = $1 order by c.is_demo, c.name`,
      [archived],
    ),
  );
  const used = clients.filter((c) => !c.is_demo && !c.archived_at).length;
  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={archived ? "Archived clients don't count toward your limit." : `${used} of ${limit(ctx.entitlement, "clients")} client workspaces used`}
        actions={
          <>
            <LinkButton href={archived ? "/app/clients" : "/app/clients?archived=1"} variant="secondary">{archived ? "Active clients" : "Archived"}</LinkButton>
            <LinkButton href="/app/clients/new">New client</LinkButton>
          </>
        }
      />
      {clients.length === 0 ? (
        <Empty title={archived ? "No archived clients" : "No clients yet"}>
          {!archived && (
            <>
              <Link href="/app/clients/new" className="text-indigo-600">Add your first client</Link> or{" "}
              <Link href="/onboarding?step=demo" className="text-indigo-600">load the demo workspace</Link> to explore with sample data.
            </>
          )}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/app/clients/${c.id}`} className="block">
              <Card className="h-full transition hover:border-indigo-300">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="truncate text-sm text-slate-500">{c.contact_email ?? "No contact email"}</p>
                  </div>
                  <span className="h-6 w-6 flex-none rounded-full" style={{ background: c.brand_color || ctx.workspace.brand_color }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.is_demo && <Badge>demo</Badge>}
                  {c.last_sent ? <Badge tone="green">sent {c.last_sent}</Badge> : <Badge tone="amber">no report sent</Badge>}
                  {c.open_invoices > 0 && <Badge tone="blue">{c.open_invoices} open invoice{c.open_invoices > 1 ? "s" : ""}</Badge>}
                  {c.reminders_paused && <Badge tone="red">reminders paused</Badge>}
                </div>
                <p className="mt-3 text-xs text-slate-500">Last data: {c.last_data ? new Date(c.last_data).toLocaleDateString() : "none yet"}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
