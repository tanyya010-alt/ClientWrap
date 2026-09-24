import { notFound, redirect } from "next/navigation";
import { verifySignedToken } from "@/lib/crypto";
import { withService } from "@/lib/db";
import { loadEntitlementQ } from "@/lib/entitlements";
import { PortalShell } from "@/components/portal-shell";
import { showPoweredBy } from "@/lib/messaging";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approve case study", robots: { index: false } };

async function load(token: string) {
  const id = verifySignedToken(decodeURIComponent(token), "cs-approve");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return withService(async (q) => {
    const cs = await q.maybe("select * from case_studies where id = $1", [id]);
    if (!cs) return null;
    const ws = await q.one("select * from workspaces where id = $1", [cs.workspace_id]);
    const client = await q.one("select * from clients where id = $1", [cs.client_id]);
    const ent = await loadEntitlementQ(q, ws.owner_id);
    return { cs, ws, client, ent };
  });
}

async function decide(token: string, fd: FormData) {
  "use server";
  const d = await load(token);
  if (!d || d.cs.status !== "pending_approval") redirect(`/approve/${encodeURIComponent(token)}`);
  const approve = fd.get("decision") === "approve";
  const name = String(fd.get("name") ?? "").trim().slice(0, 120);
  const feedback = String(fd.get("feedback") ?? "").trim().slice(0, 2000);
  if (approve && !name) redirect(`/approve/${encodeURIComponent(token)}?error=name`);
  await withService(async (q) => {
    await q.exec(
      "update case_studies set status = $2, approved_by_name = $3, approved_at = case when $2 = 'approved' then now() end, client_feedback = $4, updated_at = now() where id = $1 and status = 'pending_approval'",
      [d!.cs.id, approve ? "approved" : "changes_requested", approve ? name : null, approve ? null : feedback || null],
    );
    await audit(q, { workspaceId: d!.ws.id, actor: "client", action: approve ? "case_study.approved" : "case_study.changes_requested", targetType: "case_study", targetId: d!.cs.id, metadata: { name } });
  });
  redirect(`/approve/${encodeURIComponent(token)}`);
}

export default async function ApprovePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const d = await load(token);
  if (!d) notFound();
  const color = d.client.brand_color || d.ws.brand_color;
  return (
    <PortalShell brand={{ name: d.ws.name, color, logo: d.ws.logo_data }} poweredBy={showPoweredBy(d.ws, d.ent)}>
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-500">Case study draft for your approval</p>
        <h1 className="mt-1 text-2xl font-bold">{d.cs.title}</h1>
        <div className="mt-4 whitespace-pre-line text-slate-700">{d.cs.body}</div>
      </div>
      {d.cs.status === "pending_approval" ? (
        <form action={decide.bind(null, token)} className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-white p-6">
          {sp.error === "name" && <p className="text-sm text-rose-700">Please type your name to approve.</p>}
          <label className="block text-sm font-medium">Your name (to approve)<input name="name" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="block text-sm font-medium">Or tell us what to change<textarea name="feedback" rows={3} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <div className="flex flex-wrap gap-2">
            <button name="decision" value="approve" className="rounded-lg px-4 py-2 font-medium text-white" style={{ background: color }}>Approve for publishing</button>
            <button name="decision" value="changes" className="rounded-lg border border-slate-300 px-4 py-2 font-medium">Request changes</button>
          </div>
          <p className="text-xs text-slate-500">Nothing is published without your approval. If the text changes later, you'll be asked again.</p>
        </form>
      ) : (
        <p className="mt-6 rounded-xl bg-white p-4 text-center text-slate-700">
          {d.cs.status === "approved" || d.cs.status === "published" ? `Approved by ${d.cs.approved_by_name}. Thank you!` : d.cs.status === "changes_requested" ? "Thanks, your feedback was sent." : "This draft is not awaiting approval right now."}
        </p>
      )}
    </PortalShell>
  );
}
