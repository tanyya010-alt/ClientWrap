import { requireApp } from "@/lib/auth";
import { Logo } from "@/components/auth-shell";
import { AppNav } from "@/components/app-nav";
import { PLANS } from "@/lib/tiers";
import { Badge } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { resendVerificationAction } from "../(auth)/actions";
import { env } from "@/lib/env";
import Script from "next/script";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireApp();
  const plan = PLANS[ctx.entitlement.plan];
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-slate-200 bg-white px-3 py-3 lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:flex-none lg:border-b-0 lg:border-r lg:py-5">
        <div className="mb-3 flex items-center justify-between px-2 lg:mb-6 lg:block">
          <Logo />
          <div className="lg:mt-3">
            <Badge tone={ctx.entitlement.mode === "full" ? "indigo" : "amber"}>
              {plan.name}
              {ctx.entitlement.source === "appsumo" ? " · AppSumo" : ""}
              {ctx.entitlement.mode !== "full" ? " · read-only" : ""}
            </Badge>
          </div>
        </div>
        <AppNav isAdmin={ctx.isAdmin} />
        <div className="mt-6 hidden border-t border-slate-100 px-2 pt-4 text-xs text-slate-500 lg:block">
          <p className="truncate" title={ctx.user.email}>{ctx.user.email}</p>
          <form action="/api/auth/logout" method="post" className="mt-2">
            <button className="font-medium text-slate-700 hover:underline">Log out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {!ctx.user.email_verified_at && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-8">
            <ActionForm action={resendVerificationAction} className="flex flex-wrap items-center gap-3">
              <span>Confirm your email ({ctx.user.email}) to send reports and invoices to clients.</span>
              <SubmitButton variant="secondary" className="!py-1">Resend email</SubmitButton>
            </ActionForm>
          </div>
        )}
        {ctx.entitlement.mode === "readonly" && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-8">
            Your license was deactivated. Your data is read-only and exportable until{" "}
            {new Date(ctx.entitlement.readonlyUntil!).toDateString()}.{" "}
            <a className="font-semibold underline" href="/app/settings#data">Export data</a> or{" "}
            <a className="font-semibold underline" href="/app/billing">reactivate</a>.
          </div>
        )}
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</main>
        <form action="/api/auth/logout" method="post" className="px-4 pb-6 text-sm lg:hidden">
          <button className="text-slate-600 underline">Log out</button>
        </form>
      </div>
      {env.CRISP_WEBSITE_ID && (
        <Script id="crisp" strategy="lazyOnload">
          {`window.$crisp=[];window.CRISP_WEBSITE_ID=${JSON.stringify(env.CRISP_WEBSITE_ID)};(function(){var d=document,s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`}
        </Script>
      )}
    </div>
  );
}
