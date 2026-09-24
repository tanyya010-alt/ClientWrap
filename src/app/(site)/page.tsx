import Link from "next/link";
import { PLANS, PAID_PLANS } from "@/lib/tiers";
import { FAQ } from "@/lib/faq";

export default async function Landing({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <main>
      {sp.deleted && <p className="bg-emerald-50 py-2 text-center text-sm text-emerald-800">Your account and data were deleted. Thanks for trying ClientWrap.</p>}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">For consultants, freelancers & new agencies</p>
            <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">Wrap up every client's month in one link.</h1>
            <p className="mt-5 text-lg text-slate-600">Results in your client's own numbers, invoices with a pay button and friendly reminders, and a suggested next step for renewal. Your brand on all of it.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-lg bg-indigo-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-indigo-700">Start free: first wrap in 10 minutes</Link>
              <Link href="/pricing" className="rounded-lg border border-slate-300 px-5 py-3 font-semibold text-slate-800 hover:bg-slate-50">See pricing</Link>
            </div>
            <p className="mt-3 text-sm text-slate-500">Free for your first client. No credit card. Bring your own AI and Stripe keys.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-xl">
            <div className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white">Brightline Studio</div>
            <div className="mt-3 rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Results for Northwind Bakery · August 2026</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {[["Organic sessions", "6,230", "+21.7%"], ["Leads from organic", "44", "+41.9%"], ["Keywords in top 10", "31", "+6.9%"], ["New backlinks", "15", "+25%"]].map(([l, v, c]) => (
                  <div key={l} className="rounded-lg border border-slate-200 p-3">
                    <p className="text-xs text-slate-500">{l}</p>
                    <p className="text-lg font-bold">{v} <span className="rounded-full bg-emerald-50 px-1.5 text-xs text-emerald-700">{c}</span></p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-slate-700">Leads from organic search grew 42% as the new location pages started ranking…</p>
              <div className="mt-3 rounded-lg border-2 border-indigo-600 p-3 text-sm"><strong>Next step:</strong> build on the momentum with two more location pages in October.</div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-amber-50 p-3 text-sm"><span>INV-0012 · $1,800 · due Sep 30</span><span className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white">Pay now</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold">One monthly ritual instead of five tools</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              ["📈 Results they understand", "Track any metric in your client's own units: hours saved, leads, sessions, goals hit. Enter it, import a CSV, or pipe it in from Zapier, Make or n8n."],
              ["✍️ The wrap writes itself", "Headline numbers, change vs. last month and a clear summary of what changed and what to do next. Edit, then send, or schedule it to go out automatically."],
              ["💸 Get paid without chasing", "Invoices with a Stripe pay button on your own account. Friendly reminders before and after the due date stop the moment they pay."],
              ["🔁 Renewals on autopilot", "A suggested next step based on real results appears right on the client's page, so the renewal conversation starts itself."],
              ["⭐ Case studies & referrals", "Turn results into a case study your client approves before it's published, and a no-pressure referral request."],
              ["🏷️ Your brand, your domain", "Your logo and colors everywhere. On Agency, remove our branding and use your own domain and email sender."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <p className="font-semibold">{t}</p>
                <p className="mt-2 text-sm text-slate-600">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold">Built for how you actually sell</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">Templates for automation agencies, SEO, coaching and design pre-fill the right metrics, so your first wrap takes minutes.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[["Automation agencies", "Hours saved, tasks automated, error rate, cost saved"], ["SEO", "Organic sessions, top-10 keywords, leads, backlinks"], ["Coaching", "Sessions, goals completed, confidence score, revenue"], ["Design", "Deliverables, revision rounds, turnaround, conversion"]].map(([t, d]) => (
            <div key={t} className="rounded-xl border border-slate-200 p-5"><p className="font-semibold">{t}</p><p className="mt-1 text-sm text-slate-600">{d}</p></div>
          ))}
        </div>
      </section>

      <section className="bg-slate-900 py-16 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold">Trustworthy by default</h2>
            <p className="mt-3 text-slate-300">Your clients' data is isolated with database row-level security, and an automated test proves one workspace can never read another's. Reminders pass tone checks, respect quiet hours and unsubscribes, and are never debt collection.</p>
          </div>
          <ul className="space-y-2 text-slate-200">
            <li>✓ Encrypted API keys and secrets</li>
            <li>✓ Signed, idempotent webhooks</li>
            <li>✓ Full message log and audit log</li>
            <li>✓ Export everything (CSV/JSON) and delete anytime</li>
            <li>✓ Bring your own AI, Stripe and Twilio keys: no hidden usage fees</li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold">Simple pricing</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PAID_PLANS.map((k) => (
            <div key={k} className="rounded-xl border border-slate-200 p-6">
              <p className="font-semibold">{PLANS[k].name}</p>
              <p className="mt-2 text-3xl font-bold">${PLANS[k].monthlyPriceUsd}<span className="text-base font-normal text-slate-500">/mo</span></p>
              <p className="text-sm text-slate-500">{PLANS[k].limits.clients} client workspaces</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center"><Link href="/pricing" className="font-semibold text-indigo-600">Compare plans →</Link></p>
      </section>

      <section className="bg-slate-50 py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="text-center text-3xl font-bold">FAQ</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <summary className="cursor-pointer font-medium">{q}</summary>
                <p className="mt-2 text-sm text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

