import { notFound } from "next/navigation";
import { getDoc, listDocs } from "@/lib/content";
import { Prose } from "@/components/marketing/site";

export function generateStaticParams() {
  return listDocs("legal").map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const d = getDoc("legal", (await params).slug);
  return { title: d?.title ?? "Legal" };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const doc = getDoc("legal", (await params).slug);
  if (!doc) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Prose html={doc.html} />
    </main>
  );
}
