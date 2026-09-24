import Link from "next/link";

export function ClientTabs({ id, active }: { id: string; active: "overview" | "data" | "settings" }) {
  const tabs = [
    { key: "overview", label: "Overview & reports", href: `/app/clients/${id}` },
    { key: "data", label: "Results data", href: `/app/clients/${id}/data` },
    { key: "settings", label: "Client settings", href: `/app/clients/${id}/settings` },
  ];
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${active === t.key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
