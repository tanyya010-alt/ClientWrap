import type { ReactNode } from "react";

export function PortalShell({ brand, children, poweredBy }: { brand: { name: string; color: string; logo?: string | null; clientLogo?: string | null }; children: ReactNode; poweredBy: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header style={{ background: brand.color }} className="text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            {brand.logo ? <img src={brand.logo} alt={brand.name} className="h-9 max-w-[140px] rounded bg-white/90 object-contain p-1" /> : null}
            <span className="text-lg font-semibold">{brand.name}</span>
          </div>
          {brand.clientLogo && <img src={brand.clientLogo} alt="" className="h-9 max-w-[120px] rounded bg-white/90 object-contain p-1" />}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">{children}</main>
      <footer className="mx-auto max-w-4xl px-4 pb-8 text-center text-xs text-slate-500">
        Private page for you. Please don't share this link.
        {poweredBy && (
          <>
            {" · "}
            <a href="https://clientwrap.app?ref=portal" className="underline">Powered by ClientWrap</a>
          </>
        )}
      </footer>
    </div>
  );
}
