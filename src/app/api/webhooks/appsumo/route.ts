import { handleAppsumoWebhook } from "@/lib/appsumo";
import { json, requestIp } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { captureError } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

/**
 * AppSumo Licensing v2 webhook (purchase, activate, upgrade, downgrade, deactivate, migrate).
 * This endpoint intentionally has no end date: it must keep working 3+ months after delisting.
 */
export async function POST(req: Request) {
  if (!(await rateLimit(`appsumo-wh:${requestIp(req)}`, 300, 60))) return json({ success: false, error: "rate limited" }, 429);
  const raw = await req.text();
  try {
    const r = await handleAppsumoWebhook(raw, req.headers);
    return json(r.body, r.status);
  } catch (e) {
    await captureError(e, { route: "appsumo-webhook" });
    // Non-2xx makes AppSumo retry; the raw payload is already stored.
    return json({ success: false, error: "processing failed" }, 500);
  }
}
