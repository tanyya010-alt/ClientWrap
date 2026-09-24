import { notFound } from "next/navigation";
import { withService } from "@/lib/db";
import { loadEntitlementQ } from "@/lib/entitlements";
import { PortalShell } from "@/components/portal-shell";
import { showPoweredBy } from "@/lib/messaging";

export const dynamic = "force-dynamic";

export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await withService(async (q) => {
    const cs = await q.maybe("select * from case_studies where public_slug = $1 and status = 'published'", [slug]);
    if (!cs) return null;
    const ws = await q.one("select * from workspaces where id = $1", [cs.workspace_id]);
    const ent = await loadEntitlementQ(q, ws.owner_id);
    if (ent.mode !== "full") return null;
    return { cs, ws, ent };
  });
  if (!d) notFound();
  return (
    <PortalShell brand={{ name: d.ws.name, color: d.ws.brand_color, logo: d.ws.logo_data }} poweredBy={showPoweredBy(d.ws, d.ent)}>
      <article className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-10">
        <p className="text-sm text-slate-500">Case study</p>
        <h1 className="mt-1 text-3xl font-bold">{d.cs.title}</h1>
        <div className="mt-6 whitespace-pre-line leading-relaxed text-slate-700">{d.cs.body}</div>
        <p className="mt-8 text-xs text-slate-500">Published with the client's approval ({d.cs.approved_by_name}).</p>
      </article>
    </PortalShell>
  );
}
