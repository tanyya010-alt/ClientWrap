import { headers } from "next/headers";
import { parseUnsubToken, unsubscribe } from "@/lib/unsubscribe";
import { withService } from "@/lib/db";

export const metadata = { title: "Email preferences", robots: { index: false } };
export const dynamic = "force-dynamic";

async function act(token: string, resub: boolean) {
  "use server";
  const h = await headers();
  await unsubscribe(token, (h.get("x-forwarded-for") ?? "").split(",")[0] || null, resub);
  const { redirect } = await import("next/navigation");
  redirect(`/u/${token}?done=${resub ? "resub" : "unsub"}`);
}

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token: raw } = await params;
  const token = raw.includes("%") ? decodeURIComponent(raw) : raw;
  const sp = await searchParams;
  const parsed = parseUnsubToken(token);
  const ws = parsed
    ? await withService((q) => q.maybe("select w.name from clients c join workspaces w on w.id = c.workspace_id where c.id = $1", [parsed.clientId]))
    : null;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {!parsed || !ws ? (
          <p>This link is invalid or has expired.</p>
        ) : sp.done === "unsub" ? (
          <>
            <h1 className="text-lg font-semibold">You're unsubscribed</h1>
            <p className="mt-2 text-sm text-slate-600">{ws.name} won't send you automatic {parsed.channel} messages from ClientWrap anymore.</p>
            <form action={act.bind(null, token, true)} className="mt-4"><button className="text-sm text-indigo-600 underline">Undo: subscribe again</button></form>
          </>
        ) : sp.done === "resub" ? (
          <h1 className="text-lg font-semibold">You're subscribed again. Thanks!</h1>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Unsubscribe from {ws.name}?</h1>
            <p className="mt-2 text-sm text-slate-600">You'll stop receiving automatic {parsed.channel} messages (reports and payment reminders) sent via ClientWrap.</p>
            <form action={act.bind(null, token, false)} className="mt-4">
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Unsubscribe</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
