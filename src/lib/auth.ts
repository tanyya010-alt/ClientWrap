import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { withService, type Q, type Row } from "./db";
import { hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { env } from "./env";
import { button, emailLayout, sendEmail } from "./email";
import { loadEntitlementQ } from "./entitlements";
import type { Entitlement } from "./tiers";
import { createDefaultReminderRules } from "./reminders";

export const SESSION_COOKIE = "cw_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  name: string | null;
  email_verified_at: string | null;
  refund_block_until: string | null;
  created_at: string;
}

export interface Workspace extends Row {
  id: string;
  owner_id: string;
  name: string;
}

export interface AppContext {
  user: User;
  workspace: Workspace;
  entitlement: Entitlement;
  isAdmin: boolean;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUserWithWorkspace(
  q: Q,
  input: { email: string; name?: string | null; password?: string | null; googleSub?: string | null; verified?: boolean },
): Promise<{ user: User; workspace: Workspace }> {
  const email = normalizeEmail(input.email);
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const user = await q.one<User>(
    `insert into users (email, name, password_hash, google_sub, email_verified_at)
     values ($1,$2,$3,$4,$5) returning *`,
    [email, input.name ?? null, passwordHash, input.googleSub ?? null, input.verified ? new Date() : null],
  );
  const wsName = input.name ? `${input.name.split(" ")[0]}'s studio` : "My studio";
  const workspace = await q.one<Workspace>("insert into workspaces (owner_id, name) values ($1,$2) returning *", [
    user.id,
    wsName,
  ]);
  await createDefaultReminderRules(q, workspace.id);
  return { user, workspace };
}

export async function createSession(userId: string) {
  const token = randomToken(32);
  const h = await headers();
  await withService((q) =>
    q.exec(
      "insert into sessions (user_id, token_hash, ip, user_agent, expires_at) values ($1,$2,$3,$4, now() + interval '30 days')",
      [userId, sha256(token), (h.get("x-forwarded-for") ?? "").split(",")[0] || null, h.get("user-agent")?.slice(0, 300) ?? null],
    ),
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.APP_URL.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await withService((q) => q.exec("delete from sessions where token_hash = $1", [sha256(token)]));
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return withService((q) =>
    q.maybe<User>(
      `select u.id, u.email, u.name, u.email_verified_at, u.refund_block_until, u.created_at
       from sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [sha256(token)],
    ),
  );
}

export async function getAppContext(): Promise<AppContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return withService(async (q) => {
    const workspace = await q.maybe<Workspace>(
      "select * from workspaces where owner_id = $1 order by created_at limit 1",
      [user.id],
    );
    if (!workspace) return null;
    const entitlement = await loadEntitlementQ(q, user.id);
    return { user, workspace, entitlement, isAdmin: env.ADMIN_EMAILS.includes(user.email.toLowerCase()) };
  });
}

export async function requireApp(): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireAdmin(): Promise<AppContext> {
  const ctx = await requireApp();
  if (!ctx.isAdmin) redirect("/app");
  return ctx;
}

export async function authenticate(email: string, password: string): Promise<User | null> {
  const row = await withService((q) =>
    q.maybe<User & { password_hash: string | null }>("select * from users where lower(email) = $1", [normalizeEmail(email)]),
  );
  // Always run a hash comparison to avoid user-enumeration timing differences.
  const ok = await verifyPassword(password, row?.password_hash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  return ok && row ? row : null;
}

export async function createAuthToken(q: Q, userId: string, kind: "verify_email" | "reset_password", hours: number) {
  const token = randomToken(32);
  await q.exec(
    `insert into auth_tokens (user_id, kind, token_hash, expires_at) values ($1,$2,$3, now() + make_interval(hours => $4))`,
    [userId, kind, sha256(token), hours],
  );
  return token;
}

export async function consumeAuthToken(kind: "verify_email" | "reset_password", token: string): Promise<string | null> {
  return withService(async (q) => {
    const row = await q.maybe<{ id: string; user_id: string }>(
      `update auth_tokens set used_at = now()
       where token_hash = $1 and kind = $2 and used_at is null and expires_at > now()
       returning id, user_id`,
      [sha256(token), kind],
    );
    return row?.user_id ?? null;
  });
}

export async function sendVerificationEmail(user: { id: string; email: string }) {
  const token = await withService((q) => createAuthToken(q, user.id, "verify_email", 72));
  const url = `${env.APP_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: "Confirm your ClientWrap email",
    html: emailLayout({
      title: "Confirm your email",
      bodyHtml: `<p>Click below to confirm your email address. The link is valid for 72 hours.</p>${button(url, "Confirm email")}<p style="font-size:13px;color:#666">If you didn't create a ClientWrap account you can ignore this email.</p>`,
      showPoweredBy: false,
    }),
    text: `Confirm your email: ${url}`,
  });
}

export async function sendPasswordResetEmail(email: string) {
  const user = await withService((q) => q.maybe<User>("select * from users where lower(email) = $1", [normalizeEmail(email)]));
  if (!user) return; // don't reveal whether the account exists
  const token = await withService((q) => createAuthToken(q, user.id, "reset_password", 2));
  const url = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your ClientWrap password",
    html: emailLayout({
      title: "Reset your password",
      bodyHtml: `<p>Someone (hopefully you) asked to reset your password. The link is valid for 2 hours.</p>${button(url, "Choose a new password")}<p style="font-size:13px;color:#666">If this wasn't you, you can ignore this email; your password stays the same.</p>`,
      showPoweredBy: false,
    }),
    text: `Reset your password: ${url}`,
  });
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Use at least one letter and one number.";
  return null;
}

import { withTenant } from "./db";
/** Shorthand for running queries in the current user's tenant context (RLS enforced). */
export function inTenant<T>(ctx: AppContext, fn: (q: Q) => Promise<T>): Promise<T> {
  return withTenant({ userId: ctx.user.id, workspaceId: ctx.workspace.id }, fn);
}
