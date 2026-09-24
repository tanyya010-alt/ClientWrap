"use server";

import { redirect } from "next/navigation";
import {
  authenticate,
  clientIp,
  consumeAuthToken,
  createSession,
  createUserWithWorkspace,
  destroySession,
  normalizeEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  validatePassword,
  getCurrentUser,
} from "@/lib/auth";
import { withService } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { redeemPendingLicense } from "@/lib/appsumo-cookie";
import { hashPassword } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { str, toActionError } from "@/lib/actions";
import type { ActionState } from "@/lib/action-types";

function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export async function signupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(str(fd, "email"));
  const password = str(fd, "password");
  const name = str(fd, "name");
  if (!fd.get("terms")) return { error: "Please accept the Terms and Privacy Policy." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };
  const ip = await clientIp();
  if (!(await rateLimit(`signup:${ip}`, 10, 3600))) return { error: "Too many signups from your network. Try again in an hour." };
  let userId: string;
  try {
    const exists = await withService((q) => q.maybe("select id from users where lower(email) = $1", [email]));
    if (exists) return { error: "An account with this email already exists. Log in instead, or reset your password." };
    const { user, workspace } = await withService(async (q) => {
      const r = await createUserWithWorkspace(q, { email, name: name || null, password });
      await audit(q, { workspaceId: r.workspace.id, userId: r.user.id, action: "account.created", metadata: { method: "password" }, ip });
      return r;
    });
    void workspace;
    userId = user.id;
    await sendVerificationEmail(user);
    await createSession(user.id);
  } catch (e) {
    return toActionError(e);
  }
  const r = await redeemPendingLicense(userId);
  if (!r.ok) redirect(`/app/billing?redeem_error=${encodeURIComponent(r.message ?? "")}`);
  redirect("/onboarding");
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(str(fd, "email"));
  const password = str(fd, "password");
  const ip = await clientIp();
  if (!(await rateLimit(`login-ip:${ip}`, 30, 900)) || !(await rateLimit(`login-email:${email}`, 10, 900))) {
    return { error: "Too many login attempts. Please wait 15 minutes or reset your password." };
  }
  const user = await authenticate(email, password);
  if (!user) return { error: "Email or password is incorrect." };
  await createSession(user.id);
  await withService(async (q) => {
    const ws = await q.maybe("select id from workspaces where owner_id = $1", [user.id]);
    await audit(q, { workspaceId: ws?.id ?? null, userId: user.id, action: "account.login", ip });
  });
  const r = await redeemPendingLicense(user.id);
  if (!r.ok) redirect(`/app/billing?redeem_error=${encodeURIComponent(r.message ?? "")}`);
  redirect(safeNext(str(fd, "next")));
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(str(fd, "email"));
  const ip = await clientIp();
  if (!(await rateLimit(`reset-ip:${ip}`, 10, 3600)) || !(await rateLimit(`reset-email:${email}`, 3, 3600))) {
    return { error: "Too many reset requests. Please try again later." };
  }
  await sendPasswordResetEmail(email);
  return { ok: true, message: "If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder)." };
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const password = str(fd, "password");
  const pwErr = validatePassword(password);
  if (pwErr) return { error: pwErr };
  const userId = await consumeAuthToken("reset_password", str(fd, "token"));
  if (!userId) return { error: "This reset link is invalid or has expired. Request a new one." };
  const hash = await hashPassword(password);
  await withService(async (q) => {
    await q.exec("update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = $1", [userId, hash]);
    await q.exec("delete from sessions where user_id = $1", [userId]);
    const ws = await q.maybe("select id from workspaces where owner_id = $1", [userId]);
    await audit(q, { workspaceId: ws?.id ?? null, userId, action: "account.password_reset" });
  });
  await createSession(userId);
  redirect("/app");
}

export async function resendVerificationAction(): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please log in again." };
  if (!(await rateLimit(`verify-resend:${user.id}`, 5, 3600))) return { error: "Please wait a bit before requesting another email." };
  await sendVerificationEmail(user);
  return { ok: true, message: `Verification email sent to ${user.email}.` };
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
