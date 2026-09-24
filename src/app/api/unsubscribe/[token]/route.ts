import { unsubscribe } from "@/lib/unsubscribe";
import { json, requestIp } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** RFC 8058 one-click unsubscribe (mail clients POST here). */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await rateLimit(`unsub:${requestIp(req)}`, 60, 60))) return json({ error: "rate limited" }, 429);
  const r = await unsubscribe(token, requestIp(req));
  return json({ ok: r.ok }, r.ok ? 200 : 404);
}
