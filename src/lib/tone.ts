/**
 * Tone guardrails for every client-facing message (reminders, referral requests, custom text).
 * ClientWrap sends friendly, professional reminders. It is not a debt-collection tool, so
 * threatening, coercive or abusive language is rejected before it can be saved or sent.
 */

const BLOCKED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(legal action|lawyer|attorney|solicitor|court|sue|lawsuit|litigation)\b/i, reason: "legal threats" },
  { pattern: /\b(debt collect\w*|collection agenc\w*|collections?|bailiff|repossess\w*)\b/i, reason: "debt-collection language" },
  { pattern: /\b(credit (score|bureau|report\w*)|blacklist\w*|report you)\b/i, reason: "credit threats" },
  { pattern: /\b(police|arrest\w*|criminal|jail|prison)\b/i, reason: "criminal threats" },
  { pattern: /\b(or else|last warning|final warning|you will regret|consequences)\b/i, reason: "threatening language" },
  { pattern: /\b(idiot|stupid|moron|liar|scam\w*|thie(f|ves)|cheat\w*|deadbeat|pathetic|useless)\b/i, reason: "insults" },
  { pattern: /\b(f+u+c+k\w*|shit\w*|bitch\w*|bastard\w*|damn\w*|crap\w*|asshole\w*)\b/i, reason: "profanity" },
  { pattern: /\b(shame|shaming|name and shame|public(ly)? post)\b/i, reason: "public shaming" },
];

export interface ToneResult {
  ok: boolean;
  issues: string[];
}

export function checkTone(text: string, opts: { maxLength?: number } = {}): ToneResult {
  const issues: string[] = [];
  const maxLength = opts.maxLength ?? 1200;
  for (const b of BLOCKED) if (b.pattern.test(text)) issues.push(`Remove ${b.reason}.`);
  const letters = text.replace(/[^A-Za-z]/g, "");
  const upper = text.replace(/[^A-Z]/g, "");
  if (letters.length >= 20 && upper.length / letters.length > 0.5) issues.push("Avoid writing in capital letters (reads as shouting).");
  if (/!{2,}/.test(text)) issues.push("Use at most one exclamation mark at a time.");
  if (text.length > maxLength) issues.push(`Keep it under ${maxLength} characters.`);
  return { ok: issues.length === 0, issues: Array.from(new Set(issues)) };
}

export class ToneError extends Error {
  constructor(public issues: string[]) {
    super(`This message can't be sent as written: ${issues.join(" ")}`);
  }
}

export function assertTone(text: string, opts?: { maxLength?: number }) {
  const r = checkTone(text, opts);
  if (!r.ok) throw new ToneError(r.issues);
}
