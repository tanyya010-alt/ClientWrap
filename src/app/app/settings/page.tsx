import { requireApp, inTenant } from "@/lib/auth";
import { Alert, Badge, Card, Field, Input, PageHeader, Select, Textarea, Help } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { COMMON_TIMEZONES, CURRENCIES } from "@/lib/timezones";
import { SERVICE_TEMPLATES } from "@/lib/templates";
import { TEMPLATES } from "@/lib/reminders";
import { AI_MODELS } from "@/lib/ai";
import { can, requiredPlanFor, PLANS, type Feature } from "@/lib/tiers";
import { env } from "@/lib/env";
import {
  addRuleAction,
  changePasswordAction,
  deleteAccountAction,
  deleteRuleAction,
  disconnectStripeAction,
  saveAiAction,
  saveBrandingAction,
  saveQuietHoursAction,
  saveRuleAction,
  saveStripeAction,
  saveTwilioAction,
  saveWhiteLabelAction,
  saveWorkspaceAction,
  setCustomDomainAction,
  setSenderAction,
  verifyCustomDomainAction,
  verifySenderAction,
} from "./actions";

export const metadata = { title: "Settings" };

function Locked({ feature }: { feature: Feature }) {
  const p = PLANS[requiredPlanFor(feature)];
  return (
    <Alert>
      Available on the {p.name} plan. <a className="font-semibold underline" href="/app/billing">Upgrade</a>
    </Alert>
  );
}

const SECTIONS = [
  ["workspace", "Business"],
  ["branding", "Branding"],
  ["reminders", "Reminders"],
  ["integrations", "Integrations"],
  ["white-label", "White-label"],
  ["account", "Account"],
  ["data", "Data & privacy"],
  ["audit", "Audit log"],
];

