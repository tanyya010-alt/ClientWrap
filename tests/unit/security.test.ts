import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { decrypt, encrypt, hashPassword, signedToken, verifySignedToken, verifyPassword } from "@/lib/crypto";
import { verifyAppsumoSignature, timestampFresh } from "@/lib/appsumo";
import { hmacHex } from "@/lib/crypto";

describe("crypto", () => {
  it("encrypts secrets at rest (AES-256-GCM) and detects tampering", () => {
    const c = encrypt("sk_live_secret");
    expect(c).not.toContain("sk_live_secret");
    expect(decrypt(c)).toBe("sk_live_secret");
    const parts = c.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("signed tokens are purpose-bound", () => {
    const t = signedToken("abc", "portal");
    expect(verifySignedToken(t, "portal")).toBe("abc");
    expect(verifySignedToken(t, "unsub")).toBeNull();
    expect(verifySignedToken(t.slice(0, -1) + "x", "portal")).toBeNull();
  });
  it("hashes passwords with scrypt", async () => {
    const h = await hashPassword("correct horse 1");
    expect(await verifyPassword("correct horse 1", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("verifies AppSumo signatures", () => {
    const body = '{"event":"purchase"}';
    const ts = String(Date.now());
    const sig = hmacHex("test-appsumo-api-key", ts + body);
    expect(verifyAppsumoSignature(body, ts, sig)).toBe(true);
    expect(verifyAppsumoSignature(body + " ", ts, sig)).toBe(false);
    expect(verifyAppsumoSignature(body, ts, hmacHex("other", ts + body))).toBe(false);
    expect(timestampFresh(String(Date.now() - 10 * 60_000))).toBe(false);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("no secrets in client-side code", () => {
  const files = walk(path.join(process.cwd(), "src"));
  const clientFiles = files.filter((f) => /^\s*["']use client["']/m.test(readFileSync(f, "utf8").slice(0, 200)));
  it("finds client components", () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });
  it.each(clientFiles.map((f) => [path.relative(process.cwd(), f)]))("%s imports no server modules or env secrets", (rel) => {
    const src = readFileSync(rel, "utf8");
    expect(src).not.toMatch(/from ["']@\/lib\/(env|db|crypto|auth|email|ai|stripe-connect|appsumo|messaging)["']/);
    expect(src).not.toMatch(/process\.env\.(?!NEXT_PUBLIC_)/);
  });
  it("no hard-coded live keys anywhere in src", () => {
    for (const f of files) expect(readFileSync(f, "utf8")).not.toMatch(/sk_live_[A-Za-z0-9]{10,}|re_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9]/);
  });
});
