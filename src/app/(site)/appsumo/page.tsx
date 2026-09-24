import Link from "next/link";
import { pendingLicenseKey } from "@/lib/appsumo-cookie";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { redeemPendingLicense } from "@/lib/appsumo-cookie";

export const metadata = { title: "Redeem your AppSumo license" };
export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  missing_code: "The activation link from AppSumo was incomplete. Please click Activate on AppSumo again.",
  exchange_failed: "We couldn't confirm your license with AppSumo. Please click Activate on AppSumo again, or paste your license key after logging in.",
};

export default async function AppsumoPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const pending = await pendingLicenseKey();
  const user = await getCurrentUser();
  if (user && pending) {
    const r = await redeemPendingLicense(user.id);
    redirect(r.ok ? "/app/billing?redeemed=redeemed" : `/app/billing?redeem_error=${encodeURIComponent(r.message ?? "")}`);
  }
  const emailQ = sp.email ? `?email=${encodeURIComponent(sp.email)}` : "";
  return (
    <main className="mx-auto max-w-xl px-4 py-14">
      <h1 className="text-3xl font-bold">Welcome, Sumo-ling! 🌮</h1>
      {sp.error && ERR[sp.error] && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{ERR[sp.error]}</p>}
      {pending ? (
        <>
          <p className="mt-3 text-slate-600"><strong>Step 2 of 3.</strong> Your license is confirmed. Create your ClientWrap account (or log in) and we'll apply it automatically.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Link href={`/signup${emailQ}`} className="rounded-lg bg-indigo-600 px-4 py-3 text-center font-semibold text-white">I'm new: create account</Link>
            <Link href="/login?next=/app/billing?redeemed=redeemed" className="rounded-lg border border-slate-300 px-4 py-3 text-center font-semibold">I have an account: log in</Link>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-slate-600">Redeem your lifetime license in 3 steps:</p>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-slate-700">
            <li>On AppSumo, open your purchase and click <strong>Activate</strong>.</li>
            <li>Create your ClientWrap account, or log in.</li>
            <li>Done: your tier is applied automatically.</li>
          </ol>
          <p className="mt-6 text-sm text-slate-600">Already have your key? <Link href="/login?next=/app/billing" className="text-indigo-600">Log in</Link> or <Link href="/signup" className="text-indigo-600">sign up</Link>, then paste it under <em>Plan & usage</em>.</p>
          <p className="mt-2 text-sm text-slate-600">Questions? Read <Link href="/help/licensing" className="text-indigo-600">AppSumo licenses</Link>.</p>
        </>
      )}
    </main>
  );
}
