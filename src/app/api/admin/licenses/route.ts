import { getAppContext } from "@/lib/auth";
import { withService } from "@/lib/db";
import { adminLicenseDetail, adminSearch } from "@/lib/admin";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Admin license lookup API: ?q=<partial key or email> or ?key=<exact license key>. */
export async function GET(req: Request) {
  const ctx = await getAppContext();
  if (!ctx?.isAdmin) return json({ error: "forbidden" }, 403);
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (key) return json(await withService((q) => adminLicenseDetail(q, key)));
  return json(await withService((q) => adminSearch(q, url.searchParams.get("q") ?? "")));
}
