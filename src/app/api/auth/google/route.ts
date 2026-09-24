import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!env.GOOGLE_CLIENT_ID) return NextResponse.redirect(`${env.APP_URL}/login?error=google_not_configured`);
  const state = randomToken(16);
  const next = new URL(req.url).searchParams.get("next") ?? "";
  const jar = await cookies();
  jar.set("cw_oauth_state", JSON.stringify({ state, next: next.startsWith("/") && !next.startsWith("//") ? next : "" }), {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
