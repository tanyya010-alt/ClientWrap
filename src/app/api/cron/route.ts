import { tick } from "@/lib/jobs/handlers";
import { env, isProd } from "@/lib/env";
import { json } from "@/lib/http";
import { safeEqual } from "@/lib/crypto";
import { captureError } from "@/lib/monitoring";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  const secret = env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (secret ? !safeEqual(auth, secret) : isProd()) return json({ error: "unauthorized" }, 401);
  try {
    const result = await tick();
    return json({ ok: true, ...result });
  } catch (e) {
    await captureError(e, { route: "cron" });
    return json({ ok: false, error: (e as Error).message }, 500);
  }
}

export const GET = handle;
export const POST = handle;
