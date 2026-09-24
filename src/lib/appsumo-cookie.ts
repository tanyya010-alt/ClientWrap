import { cookies } from "next/headers";
import { verifySignedToken } from "./crypto";
import { withService } from "./db";
import { redeemLicense, RedeemError } from "./appsumo";

export const PENDING_LICENSE_COOKIE = "cw_appsumo_license";

export async function pendingLicenseKey(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(PENDING_LICENSE_COOKIE)?.value;
  return v ? verifySignedToken(v, "appsumo-pending") : null;
}

/** Called right after signup/login: links a license the user brought from AppSumo OAuth. */
export async function redeemPendingLicense(userId: string): Promise<{ ok: boolean; message?: string }> {
  const key = await pendingLicenseKey();
  if (!key) return { ok: true };
  const jar = await cookies();
  try {
    await withService((q) => redeemLicense(q, userId, key, "oauth"));
    jar.delete(PENDING_LICENSE_COOKIE);
    return { ok: true };
  } catch (e) {
    jar.delete(PENDING_LICENSE_COOKIE);
    return { ok: false, message: e instanceof RedeemError ? e.message : "We couldn't link your AppSumo license." };
  }
}
