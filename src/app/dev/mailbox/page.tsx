import { notFound } from "next/navigation";
import { withService } from "@/lib/db";
import { env, isProd } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev mailbox", robots: { index: false } };

/** Development only: shows emails captured when no RESEND_API_KEY is configured. */
export default async function Mailbox({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (isProd() || env.RESEND_API_KEY) notFound();
  const sp = await searchParams;
  const mails = await withService((q) =>
    q.many("select * from email_outbox where ($1::text is null or to_address = $1) order by created_at desc limit 50", [sp.to ?? null]),
  );
  const open = mails.find((m) => m.id === sp.id) ?? null;
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-bold">Dev mailbox</h1>
      <p className="text-sm text-slate-600">Emails captured locally because RESEND_API_KEY isn't set.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ul className="space-y-1 text-sm">
          {mails.map((m) => (
            <li key={m.id}>
              <a className={`block rounded p-2 ${open?.id === m.id ? "bg-indigo-50" : "hover:bg-slate-100"}`} href={`?id=${m.id}${sp.to ? `&to=${encodeURIComponent(sp.to)}` : ""}`}>
                <span className="block font-medium">{m.subject}</span>
                <span className="text-xs text-slate-500">{m.to_address} · {new Date(m.created_at).toLocaleTimeString()}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="lg:col-span-2">
          {open ? (
            <>
              <p className="text-sm"><strong>From:</strong> {open.from_address} <strong>To:</strong> {open.to_address}</p>
              <iframe title="email" srcDoc={open.html} className="mt-2 h-[600px] w-full rounded border border-slate-200 bg-white" sandbox="" />
              <pre className="mt-2 whitespace-pre-wrap text-xs" data-testid="mail-text">{open.text_body}</pre>
            </>
          ) : <p className="text-sm text-slate-500">Select an email.</p>}
        </div>
      </div>
    </main>
  );
}
