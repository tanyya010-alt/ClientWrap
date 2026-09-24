import { getDoc } from "@/lib/content";
import { Prose } from "@/components/marketing/site";

export const metadata = { title: "ClientWrap vs alternatives" };

export default function Compare() {
  const doc = getDoc("pages", "compare")!;
  return <main className="mx-auto max-w-4xl px-4 py-12"><Prose html={doc.html} /></main>;
}
