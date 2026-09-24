import { requireApp } from "@/lib/auth";
import { Card, Field, Input, PageHeader, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createClientAction } from "../actions";
import { SERVICE_TEMPLATES } from "@/lib/templates";
import { COMMON_TIMEZONES } from "@/lib/timezones";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const ctx = await requireApp();
  return (
    <>
      <PageHeader title="New client" subtitle="Each client gets their own branded results page, reports and invoices." />
      <Card className="max-w-2xl">
        <ActionForm action={createClientAction}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client / company name" htmlFor="name">
              <Input id="name" name="name" required placeholder="Acme Bakery" />
            </Field>
            <Field label="Service template" htmlFor="template" hint="Pre-fills the metrics you'll report on. You can change them later.">
              <Select id="template" name="template" defaultValue={ctx.workspace.service_type}>
                {SERVICE_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}: {t.metrics.map((m) => m.label).slice(0, 2).join(", ")}…</option>
                ))}
              </Select>
            </Field>
            <Field label="Contact name" htmlFor="contact_name">
              <Input id="contact_name" name="contact_name" placeholder="Jane Doe" />
            </Field>
            <Field label="Contact email" htmlFor="contact_email" hint="Reports, invoices and reminders go here.">
              <Input id="contact_email" name="contact_email" type="email" placeholder="jane@acme.com" />
            </Field>
            <Field label="Phone (optional)" htmlFor="contact_phone" hint="International format, e.g. +14155550100. Only used with SMS/WhatsApp consent.">
              <Input id="contact_phone" name="contact_phone" placeholder="+14155550100" />
            </Field>
            <Field label="Client timezone" htmlFor="timezone" hint="Reminders respect quiet hours in this timezone.">
              <Select id="timezone" name="timezone" defaultValue={ctx.workspace.timezone}>
                {COMMON_TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
              </Select>
            </Field>
            <Field label={`Monthly fee (${ctx.workspace.currency}, optional)`} htmlFor="monthly_fee" hint="Pre-fills invoices and renewal suggestions.">
              <Input id="monthly_fee" name="monthly_fee" type="number" min="0" step="0.01" />
            </Field>
          </div>
          <SubmitButton>Create client</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
