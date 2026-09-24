import type { Row } from "./db";
import { generateText } from "./ai";
import { fmtChange, fmtValue, type ReportSnapshot } from "./reports";
import { checkTone } from "./tone";
import { daysBetween, toIsoDate } from "./time";

function bestWins(snap: ReportSnapshot | null) {
  if (!snap) return [];
  return snap.metrics
    .filter((m) => m.trend === "improved" && m.value !== null)
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
}

function dataLines(snap: ReportSnapshot | null) {
  if (!snap) return "(no data)";
  return snap.metrics
    .filter((m) => m.value !== null)
    .map((m) => `- ${m.label}: ${fmtValue(m)} (${fmtChange(m.changePct)} vs previous month; ${m.trend})`)
    .join("\n");
}

/** Renewal suggestion: rules first (contract timing + results), optionally rewritten by AI. */
export async function generateRenewalSuggestion(ws: Row, client: Row, snap: ReportSnapshot | null): Promise<{ title: string; body: string; ai: boolean }> {
  const wins = bestWins(snap);
  const declined = snap?.metrics.filter((m) => m.trend === "declined") ?? [];
  const daysLeft = client.contract_end_date ? daysBetween(new Date().toISOString().slice(0, 10), toIsoDate(client.contract_end_date)) : null;
  let title: string;
  let body: string;
  if (wins.length >= 2) {
    title = "Expand what's working";
    body = `Results are trending the right way (${wins
      .slice(0, 2)
      .map((m) => `${m.label.toLowerCase()} ${fmtChange(m.changePct)}`)
      .join(", ")}). We suggest continuing for another quarter and adding one focused initiative to push ${wins[0].label.toLowerCase()} further.`;
  } else if (declined.length > 0) {
    title = "Reset and refocus";
    body = `${declined[0].label} dipped last month. We suggest a short strategy session and a 90-day plan focused on turning it around, keeping everything that is already working in place.`;
  } else {
    title = "Keep the momentum";
    body = `Results are steady. We suggest renewing for the next quarter with one clear target we agree on together, so next month's wrap shows measurable progress.`;
  }
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 45) body += ` Your current agreement ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}, so now is a good time to decide.`;

  const ai = await generateText(
    ws,
    "You help a freelancer propose a renewal to a client. Write 2-3 friendly, specific, non-pushy sentences grounded ONLY in the data given. No hype, no pressure tactics, no discounts unless given. Output only the text.",
    `Client: ${client.name}\nService: ${client.service_description ?? ""}\nContract ends in: ${daysLeft ?? "unknown"} days\nMonthly fee: ${client.monthly_fee_cents ? client.monthly_fee_cents / 100 : "unknown"}\nResults:\n${dataLines(snap)}\nDraft idea: ${body}`,
    400,
  ).catch(() => null);
  if (ai && checkTone(ai).ok) return { title, body: ai, ai: true };
  return { title, body, ai: false };
}

export async function generateCaseStudy(ws: Row, client: Row, snap: ReportSnapshot | null): Promise<{ title: string; body: string; ai: boolean }> {
  const wins = bestWins(snap);
  const service = client.service_description || "our services";
  const title = wins[0]
    ? `How ${client.name} improved ${wins[0].label.toLowerCase()} by ${fmtChange(wins[0].changePct).replace("+", "")}`
    : `Working with ${client.name}`;
  const body = [
    `The client: ${client.name} partnered with ${ws.name} for ${service}.`,
    `The challenge: they wanted clear, measurable progress every month without extra reporting overhead.`,
    `What we did: ${ws.name} delivered ${service.toLowerCase()} and reported results monthly with a shared results page.`,
    wins.length
      ? `The results (${snap?.periodLabel}): ${wins
          .slice(0, 3)
          .map((m) => `${m.label} reached ${fmtValue(m)} (${fmtChange(m.changePct)} month over month)`)
          .join("; ")}.`
      : `The results: steady, measurable progress month over month.`,
    `Next: the partnership continues with new goals for the coming quarter.`,
  ].join("\n\n");
  const ai = await generateText(
    ws,
    "Write a short client case study (150-220 words) with sections Client, Challenge, Approach, Results. Use ONLY the facts and numbers provided; do not invent quotes, names or numbers. Plain text, section names on their own lines.",
    `Provider: ${ws.name}\nClient: ${client.name}\nService: ${service}\nPeriod: ${snap?.periodLabel ?? "recent months"}\nResults:\n${dataLines(snap)}`,
    900,
  ).catch(() => null);
  if (ai) return { title, body: ai, ai: true };
  return { title, body, ai: false };
}

export async function generateReferralRequest(ws: Row, client: Row, snap: ReportSnapshot | null): Promise<{ subject: string; body: string; ai: boolean }> {
  const wins = bestWins(snap);
  const contact = client.contact_name || client.name;
  const win = wins[0] ? ` Seeing ${wins[0].label.toLowerCase()} move ${fmtChange(wins[0].changePct)} last month was a real highlight for us.` : "";
  const subject = `A small favour, ${contact.split(" ")[0]}?`;
  const body = `Hi ${contact},\n\nThank you for another great month working together.${win}\n\nIf you know anyone who could use similar help, I'd be grateful for an introduction; simply reply to this email with their name or forward this message. No pressure at all, and thanks again for your trust.\n\nBest,\n${ws.name}`;
  const ai = await generateText(
    ws,
    "Write a short, warm referral request email body (under 110 words) from a freelancer to a happy client. Mention at most one real result from the data. Make it easy to say no. No pressure, no incentives unless provided. Output only the email body, starting with a greeting.",
    `Provider: ${ws.name}\nClient contact: ${contact}\nResults:\n${dataLines(snap)}`,
    400,
  ).catch(() => null);
  if (ai && checkTone(ai).ok) return { subject, body: ai, ai: true };
  return { subject, body, ai: false };
}
