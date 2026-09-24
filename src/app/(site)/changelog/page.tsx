import { getDoc } from "@/lib/content";
import { Prose } from "@/components/marketing/site";

export const metadata = { title: "Changelog" };

export default function Changelog() {
  const doc = getDoc("pages", "changelog")!;
  return <main className="mx-auto max-w-3xl px-4 py-12"><Prose html={doc.html} /></main>;
}
