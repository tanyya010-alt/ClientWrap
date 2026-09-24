import Link from "next/link";
import { PLANS, PLAN_ORDER, FEATURE_LABELS, type Feature } from "@/lib/tiers";

export const metadata = { title: "Pricing" };

const ROWS: Feature[] = ["client_portal", "monthly_reports", "ai_summary", "pdf_export", "csv_import", "invoices", "scheduled_reports", "metrics_webhook", "stripe_pay_links", "email_reminders", "renewal_generator", "case_study_generator", "referral_requests", "sms_whatsapp", "white_label", "custom_domain", "custom_email_sender"];

export default function Pricing() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-center text-4xl font-bold">Pricing</h1>
      <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">Start free with one client. Upgrade when you grow. Annual plans get two months free. AI, SMS and WhatsApp run on your own keys, so there are never surprise usage bills.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-4">
        {PLAN_ORDER.map((k) => {
          const p = PLANS[k];
          return (
            <div key={k} className={`flex flex-col rounded-2xl border p-6 ${k === "growth" ? "border-indigo-500 ring-2 ring-indigo-500" : "border-slate-200"}`}>
              {k === "growth" && <p className="mb-2 self-start rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">Most popular</p>}
              <p className="text-lg font-semibold">{p.name}</p>
              <p className="text-sm text-slate-600">{p.tagline}</p>
              <p className="mt-4 text-4xl font-bold">${p.monthlyPriceUsd}<span className="text-base font-normal text-slate-500">/month</span></p>
              <p className="text-sm text-slate-500">{p.annualPriceUsd ? `or $${p.annualPriceUsd}/year` : "free forever"}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">{p.highlights.map((h) => <li key={h}>✓ {h}</li>)}</ul>
              <Link href="/signup" className={`mt-6 rounded-lg px-4 py-2 text-center font-semibold ${k === "growth" ? "bg-indigo-600 text-white" : "border border-slate-300"}`}>{k === "free" ? "Start free" : `Start with ${p.name}`}</Link>
            </div>
          );
        })}
      </div>

      <div className="mt-14 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left"><th className="py-3">Compare plans</th>{PLAN_ORDER.map((k) => <th key={k} className="px-3 text-center">{PLANS[k].name}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100"><td className="py-2">Client workspaces</td>{PLAN_ORDER.map((k) => <td key={k} className="text-center">{PLANS[k].limits.clients}</td>)}</tr>
            <tr className="border-b border-slate-100"><td className="py-2">Emails / month (fair use)</td>{PLAN_ORDER.map((k) => <td key={k} className="text-center">{PLANS[k].limits.emailsPerMonth.toLocaleString()}</td>)}</tr>
            <tr className="border-b border-slate-100"><td className="py-2">Webhook events / month</td>{PLAN_ORDER.map((k) => <td key={k} className="text-center">{PLANS[k].limits.webhookEventsPerMonth.toLocaleString()}</td>)}</tr>
            {ROWS.map((f) => (
              <tr key={f} className="border-b border-slate-100"><td className="py-2">{FEATURE_LABELS[f]}</td>{PLAN_ORDER.map((k) => <td key={k} className="text-center">{PLANS[k].features.includes(f) ? "✓" : "—"}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-8 text-center text-sm text-slate-500">
        Have an AppSumo license? <Link href="/appsumo" className="text-indigo-600">Redeem it here</Link>. Questions? See the <Link href="/help/plans-and-limits" className="text-indigo-600">plans & limits guide</Link>.
      </p>
    </main>
  );
}