export default async function SettingsPage() {
  const ctx = await requireApp();
  const ws = ctx.workspace;
  const ent = ctx.entitlement;
  const { rules, auditRows } = await inTenant(ctx, async (q) => ({
    rules: await q.many("select * from reminder_rules order by channel, offset_days"),
    auditRows: await q.many("select * from audit_log order by created_at desc limit 50"),
  }));
  const records = (ws.email_domain_records ?? []) as { type: string; name: string; value: string; priority?: number }[];
  return (
    <>
      <PageHeader title="Settings" subtitle={ws.name} />
      <nav className="mb-6 flex flex-wrap gap-2 text-sm">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full bg-white px-3 py-1 ring-1 ring-slate-200 hover:ring-indigo-300">{label}</a>
        ))}
      </nav>
      <div className="space-y-6">
        <Card id="workspace" title="Business">
          <ActionForm action={saveWorkspaceAction}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name (shown to clients)" htmlFor="ws-name"><Input id="ws-name" name="name" defaultValue={ws.name} required /></Field>
              <Field label="Service type" htmlFor="service_type">
                <Select id="service_type" name="service_type" defaultValue={ws.service_type}>{SERVICE_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</Select>
              </Field>
              <Field label="Your timezone" htmlFor="ws-tz"><Select id="ws-tz" name="timezone" defaultValue={ws.timezone}>{COMMON_TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Default currency" htmlFor="ws-cur"><Select id="ws-cur" name="currency" defaultValue={ws.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Reply-to email" htmlFor="reply_to_email" hint="Client replies to reports and reminders go here."><Input id="reply_to_email" name="reply_to_email" type="email" defaultValue={ws.reply_to_email ?? ctx.user.email} /></Field>
            </div>
            <Field label="Payment instructions (bank transfer etc.)" htmlFor="payment_instructions" hint="Shown on invoices and the pay page, next to (or instead of) the Stripe button.">
              <Textarea id="payment_instructions" name="payment_instructions" rows={3} defaultValue={ws.payment_instructions ?? ""} />
            </Field>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>

        <Card id="branding" title="Branding">
          <ActionForm action={saveBrandingAction}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Brand color" htmlFor="brand_color"><Input id="brand_color" name="brand_color" type="color" defaultValue={ws.brand_color} className="h-10" /></Field>
              <Field label="Accent color" htmlFor="accent_color"><Input id="accent_color" name="accent_color" type="color" defaultValue={ws.accent_color} className="h-10" /></Field>
              <Field label="Logo (PNG/JPEG, < 300 KB)" htmlFor="ws-logo"><Input id="ws-logo" name="logo" type="file" accept="image/png,image/jpeg" /></Field>
            </div>
            {ws.logo_data && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remove_logo" /> Remove logo <img src={ws.logo_data} alt="Current logo" className="h-8" /></label>}
            <SubmitButton>Save branding</SubmitButton>
          </ActionForm>
        </Card>

        <Card id="reminders" title="Payment reminders" actions={<Help href="/help/invoices">How reminders work</Help>}>
          {!can(ent, "email_reminders") && <div className="mb-4"><Locked feature="email_reminders" /></div>}
          <ActionForm action={saveQuietHoursAction} className="mb-6 flex flex-wrap items-end gap-3">
            <Field label="Quiet from (hour)" htmlFor="qs"><Input id="qs" name="quiet_hours_start" type="number" min={0} max={23} defaultValue={ws.quiet_hours_start} className="w-24" /></Field>
            <Field label="until (hour)" htmlFor="qe"><Input id="qe" name="quiet_hours_end" type="number" min={0} max={23} defaultValue={ws.quiet_hours_end} className="w-24" /></Field>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="skip_weekends" defaultChecked={ws.skip_weekends} /> No messages on weekends</label>
            <SubmitButton variant="secondary">Save quiet hours</SubmitButton>
          </ActionForm>
          <p className="mb-3 text-sm text-slate-600">
            Quiet hours use each client's own timezone. Reminders stop the moment an invoice is paid or voided, when you pause a client, or when the client unsubscribes. Every message includes an unsubscribe link and passes tone checks, so reminders stay friendly. ClientWrap is not a debt-collection tool.
          </p>
          <div className="space-y-3">
            {rules.map((r) => (
              <ActionForm key={r.id} action={saveRuleAction.bind(null, r.id)} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="enabled" defaultChecked={r.enabled} /> {r.offset_days < 0 ? `${-r.offset_days} days before due` : r.offset_days === 0 ? "On due date" : `${r.offset_days} days after due`}</label>
                  <Badge tone={r.channel === "email" ? "slate" : "indigo"}>{r.channel}</Badge>
                  <Select name="template_key" defaultValue={r.template_key} className="!w-auto" aria-label="Template">
                    {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                  </Select>
                </div>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-slate-600">Custom wording{r.channel === "whatsapp" ? " / WhatsApp template" : ""}</summary>
                  <Textarea name="custom_message" rows={4} defaultValue={r.custom_message ?? ""} className="mt-2" placeholder="Optional. Variables: {{contact_name}} {{client_name}} {{invoice_number}} {{amount}} {{due_date}} {{provider_name}}" aria-label="Custom message" />
                  {r.channel === "whatsapp" && (
                    <Input name="whatsapp_content_sid" defaultValue={r.whatsapp_content_sid ?? ""} className="mt-2" placeholder="Approved WhatsApp template Content SID (HX…)" aria-label="WhatsApp template SID" />
                  )}
                </details>
                <div className="mt-2 flex items-center gap-3">
                  <SubmitButton variant="secondary" className="!py-1 !text-xs">Save</SubmitButton>
                  <button formAction={deleteRuleAction.bind(null, r.id)} className="text-xs text-rose-600">Remove step</button>
                </div>
              </ActionForm>
            ))}
          </div>
          <ActionForm action={addRuleAction} className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="Add step: days relative to due date" htmlFor="offset_days"><Input id="offset_days" name="offset_days" type="number" min={-30} max={90} defaultValue={3} className="w-28" /></Field>
            <Field label="Channel" htmlFor="channel">
              <Select id="channel" name="channel" className="w-40">
                <option value="email">Email</option>
                {env.FEATURE_SMS_WHATSAPP && <option value="sms">SMS</option>}
                {env.FEATURE_SMS_WHATSAPP && <option value="whatsapp">WhatsApp</option>}
              </Select>
            </Field>
            <SubmitButton variant="secondary">Add step</SubmitButton>
          </ActionForm>
        </Card>

        <Card id="integrations" title="Integrations (bring your own keys)">
          <p className="mb-4 text-sm text-slate-600">ClientWrap never resells AI or messaging. You connect your own accounts, so costs stay transparent and under your control. Keys are encrypted at rest and never shown in the browser again.</p>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-3">
              <h3 className="font-semibold">AI summaries {ws.ai_provider && <Badge tone="green">connected</Badge>}</h3>
              <ActionForm action={saveAiAction}>
                <Select name="ai_provider" defaultValue={ws.ai_provider ?? "anthropic"} aria-label="AI provider">
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI</option>
                  {ws.ai_provider && <option value="">Remove key</option>}
                </Select>
                <Select name="ai_model" defaultValue={ws.ai_model ?? "claude-opus-5"} aria-label="Model">
                  <optgroup label="Anthropic">{AI_MODELS.anthropic.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
                  <optgroup label="OpenAI">{AI_MODELS.openai.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
                </Select>
                <Input name="ai_api_key" type="password" autoComplete="off" placeholder={ws.ai_api_key_enc ? "•••••• saved (leave blank to keep)" : "API key"} aria-label="API key" />
                <SubmitButton variant="secondary">Test & save</SubmitButton>
              </ActionForm>
              <p className="text-xs text-slate-500">Without a key, summaries are written from your numbers by ClientWrap's built-in writer.</p>
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold">Stripe payments {ws.stripe_account_name && <Badge tone="green">{ws.stripe_account_name}</Badge>}</h3>
              {!can(ent, "stripe_pay_links") ? <Locked feature="stripe_pay_links" /> : (
                <>
                  <ActionForm action={saveStripeAction}>
                    <Input name="stripe_key" type="password" autoComplete="off" placeholder={ws.stripe_secret_key_enc ? "•••••• connected (paste to replace)" : "rk_live_… restricted key"} aria-label="Stripe key" />
                    <SubmitButton variant="secondary">Connect</SubmitButton>
                  </ActionForm>
                  {ws.stripe_secret_key_enc && (
                    <ActionForm action={disconnectStripeAction} confirm="Disconnect Stripe? Existing pay links stop syncing.">
                      <SubmitButton variant="secondary" className="!text-xs">Disconnect</SubmitButton>
                    </ActionForm>
                  )}
                  <p className="text-xs text-slate-500">Create a restricted key with write access to Prices, Payment Links and Webhook Endpoints, and read access to Checkout Sessions. <a className="underline" href="/help/invoices">Step-by-step</a></p>
                </>
              )}
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold">WhatsApp & SMS (Twilio) {ws.twilio_account_sid && <Badge tone="green">connected</Badge>}</h3>
              {!env.FEATURE_SMS_WHATSAPP ? (
                <Alert>SMS/WhatsApp reminders are rolling out gradually and are not enabled on this server yet.</Alert>
              ) : !can(ent, "sms_whatsapp") ? <Locked feature="sms_whatsapp" /> : (
                <ActionForm action={saveTwilioAction}>
                  <Input name="twilio_account_sid" defaultValue={ws.twilio_account_sid ?? ""} placeholder="Account SID (AC…)" aria-label="Twilio Account SID" />
                  <Input name="twilio_auth_token" type="password" autoComplete="off" placeholder={ws.twilio_auth_token_enc ? "•••••• saved" : "Auth token"} aria-label="Twilio auth token" />
                  <Input name="twilio_from_sms" defaultValue={ws.twilio_from_sms ?? ""} placeholder="SMS from number (+1…)" aria-label="SMS number" />
                  <Input name="twilio_from_whatsapp" defaultValue={ws.twilio_from_whatsapp ?? ""} placeholder="WhatsApp sender (+1…)" aria-label="WhatsApp number" />
                  <SubmitButton variant="secondary">Test & save</SubmitButton>
                  <p className="text-xs text-slate-500">SMS/WhatsApp only go to clients with a recorded consent. WhatsApp uses your approved templates only.</p>
                </ActionForm>
              )}
            </div>
          </div>
        </Card>

        <Card id="white-label" title="White-label" actions={<Help href="/help/white-label">Guide</Help>}>
          {!can(ent, "white_label") ? <Locked feature="white_label" /> : (
            <div className="grid gap-6 lg:grid-cols-3">
              <ActionForm action={saveWhiteLabelAction}>
                <h3 className="font-semibold">Product branding</h3>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remove_branding" defaultChecked={ws.remove_branding} /> Remove “Powered by ClientWrap” from portals, emails and PDFs</label>
                <SubmitButton variant="secondary">Save</SubmitButton>
              </ActionForm>
              <div className="space-y-3">
                <h3 className="font-semibold">Custom portal domain {ws.custom_domain_verified_at ? <Badge tone="green">verified</Badge> : ws.custom_domain ? <Badge tone="amber">pending</Badge> : null}</h3>
                <ActionForm action={setCustomDomainAction}>
                  <Input name="custom_domain" defaultValue={ws.custom_domain ?? ""} placeholder="results.youragency.com" aria-label="Custom domain" />
                  <SubmitButton variant="secondary">Save domain</SubmitButton>
                </ActionForm>
                {ws.custom_domain && !ws.custom_domain_verified_at && (
                  <div className="space-y-2 text-xs">
                    <p>Add these DNS records at your domain provider:</p>
                    <table className="w-full"><tbody>
                      <tr><td className="pr-2 font-mono">CNAME</td><td className="break-all font-mono">{ws.custom_domain}</td><td className="break-all font-mono">{env.CUSTOM_DOMAIN_CNAME_TARGET}</td></tr>
                      <tr><td className="pr-2 font-mono">TXT</td><td className="break-all font-mono">_clientwrap.{ws.custom_domain}</td><td className="break-all font-mono">{ws.custom_domain_token}</td></tr>
                    </tbody></table>
                    <ActionForm action={verifyCustomDomainAction}><SubmitButton className="!py-1 !text-xs">Verify</SubmitButton></ActionForm>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold">Custom email sender {ws.email_domain_verified_at ? <Badge tone="green">verified</Badge> : ws.email_domain_id ? <Badge tone="amber">pending</Badge> : null}</h3>
                <ActionForm action={setSenderAction}>
                  <Input name="email_from_name" defaultValue={ws.email_from_name ?? ws.name} placeholder="From name" aria-label="From name" />
                  <Input name="email_from_address" type="email" defaultValue={ws.email_from_address ?? ""} placeholder="reports@youragency.com" aria-label="From address" />
                  <SubmitButton variant="secondary">Save sender</SubmitButton>
                </ActionForm>
                {ws.email_domain_id && !ws.email_domain_verified_at && (
                  <div className="space-y-2 text-xs">
                    <p>Add these DNS records, then verify:</p>
                    <table className="w-full"><tbody>
                      {records.map((r, i) => <tr key={i}><td className="pr-2 font-mono">{r.type}</td><td className="break-all pr-2 font-mono">{r.name}</td><td className="break-all font-mono">{r.priority ? `${r.priority} ` : ""}{r.value}</td></tr>)}
                    </tbody></table>
                    <ActionForm action={verifySenderAction}><SubmitButton className="!py-1 !text-xs">Verify</SubmitButton></ActionForm>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>

        <Card id="account" title="Account">
          <div className="grid gap-6 lg:grid-cols-2">
            <ActionForm action={changePasswordAction}>
              <h3 className="font-semibold">Change password</h3>
              <Input name="current_password" type="password" placeholder="Current password (blank if you use Google only)" aria-label="Current password" autoComplete="current-password" />
              <Input name="new_password" type="password" placeholder="New password" aria-label="New password" autoComplete="new-password" />
              <SubmitButton variant="secondary">Update password</SubmitButton>
            </ActionForm>
            <div className="text-sm text-slate-600">
              <h3 className="font-semibold text-slate-900">Signed in as</h3>
              <p>{ctx.user.email} {ctx.user.email_verified_at ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>}</p>
            </div>
          </div>
        </Card>

        <Card id="data" title="Data & privacy">
          <p className="text-sm text-slate-600">Download everything in your workspace: clients, results, reports, invoices, payments, message log, consent records and audit log.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/api/export?format=json" className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium">Export JSON</a>
            <a href="/api/export?format=zip" className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium">Export CSV (zip)</a>
          </div>
          <div className="mt-6 border-t border-slate-100 pt-4">
            <h3 className="font-semibold text-rose-700">Delete account</h3>
            <p className="text-sm text-slate-600">Permanently deletes your account, workspace and all client data. AppSumo licenses are unlinked (not refunded). This cannot be undone.</p>
            <ActionForm action={deleteAccountAction} confirm="This permanently deletes everything. Continue?" className="mt-3 flex flex-wrap items-end gap-3">
              <Input name="confirm" placeholder="Type your email to confirm" aria-label="Confirm email" className="max-w-xs" />
              <SubmitButton variant="danger">Delete my account</SubmitButton>
            </ActionForm>
          </div>
        </Card>

        <Card id="audit" title="Audit log (last 50 events)">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500"><tr><th className="py-1">When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {auditRows.map((a) => (
                  <tr key={a.id}><td className="py-1 pr-2">{new Date(a.created_at).toLocaleString()}</td><td className="pr-2">{a.actor}</td><td className="pr-2 font-mono">{a.action}</td><td className="font-mono text-slate-500">{a.target_type ? `${a.target_type}:${String(a.target_id).slice(0, 12)}` : ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
