import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";

export interface Doc {
  slug: string;
  title: string;
  description: string;
  order: number;
  html: string;
}

function parse(file: string, slug: string): Doc {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta: Record<string, string> = {};
  let body = raw;
  if (m) {
    body = m[2];
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return {
    slug,
    title: meta.title ?? slug,
    description: meta.description ?? "",
    order: Number(meta.order ?? 99),
    html: marked.parse(body, { async: false }) as string,
  };
}

const root = () => path.join(process.cwd(), "content");

export function listDocs(dir: string): Doc[] {
  const d = path.join(root(), dir);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parse(path.join(d, f), f.replace(/\.md$/, "")))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getDoc(dir: string, slug: string): Doc | null {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const f = path.join(root(), dir, `${slug}.md`);
  return existsSync(f) ? parse(f, slug) : null;
}
