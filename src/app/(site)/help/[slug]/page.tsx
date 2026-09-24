import Link from "next/link";
import { notFound } from "next/navigation";
import { getDoc, listDocs } from "@/lib/content";
import { Prose } from "@/components/marketing/site";

export function generateStaticParams() {
  return listDocs("help").map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const d = getDoc("help", (await params).slug);
  return { title: d ? `${d.title} · Help` : "Help", description: d?.description };
}

export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc("help", slug);
  if (!doc) notFound();
  const all = listDocs("help");
  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-4">
      <aside className="hidden lg:block">
        <p className="text-sm font-semibold">Help center</p>
        <ul className="mt-2 space-y-1 text-sm">
          {all.map((d) => (
            <li key={d.slug}><Link href={`/help/${d.slug}`} className={d.slug === slug ? "font-semibold text-indigo-700" : "text-slate-600 hover:text-slate-900"}>{d.title}</Link></li>
          ))}
        </ul>
      </aside>
      <article className="lg:col-span-3">
        <Link href="/help" className="text-sm text-indigo-600">← All articles</Link>
        <Prose html={doc.html} />
      </article>
    </main>
  );
}
