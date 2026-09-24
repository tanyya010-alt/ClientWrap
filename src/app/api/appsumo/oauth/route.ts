import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exchangeAppsumoCode, redeemLicense, RedeemError } from "@/lib/appsumo";
import { getCurrentUser } from "@/lib/auth";
import { withService } from "@/lib/db";
import { env } from "@/lib/env";
import { signedToken } from "@/lib/crypto";
import { captureError } from "@/lib/monitoring";
import { PENDING_LICENSE_COOKIE } from "@/lib/appsumo-cookie";

export const dynamic = "force-dynamic";


/**
 * AppSumo OAuth redirect URL. Doubles as signup/login:
 *  - logged in  -> license is linked immediately -> /app/billing
 *  - logged out -> license key is kept in a signed cookie -> /appsumo (create account or log in) -> linked
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(`${env.APP_URL}/appsumo?error=missing_code`);
  let licenseKey: string;
  let email: string | null;
  try {
    ({ licenseKey, email } = await exchangeAppsumoCode(code));
  } catch (e) {
    await captureError(e, { route: "appsumo-oauth" });
    return NextResponse.redirect(`${env.APP_URL}/appsumo?error=exchange_failed`);
  }
  const user = await getCurrentUser();
  if (user) {
    try {
      const r = await withService((q) => redeemLicense(q, user.id, licenseKey, "oauth"));
      return NextResponse.redirect(`${env.APP_URL}/app/billing?redeemed=${r.status}`);
    } catch (e) {
      const msg = e instanceof RedeemError ? e.message : "Something went wrong while linking your license.";
      return NextResponse.redirect(`${env.APP_URL}/app/billing?redeem_error=${encodeURIComponent(msg)}`);
    }
  }
  const jar = await cookies();
  jar.set(PENDING_LICENSE_COOKIE, signedToken(licenseKey, "appsumo-pending"), {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  const q = new URLSearchParams({ step: "account" });
  if (email) q.set("email", email);
  return NextResponse.redirect(`${env.APP_URL}/appsumo?${q}`);
}
