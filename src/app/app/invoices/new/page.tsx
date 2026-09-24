import Link from "next/link";
import { requireApp, inTenant } from "@/lib/auth";
import { Card, PageHeader, Alert } from "@/components/ui";
import { InvoiceEditor } from "@/components/invoice-editor";
import { saveInvoiceAction } from "../actions";
import { CURRENCIES } from "@/lib/timezones";
import { getTemplate } from "@/lib/templates";
import { periodLabel, previousPeriod } from "@/lib/time";
import { currentPeriod } from "@/lib/entitlements";

export const metadata = { title: "New invoice" };

export default async function NewInvoice({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const clients = await inTenant(ctx, (q) => q.many("select id, name, monthly_fee_cents, currency, service_description from clients where archived_at is null order by name"));
  const pre = clients.find((c) => c.id === sp.client) ?? clients[0];
  const today = new Date();
  const due = new Date(today.getTime() + 14 * 86400_000);
  const t = getTemplate(ctx.workspace.service_type);
  return (
    <>
      <PageHeader title="New invoice" />
      {clients.length === 0 ? (
        <Alert>Add a client first. <Link className="font-semibold underline" href="/app/clients/new">New client</Link></Alert>
      ) : (
        <Card className="max-w-3xl">
          <InvoiceEditor
            action={saveInvoiceAction.bind(null, null)}
            clients={clients.map((c) => ({ id: c.id, name: c.name, fee: c.monthly_fee_cents }))}
            currencies={Array.from(new Set([ctx.workspace.currency, ...CURRENCIES]))}
            initial={{
              clientId: pre?.id ?? "",
              currency: pre?.currency ?? ctx.workspace.currency,
              issueDate: today.toISOString().slice(0, 10),
              dueDate: due.toISOString().slice(0, 10),
              notes: "",
              items: [{ description: `${pre?.service_description ?? t.invoiceItem}: ${periodLabel(previousPeriod(currentPeriod()))}`, quantity: 1, unitAmount: pre?.monthly_fee_cents ? pre.monthly_fee_cents / 100 : 0 }],
            }}
          />
        </Card>
      )}
    </>
  );
}
