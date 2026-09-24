import { handleWorkspaceStripeWebhook } from "@/lib/stripe-webhooks";
import { json, requestIp } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { captureError } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(workspaceId)) return json({ error: "not found" }, 404);
  if (!(await rateLimit(`stripe-wh:${requestIp(req)}`, 600, 60))) return json({ error: "rate limited" }, 429);
  try {
    const r = await handleWorkspaceStripeWebhook(workspaceId, await req.text(), req.headers.get("stripe-signature"));
    return json(r.body, r.status);
  } catch (e) {
    await captureError(e, { route: "stripe-workspace-webhook", workspaceId });
    return json({ error: "processing failed" }, 500);
  }
}
