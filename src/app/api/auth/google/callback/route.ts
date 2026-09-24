import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { withService } from "@/lib/db";
import { createSession, createUserWithWorkspace, normalizeEmail } from "@/lib/auth";
import { redeemPendingLicense } from "@/lib/appsumo-cookie";
import { audit } from "@/lib/audit";
import { safeEqual } from "@/lib/crypto";
import { captureError } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get("cw_oauth_state")?.value;
  jar.delete("cw_oauth_state");
  let saved: { state: string; next: string } | null = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!saved || !code || !safeEqual(saved.state, state)) return NextResponse.redirect(`${env.APP_URL}/login?error=google_state`);
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${env.APP_URL}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("no access token");
    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const info = (await infoRes.json()) as { sub: string; email: string; email_verified: boolean; name?: string };
    if (!info.email || !info.email_verified) return NextResponse.redirect(`${env.APP_URL}/login?error=google_unverified`);
    const { userId, isNew } = await withService(async (q) => {
      const bySub = await q.maybe("select id from users where google_sub = $1", [info.sub]);
      if (bySub) return { userId: bySub.id as string, isNew: false };
      const byEmail = await q.maybe("select id from users where lower(email) = $1", [normalizeEmail(info.email)]);
      if (byEmail) {
        // Google verified the email address, so it is safe to link and mark verified.
        await q.exec("update users set google_sub = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1", [byEmail.id, info.sub]);
        return { userId: byEmail.id as string, isNew: false };
      }
      const { user, workspace } = await createUserWithWorkspace(q, { email: info.email, name: info.name, googleSub: info.sub, verified: true });
      await audit(q, { workspaceId: workspace.id, userId: user.id, action: "account.created", metadata: { method: "google" } });
      return { userId: user.id, isNew: true };
    });
    await createSession(userId);
    const r = await redeemPendingLicense(userId);
    if (!r.ok) return NextResponse.redirect(`${env.APP_URL}/app/billing?redeem_error=${encodeURIComponent(r.message ?? "")}`);
    return NextResponse.redirect(`${env.APP_URL}${isNew ? "/onboarding" : saved.next || "/app"}`);
  } catch (e) {
    await captureError(e, { route: "google-callback" });
    return NextResponse.redirect(`${env.APP_URL}/login?error=google_failed`);
  }
}
