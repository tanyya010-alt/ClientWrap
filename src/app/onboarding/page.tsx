import Link from "next/link";
import { requireApp, inTenant } from "@/lib/auth";
import { Logo } from "@/components/auth-shell";
import { Alert, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SERVICE_TEMPLATES, getTemplate } from "@/lib/templates";
import { COMMON_TIMEZONES, CURRENCIES } from "@/lib/timezones";
import { MetricCard } from "@/components/metric-card";
import { aboutAction, brandAction, firstClientAction, generateFirstAction, loadDemoAction, resultsAction, sendFirstAction, skipOnboardingAction } from "./actions";
import { currentPeriod } from "@/lib/entitlements";
import { periodBounds, periodLabel, previousPeriod } from "@/lib/time";
import type { ReportSnapshot } from "@/lib/reports";
import { resendVerificationAction } from "../(auth)/actions";

export const metadata = { title: "Set up ClientWrap" };
export const dynamic = "force-dynamic";

const STEPS = ["About you", "Your brand", "First client", "Results", "First wrap"];

export default async function Onboarding({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const ws = ctx.workspace;
  const step = sp.step === "demo" ? 0 : Math.min(6, Math.max(1, Number(sp.step ?? Math.max(1, ws.onboarding_step || 1)) || 1));
  const data = await inTenant(ctx, async (q) => {
    const client = await q.maybe("select * from clients where not is_demo order by created_at limit 1");
    const report = client ? await q.maybe("select * from reports where client_id = $1 order by period desc limit 1", [client.id]) : null;
    return { client, report };
  });
  const tpl = getTemplate(ws.service_type);
  const last = previousPeriod(currentPeriod());
  const lastEnd = new Date(periodBounds(last).end.getTime() - 86400_000).toISOString().slice(0, 10);
  const prevEnd = new Date(periodBounds(previousPeriod(last)).end.getTime() - 86400_000).toISOString().slice(0, 10);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <form action={skipOnboardingAction}><button className="text-sm text-slate-500 hover:underline">Skip to dashboard</button></form>
      </div>
      {step >= 1 && step <= 5 && (
        <ol className="mb-6 flex gap-1" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <div className={`h-1.5 rounded-full ${i + 1 <= step ? "bg-indigo-600" : "bg-slate-200"}`} />
              <p className={`mt-1 hidden text-xs sm:block ${i + 1 === step ? "font-semibold text-indigo-700" : "text-slate-500"}`}>{s}</p>
            </li>
          ))}
        </ol>
      )}

      {(step === 1 || step === 0) && (
        <>
          <Card className="mb-4 border-indigo-200 bg-indigo-50">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-indigo-900">Just exploring?</p>
                <p className="text-sm text-indigo-900/80">Load a demo workspace with two sample clients, six months of results, invoices and a sent wrap. It doesn't count toward your limits and can be removed anytime.</p>
              </div>
              <ActionForm action={loadDemoAction} className="flex-none"><SubmitButton pendingText="Loading…">Load demo workspace</SubmitButton></ActionForm>
            </div>
          </Card>
          <Card title="Step 1 · About your business">
            <p className="mb-4 text-sm text-slate-600">About 5 minutes to your first wrap. Every step can be changed later.</p>
            <ActionForm action={aboutAction}>
              <Field label="Business name (what clients see)" htmlFor="name"><Input id="name" name="name" defaultValue={ws.name} required /></Field>
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">What do you sell?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {SERVICE_TEMPLATES.map((t) => (
                    <label key={t.key} className="flex cursor-pointer gap-2 rounded-lg border border-slate-200 p-3 text-sm has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50">
                      <input type="radio" name="service_type" value={t.key} defaultChecked={ws.service_type === t.key} required />
                      <span><span className="font-medium">{t.name}</span><br /><span className="text-xs text-slate-500">Tracks {t.metrics.map((m) => m.label.toLowerCase()).join(", ")}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Timezone" htmlFor="timezone"><Select id="timezone" name="timezone" defaultValue={ws.timezone}>{COMMON_TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
                <Field label="Currency" htmlFor="currency"><Select id="currency" name="currency" defaultValue={ws.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              </div>
              <SubmitButton>Continue</SubmitButton>
            </ActionForm>
          </Card>
        </>
      )}

      {step === 2 && (
        <Card title="Step 2 · Make it yours">
          <p className="mb-4 text-sm text-slate-600">Your color and logo appear on client pages, emails, reports and invoices.</p>
          <ActionForm action={brandAction}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Brand color" htmlFor="brand_color"><Input id="brand_color" name="brand_color" type="color" defaultValue={ws.brand_color} className="h-12" /></Field>
              <Field label="Logo (optional, PNG/JPEG < 300 KB)" htmlFor="logo"><Input id="logo" name="logo" type="file" accept="image/png,image/jpeg" /></Field>
            </div>
            <div className="flex gap-3"><SubmitButton>Continue</SubmitButton><Link href="/onboarding?step=3" className="px-2 py-2 text-sm text-slate-500">Skip</Link></div>
          </ActionForm>
        </Card>
      )}

      {step === 3 && (
        <Card title="Step 3 · Add your first client">
          <ActionForm action={firstClientAction}>
            <Field label="Client name" htmlFor="c-name"><Input id="c-name" name="name" defaultValue={data.client?.name ?? ""} placeholder="Acme Co" required /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contact name" htmlFor="c-contact"><Input id="c-contact" name="contact_name" defaultValue={data.client?.contact_name ?? ""} placeholder="Jane Doe" /></Field>
              <Field label="Contact email" htmlFor="c-email" hint="Tip: use your own email for the first test."><Input id="c-email" name="contact_email" type="email" defaultValue={data.client?.contact_email ?? ""} placeholder="jane@acme.com" /></Field>
            </div>
            <p className="text-xs text-slate-500">We'll track: {tpl.metrics.map((m) => m.label).join(", ")}. You can rename or add metrics later.</p>
            <SubmitButton>Continue</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {step === 4 && data.client && (
        <Card title="Step 4 · Add last month's results">
          <p className="mb-4 text-sm text-slate-600">Type the numbers you already report (leave any blank). Later you can import CSVs or connect Zapier, Make or n8n.</p>
          <ActionForm action={resultsAction}>
            <input type="hidden" name="cur_date" value={lastEnd} />
            <input type="hidden" name="prev_date" value={prevEnd} />
            <div className="grid grid-cols-3 gap-2 text-xs font-medium uppercase text-slate-500">
              <span>Metric</span><span>{periodLabel(previousPeriod(last))}</span><span>{periodLabel(last)}</span>
            </div>
            {Object.entries(data.client.metric_config as Record<string, any>).map(([k, m]) => (
              <div key={k} className="grid grid-cols-3 items-center gap-2">
                <span className="text-sm">{m.label} <span className="text-xs text-slate-400">{m.unit}</span></span>
                <Input name={`prev__${k}`} inputMode="decimal" aria-label={`${m.label} ${previousPeriod(last)}`} />
                <Input name={`cur__${k}`} inputMode="decimal" aria-label={`${m.label} ${last}`} />
              </div>
            ))}
            <div className="flex flex-wrap gap-3">
              <SubmitButton>Continue</SubmitButton>
            </div>
          </ActionForm>
          <ActionForm action={resultsAction} className="mt-3">
            <input type="hidden" name="sample" value="1" />
            <SubmitButton variant="secondary">No numbers handy? Use sample numbers</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {step === 5 && data.client && (
        <Card title="Step 5 · Your first monthly wrap">
          {!data.report ? (
            <ActionForm action={generateFirstAction.bind(null, last)}>
              <p className="text-sm text-slate-600">We'll build {data.client.name}'s {periodLabel(last)} wrap: headline numbers, change vs. the month before, and a written summary with a next step.</p>
              <SubmitButton pendingText="Building your wrap…">Generate wrap</SubmitButton>
            </ActionForm>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {(data.report.data_snapshot as ReportSnapshot).metrics.filter((m) => m.value !== null).slice(0, 4).map((m) => <MetricCard key={m.key} m={m} color={ws.brand_color} />)}
              </div>
              {!ctx.user.email_verified_at && (
                <div className="mt-4">
                  <Alert tone="warning">
                    One more thing: confirm your email ({ctx.user.email}) so we can send on your behalf. Check your inbox, then come back to this tab.
                    <ActionForm action={resendVerificationAction} className="mt-2"><SubmitButton variant="secondary" className="!py-1 !text-xs">Resend email</SubmitButton></ActionForm>
                  </Alert>
                </div>
              )}
              <ActionForm action={sendFirstAction.bind(null, data.report.id)} className="mt-4 space-y-3">
                <Field label="What changed (edit freely)" htmlFor="narrative"><Textarea id="narrative" name="narrative" rows={5} defaultValue={data.report.narrative} /></Field>
                <Field label="Suggested next step" htmlFor="next_step"><Textarea id="next_step" name="next_step" rows={2} defaultValue={data.report.next_step} /></Field>
                <fieldset className="space-y-1 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" name="to" value="me" defaultChecked /> Send a test to me ({ctx.user.email})</label>
                  <label className="flex items-center gap-2"><input type="radio" name="to" value="client" disabled={!data.client.contact_email} /> Send to {data.client.contact_email ?? "client (add an email first)"}</label>
                </fieldset>
                <SubmitButton pendingText="Sending…">Send my first wrap</SubmitButton>
              </ActionForm>
            </>
          )}
        </Card>
      )}

      {step === 6 && (
        <Card title="🎉 You sent your first wrap">
          <p className="text-sm text-slate-600">That's the whole loop. Next steps when you're ready:</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            <li><Link className="text-indigo-600" href="/app/invoices/new">Create an invoice</Link> with a pay button and automatic reminders</li>
            <li><Link className="text-indigo-600" href={data.client ? `/app/clients/${data.client.id}/data` : "/app/clients"}>Automate results</Link> with a CSV import or Zapier/Make/n8n webhook</li>
            <li><Link className="text-indigo-600" href={data.client ? `/app/clients/${data.client.id}/settings` : "/app/clients"}>Schedule monthly delivery</Link> so wraps go out on their own</li>
            <li><Link className="text-indigo-600" href="/help">Browse the help center</Link></li>
          </ul>
          <Link href="/app" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Go to dashboard</Link>
        </Card>
      )}
      <p className="mt-6 text-center text-xs text-slate-500">Stuck? Every step has a guide in the <a className="underline" href="/help" target="_blank">help center</a>.</p>
    </main>
  );
}
