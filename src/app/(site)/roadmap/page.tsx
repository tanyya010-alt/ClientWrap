import { getDoc } from "@/lib/content";
import { Prose } from "@/components/marketing/site";

export const metadata = { title: "Roadmap" };

export default function Roadmap() {
  const doc = getDoc("pages", "roadmap")!;
  return <main className="mx-auto max-w-3xl px-4 py-12"><Prose html={doc.html} /></main>;
}
