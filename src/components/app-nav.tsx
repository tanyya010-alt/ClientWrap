"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/app", label: "Dashboard", exact: true },
  { href: "/app/clients", label: "Clients" },
  { href: "/app/invoices", label: "Invoices" },
  { href: "/app/growth", label: "Growth" },
  { href: "/app/messages", label: "Message log" },
  { href: "/app/settings", label: "Settings" },
  { href: "/app/billing", label: "Plan & usage" },
  { href: "/app/help", label: "Help & support" },
];

export function AppNav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const items = isAdmin ? [...ITEMS, { href: "/admin", label: "Admin" }] : ITEMS;
  return (
    <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Main">
      {items.map((i) => {
        const active = "exact" in i && i.exact ? path === i.href : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
