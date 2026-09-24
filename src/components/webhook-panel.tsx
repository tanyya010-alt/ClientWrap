"use client";
import { useState, useTransition } from "react";
import { webhookSnippets } from "@/lib/snippets";
import { CopyButton } from "./forms";

export function WebhookPanel({ url, reveal }: { url: string; reveal: () => Promise<string | null> }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [tab, setTab] = useState<"curl" | "n8n" | "make" | "zapier" | "bearer">("zapier");
  const [pending, start] = useTransition();
  const snippets = webhookSnippets(url, secret ?? "YOUR_SECRET");
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase text-slate-500">Webhook URL</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-slate-50 p-2 text-xs">{url}</code>
          <CopyButton text={url} />
        </div>
      </div>
      <div>
        <p className="text-xs font-medium uppercase text-slate-500">Signing secret</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded bg-slate-50 p-2 text-xs">{secret ?? "••••••••••••••••••••••••"}</code>
          {secret ? (
            <CopyButton text={secret} />
          ) : (
            <button type="button" disabled={pending} onClick={() => start(async () => setSecret(await reveal()))} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium">
              Reveal
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">Stored encrypted. Treat it like a password; regenerate it if it leaks.</p>
      </div>
      <div>
        <div className="flex flex-wrap gap-1 border-b border-slate-200">
          {(["zapier", "make", "n8n", "curl", "bearer"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`border-b-2 px-3 py-1.5 text-sm ${tab === t ? "border-indigo-600 font-semibold text-indigo-700" : "border-transparent text-slate-600"}`}>
              {{ zapier: "Zapier", make: "Make", n8n: "n8n (import JSON)", curl: "cURL", bearer: "No-HMAC tools" }[t]}
            </button>
          ))}
        </div>
        <div className="relative mt-2">
          <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{snippets[tab]}</pre>
          <div className="absolute right-2 top-2">
            <CopyButton text={snippets[tab]} />
          </div>
        </div>
        {!secret && <p className="mt-1 text-xs text-slate-500">Click “Reveal” to fill in your secret before copying.</p>}
      </div>
    </div>
  );
}
