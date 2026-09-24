import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Logo } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Logo />
          <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">Support admin</span>
          <nav className="flex gap-3 text-sm">
            <Link href="/admin">Licenses & accounts</Link>
            <Link href="/admin/jobs">Jobs & errors</Link>
            <Link href="/app">Back to app</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
