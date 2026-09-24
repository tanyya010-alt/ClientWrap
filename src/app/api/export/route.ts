import { getAppContext, inTenant } from "@/lib/auth";
import { exportWorkspaceData, exportZip } from "@/lib/export";
import { json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Data export works in every access mode, including read-only after license deactivation. */
export async function GET(req: Request) {
  const ctx = await getAppContext();
  if (!ctx) return json({ error: "unauthorized" }, 401);
  if (!(await rateLimit(`export:${ctx.user.id}`, 20, 3600))) return json({ error: "Too many exports; try again later." }, 429);
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  const data = await inTenant(ctx, async (q) => {
    const d = await exportWorkspaceData(q, ctx.workspace.id);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "data.exported", metadata: { format } });
    return d;
  });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "zip" || format === "csv") {
    return new Response(new Uint8Array(exportZip(data)), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="clientwrap-export-${stamp}.zip"`, "Cache-Control": "no-store" },
    });
  }
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="clientwrap-export-${stamp}.json"`, "Cache-Control": "no-store" },
  });
}
