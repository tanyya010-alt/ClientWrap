import { promises as dns } from "node:dns";
import { env } from "./env";
import { randomToken } from "./crypto";

export function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  const appHost = new URL(env.APP_URL).hostname;
  if (d === appHost || d.endsWith(`.${appHost}`)) return null;
  return d;
}

export function newDomainToken() {
  return `cw-verify-${randomToken(12)}`;
}

/** Checks the TXT ownership record and that the CNAME points at our portal host. */
export async function checkCustomDomain(domain: string, token: string): Promise<{ ok: boolean; txt: boolean; cname: boolean; detail: string }> {
  let txt = false;
  let cname = false;
  try {
    const records = await dns.resolveTxt(`_clientwrap.${domain}`);
    txt = records.some((r) => r.join("") === token);
  } catch {
    txt = false;
  }
  try {
    const c = await dns.resolveCname(domain);
    cname = c.some((x) => x.replace(/\.$/, "").toLowerCase() === env.CUSTOM_DOMAIN_CNAME_TARGET.toLowerCase());
  } catch {
    cname = false;
  }
  const detail = !txt ? `TXT record _clientwrap.${domain} not found yet.` : !cname ? `CNAME for ${domain} doesn't point to ${env.CUSTOM_DOMAIN_CNAME_TARGET} yet.` : "Verified.";
  return { ok: txt && cname, txt, cname, detail };
}

/** Registers the domain with the hosting provider so it can serve TLS (Vercel; optional). */
export async function attachDomainToHost(domain: string): Promise<string | null> {
  if (!env.VERCEL_TOKEN || !env.VERCEL_PROJECT_ID) return null;
  const qs = env.VERCEL_TEAM_ID ? `?teamId=${env.VERCEL_TEAM_ID}` : "";
  const res = await fetch(`https://api.vercel.com/v10/projects/${env.VERCEL_PROJECT_ID}/domains${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: domain }),
  });
  if (res.ok || res.status === 409) return null;
  const body = (await res.json().catch(() => ({}))) as any;
  return body?.error?.message ?? `Hosting provider returned ${res.status}`;
}

export async function detachDomainFromHost(domain: string) {
  if (!env.VERCEL_TOKEN || !env.VERCEL_PROJECT_ID) return;
  const qs = env.VERCEL_TEAM_ID ? `?teamId=${env.VERCEL_TEAM_ID}` : "";
  await fetch(`https://api.vercel.com/v9/projects/${env.VERCEL_PROJECT_ID}/domains/${domain}${qs}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
  }).catch(() => {});
}

// ---------------------------------------------------------------- custom email sender (Resend domains)

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  priority?: number;
}

export async function createSenderDomain(domain: string): Promise<{ id: string; records: DnsRecord[] }> {
  if (!env.RESEND_API_KEY) throw new Error("Custom senders need the email provider configured on the server (RESEND_API_KEY).");
  const res = await fetch("https://api.resend.com/domains", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: domain }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body?.message ?? `Email provider error ${res.status}`);
  return { id: body.id, records: (body.records ?? []).map((r: any) => ({ type: r.type, name: r.name, value: r.value, priority: r.priority })) };
}

export async function verifySenderDomain(id: string): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  await fetch(`https://api.resend.com/domains/${id}/verify`, { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
  const res = await fetch(`https://api.resend.com/domains/${id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
  const body = (await res.json().catch(() => ({}))) as any;
  return body?.status === "verified";
}
