import Anthropic from "@anthropic-ai/sdk";
import type { Row } from "./db";
import { decryptOrNull } from "./crypto";

/**
 * Bring-your-own-key AI. ClientWrap never pays for model usage: each workspace stores its own
 * Anthropic or OpenAI key (encrypted at rest). When no key is configured every generator falls
 * back to a deterministic, data-driven template, so the feature always works.
 */

export const AI_MODELS = {
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5 (best quality)" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced)" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (lowest cost)" },
  ],
  openai: [
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
  ],
} as const;

export function aiConfigured(ws: Row): boolean {
  return Boolean(ws.ai_provider && ws.ai_api_key_enc);
}

export class AIError extends Error {}

export async function generateText(ws: Row, system: string, prompt: string, maxTokens = 1200): Promise<string | null> {
  if (!aiConfigured(ws)) return null;
  const key = decryptOrNull(ws.ai_api_key_enc);
  if (!key) return null;
  return generateTextWithKey(ws.ai_provider, key, ws.ai_model, system, prompt, maxTokens);
}

export async function generateTextWithKey(
  provider: "anthropic" | "openai",
  key: string,
  model: string | null | undefined,
  system: string,
  prompt: string,
  maxTokens = 1200,
): Promise<string | null> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 1 });
    try {
      const res = await client.messages.create({
        model: model || "claude-opus-5",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: prompt }],
      });
      if (res.stop_reason === "refusal") return null;
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      return text || null;
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AIError("Your Anthropic API key was rejected. Update it in Settings → Integrations.");
      if (e instanceof Anthropic.RateLimitError) throw new AIError("Your Anthropic account is rate-limited right now. Try again in a minute.");
      if (e instanceof Anthropic.APIError) throw new AIError(`Anthropic API error: ${e.message}`);
      throw e;
    }
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "gpt-4.1-mini",
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new AIError(`OpenAI API error: ${body?.error?.message ?? res.status}`);
  return (body.choices?.[0]?.message?.content ?? "").trim() || null;
}

/** Validates a key with a tiny request; returns an error message or null. */
export async function testAIKey(provider: "anthropic" | "openai", key: string, model: string): Promise<string | null> {
  try {
    await generateTextWithKey(provider, key, model, "Reply with the single word OK.", "ping", 16);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
