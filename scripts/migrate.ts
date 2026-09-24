/* Runs SQL migrations in order. Usage: tsx scripts/migrate.ts [--reset] */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { loadEnvFile } from "./load-env";

loadEnvFile();

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (process.argv.includes("--reset")) {
      if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
        throw new Error("Refusing to reset a production database without --force");
      }
      await client.query("drop schema if exists public cascade; drop schema if exists app cascade; create schema public;");
      console.log("database reset");
    }
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
    );
    const dir = path.join(process.cwd(), "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ name: string }>("select name from schema_migrations");
    const applied = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`applied ${file}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
    console.log("migrations up to date");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
