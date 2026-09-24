import { handleIngest } from "@/lib/ingest";
import { json, requestIp } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { captureError } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await rateLimit(`ingest:${token}`, 600, 60)) || !(await rateLimit(`ingest-ip:${requestIp(req)}`, 1200, 60))) {
    return json({ error: "Rate limit exceeded (600 requests/minute per webhook). Batch events with {events:[...]}." }, 429, { "Retry-After": "60" });
  }
  const raw = await req.text();
  if (raw.length > 1_000_000) return json({ error: "Body too large (max 1 MB)" }, 413);
  try {
    const r = await handleIngest(token, raw, req.headers);
    return json(r.body, r.status);
  } catch (e) {
    await captureError(e, { route: "ingest" });
    return json({ error: "Internal error; please retry" }, 500);
  }
}
