import { NextResponse } from "next/server";
import { consumeAuthToken } from "@/lib/auth";
import { withService } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const userId = await consumeAuthToken("verify_email", token);
  if (!userId) return NextResponse.redirect(`${env.APP_URL}/login?error=verify_invalid`);
  await withService((q) => q.exec("update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [userId]));
  return NextResponse.redirect(`${env.APP_URL}/app?verified=1`);
}
