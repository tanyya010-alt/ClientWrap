import Link from "next/link";
import { listDocs } from "@/lib/content";

export const metadata = { title: "Help center" };

export default function HelpIndex() {
  const docs = listDocs("help");
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-3xl font-bold">Help center</h1>
      <p className="mt-2 text-slate-600">Everything you need to set up and run ClientWrap on your own, without waiting on anyone.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {docs.map((d) => (
          <Link key={d.slug} href={`/help/${d.slug}`} className="rounded-xl border border-slate-200 p-5 transition hover:border-indigo-300 hover:shadow-sm">
            <p className="font-semibold">{d.title}</p>
            <p className="mt-1 text-sm text-slate-600">{d.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
