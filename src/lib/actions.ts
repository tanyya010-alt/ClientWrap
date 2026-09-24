import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { requireApp, type AppContext } from "./auth";
import { withTenant, type Q } from "./db";
import { LimitError } from "./tiers";
import { ToneError } from "./tone";
import { RedeemError } from "./appsumo";
import { captureError } from "./monitoring";
import { AIError } from "./ai";
import type { ActionState } from "./action-types";

export class UserError extends Error {}

function isNextControlFlow(e: unknown): boolean {
  const d = (e as { digest?: string })?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND") || d.startsWith("NEXT_HTTP_ERROR"));
}

export function toActionError(e: unknown): ActionState {
  if (isNextControlFlow(e)) throw e;
  if (e instanceof LimitError) return { ok: false, error: e.message, upgradeTo: e.upgradeTo };
  if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
  if (e instanceof ToneError || e instanceof RedeemError || e instanceof UserError || e instanceof AIError) return { ok: false, error: e.message };
  const err = e as Error & { code?: string };
  if (err?.code) {
    // Database errors: never leak internals.
    void captureError(e, { where: "action" });
    if (err.code === "23505") return { ok: false, error: "That already exists." };
    return { ok: false, error: "Something went wrong. Please try again; if it keeps happening, contact support." };
  }
  if (err instanceof Error && err.message && err.message.length < 300) {
    void captureError(e, { where: "action" });
    return { ok: false, error: err.message };
  }
  void captureError(e, { where: "action" });
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Runs a server action inside the current user's tenant transaction (RLS enforced). */
export async function tenantAction(
  fn: (ctx: AppContext, q: Q) => Promise<ActionState | void>,
  opts: { revalidate?: string[] } = {},
): Promise<ActionState> {
  const ctx = await requireApp();
  try {
    const r = await withTenant({ userId: ctx.user.id, workspaceId: ctx.workspace.id }, (q) => fn(ctx, q));
    for (const p of opts.revalidate ?? []) revalidatePath(p, "layout");
    return r ?? { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === "" ? null : v;
}
