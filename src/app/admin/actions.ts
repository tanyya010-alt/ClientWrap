"use server";

import { requireAdmin } from "@/lib/auth";
import { withService } from "@/lib/db";
import { reconcileAppsumoCsv } from "@/lib/appsumo";
import { parseCsv } from "@/lib/metrics";
import { audit } from "@/lib/audit";
import { retryDeadJob } from "@/lib/jobs/queue";
import type { ActionState } from "@/lib/action-types";
import { revalidatePath } from "next/cache";

export async function reconcileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireAdmin();
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Choose the CSV exported from AppSumo." };
  const parsed = parseCsv(await file.text());
  try {
    const s = await withService(async (q) => {
      const summary = await reconcileAppsumoCsv(q, parsed.rows, parsed.headers);
      await audit(q, { workspaceId: null, userId: ctx.user.id, actor: "admin", action: "appsumo.reconciled", metadata: summary as any });
      return summary;
    });
    return {
      ok: true,
      message: `${s.rows} rows · ${s.refunded} refunded · ${s.revoked} revoked now · ${s.alreadyRevoked} already revoked · ${s.unknownKeys.length} unknown keys · ${s.redeemedNotLinked.length} redeemed but not linked · ${s.errors.length} errors`,
      data: s,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function retryJobAction(id: string) {
  await requireAdmin();
  await withService((q) => retryDeadJob(q, id));
  revalidatePath("/admin/jobs");
}
