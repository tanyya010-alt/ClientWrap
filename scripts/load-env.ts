import { existsSync, readFileSync } from "node:fs";

/** Minimal .env loader for CLI scripts (Next.js loads .env itself). */
export function loadEnvFile(file = ".env") {
  for (const f of [file, ".env.local"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
