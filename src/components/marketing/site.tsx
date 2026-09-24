import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "../auth-shell";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        <nav className="flex items-center gap-1 text-sm sm:gap-4">
          <Link href="/pricing" className="hidden px-2 text-slate-700 hover:text-slate-900 sm:inline">Pricing</Link>
          <Link href="/help" className="hidden px-2 text-slate-700 hover:text-slate-900 sm:inline">Help</Link>
          <Link href="/changelog" className="hidden px-2 text-slate-700 hover:text-slate-900 md:inline">Changelog</Link>
          <Link href="/login" className="px-2 text-slate-700 hover:text-slate-900">Log in</Link>
          <Link href="/signup" className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">Start free</Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const cols: [string, [string, string][]][] = [
    ["Product", [["Pricing", "/pricing"], ["Compare", "/compare"], ["Changelog", "/changelog"], ["Roadmap", "/roadmap"], ["Status", "/status"]]],
    ["Help", [["Help center", "/help"], ["Getting started", "/help/getting-started"], ["Webhook", "/help/webhook"], ["AppSumo licenses", "/help/licensing"], ["Contact support", "/help/support"]]],
    ["Legal", [["Terms", "/legal/terms"], ["Privacy", "/legal/privacy"], ["DPA", "/legal/dpa"], ["Cookies", "/legal/cookies"], ["Acceptable use", "/legal/acceptable-use"]]],
  ];
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-2 text-sm text-slate-600">Wrap up every client's month: results, invoices and next steps in one link.</p>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <p className="text-sm font-semibold">{title}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {links.map(([l, h]) => (
                <li key={h}><Link href={h} className="text-slate-600 hover:text-slate-900">{l}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="pb-8 text-center text-xs text-slate-500">© {new Date().getFullYear()} ClientWrap</p>
    </footer>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}

export function Prose({ html }: { html: string }) {
  return <div className="prose-cw" dangerouslySetInnerHTML={{ __html: html }} />;
}
