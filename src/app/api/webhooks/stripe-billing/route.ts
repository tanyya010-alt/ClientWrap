import { handleBillingWebhook } from "@/lib/stripe-webhooks";
import { json, requestIp } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { captureError } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await rateLimit(`billing-wh:${requestIp(req)}`, 600, 60))) return json({ error: "rate limited" }, 429);
  try {
    const r = await handleBillingWebhook(await req.text(), req.headers.get("stripe-signature"));
    return json(r.body, r.status);
  } catch (e) {
    await captureError(e, { route: "stripe-billing-webhook" });
    return json({ error: "processing failed" }, 500);
  }
}
