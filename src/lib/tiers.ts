/**
 * THE single source of truth for plans, limits and feature gates.
 * Every feature gate in the app calls can()/limit() with an Entitlement that is derived
 * from the license tier (AppSumo) or Stripe subscription — never from ad-hoc checks.
 */

export type PlanKey = "free" | "solo" | "growth" | "agency";

export type Feature =
  | "client_portal"
  | "monthly_reports"
  | "ai_summary"
  | "pdf_export"
  | "scheduled_reports"
  | "csv_import"
  | "metrics_webhook"
  | "invoices"
  | "stripe_pay_links"
  | "email_reminders"
  | "renewal_generator"
  | "case_study_generator"
  | "referral_requests"
  | "sms_whatsapp"
  | "white_label"
  | "custom_domain"
  | "custom_email_sender";

export interface PlanDef {
  key: PlanKey;
  name: string;
  tagline: string;
  /** AppSumo tier that maps to this plan (null = not sold on AppSumo). */
  appsumoTier: number | null;
  appsumoLifetimePriceUsd: number | null;
  monthlyPriceUsd: number | null;
  annualPriceUsd: number | null;
  limits: {
    clients: number;
    emailsPerMonth: number;
    webhookEventsPerMonth: number;
    aiGenerationsPerMonth: number;
    smsPerMonth: number;
  };
  features: Feature[];
  /** Features listed on the pricing page as new at this plan (for "at least three plan-specific features"). */
  highlights: string[];
}

const BASE: Feature[] = ["client_portal", "monthly_reports", "ai_summary", "pdf_export", "invoices", "csv_import"];
const SOLO: Feature[] = [...BASE, "scheduled_reports", "metrics_webhook", "stripe_pay_links", "email_reminders"];
const GROWTH: Feature[] = [...SOLO, "renewal_generator", "case_study_generator", "referral_requests", "sms_whatsapp"];
const AGENCY: Feature[] = [...GROWTH, "white_label", "custom_domain", "custom_email_sender"];

export const PLANS: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    name: "Free",
    tagline: "Try ClientWrap with one client.",
    appsumoTier: null,
    appsumoLifetimePriceUsd: null,
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    limits: { clients: 1, emailsPerMonth: 50, webhookEventsPerMonth: 500, aiGenerationsPerMonth: 10, smsPerMonth: 0 },
    features: BASE,
    highlights: ["1 client workspace", "Branded client portal", "Monthly report with PDF export"],
  },
  solo: {
    key: "solo",
    name: "Solo",
    tagline: "For solo consultants and freelancers.",
    appsumoTier: 1,
    appsumoLifetimePriceUsd: 59,
    monthlyPriceUsd: 29,
    annualPriceUsd: 290,
    limits: { clients: 5, emailsPerMonth: 1000, webhookEventsPerMonth: 20000, aiGenerationsPerMonth: 200, smsPerMonth: 0 },
    features: SOLO,
    highlights: [
      "5 client workspaces",
      "Scheduled monthly report delivery",
      "Automatic email payment reminders",
      "Stripe pay links with status sync",
      "Metrics webhook (n8n, Make, Zapier)",
    ],
  },
  growth: {
    key: "growth",
    name: "Growth",
    tagline: "For growing studios that want renewals and referrals.",
    appsumoTier: 2,
    appsumoLifetimePriceUsd: 149,
    monthlyPriceUsd: 59,
    annualPriceUsd: 590,
    limits: { clients: 15, emailsPerMonth: 3000, webhookEventsPerMonth: 60000, aiGenerationsPerMonth: 600, smsPerMonth: 1000 },
    features: GROWTH,
    highlights: [
      "15 client workspaces",
      "Renewal-suggestion generator",
      "Case-study drafts with client approval",
      "Referral-request messages",
      "WhatsApp & SMS reminders (your Twilio)",
    ],
  },
  agency: {
    key: "agency",
    name: "Agency",
    tagline: "For agencies that resell under their own brand.",
    appsumoTier: 3,
    appsumoLifetimePriceUsd: 299,
    monthlyPriceUsd: 129,
    annualPriceUsd: 1290,
    limits: { clients: 40, emailsPerMonth: 8000, webhookEventsPerMonth: 150000, aiGenerationsPerMonth: 1500, smsPerMonth: 3000 },
    features: AGENCY,
    highlights: [
      "40 client workspaces",
      "White-label: remove ClientWrap branding",
      "Custom portal domain",
      "Custom email sender domain",
    ],
  },
};

export const PAID_PLANS: PlanKey[] = ["solo", "growth", "agency"];
export const PLAN_ORDER: PlanKey[] = ["free", "solo", "growth", "agency"];

export function planForAppsumoTier(tier: number): PlanKey {
  if (tier >= 3) return "agency";
  if (tier === 2) return "growth";
  return "solo";
}

export type AccessMode = "full" | "readonly" | "expired";

export interface Entitlement {
  plan: PlanKey;
  source: "free" | "appsumo" | "stripe";
  mode: AccessMode;
  /** When mode is readonly because of a deactivated license: when data will be removed. */
  readonlyUntil?: string;
  licenseKey?: string;
}

export const READONLY_GRACE_DAYS = 30;
export const REFUND_REPURCHASE_BLOCK_HOURS = 24;
export const REDEMPTION_WINDOW_DAYS = 60; // minimum; we never expire unredeemed licenses.

export function can(ent: Entitlement, feature: Feature): boolean {
  return PLANS[ent.plan].features.includes(feature);
}

export function limit(ent: Entitlement, key: keyof PlanDef["limits"]): number {
  return PLANS[ent.plan].limits[key];
}

export function requiredPlanFor(feature: Feature): PlanKey {
  for (const k of PLAN_ORDER) if (PLANS[k].features.includes(feature)) return k;
  return "agency";
}

export const FEATURE_LABELS: Record<Feature, string> = {
  client_portal: "Branded client portal",
  monthly_reports: "Monthly reports",
  ai_summary: "AI-written summary (your API key)",
  pdf_export: "PDF export",
  scheduled_reports: "Scheduled report delivery",
  csv_import: "CSV import",
  metrics_webhook: "Metrics webhook",
  invoices: "Invoices",
  stripe_pay_links: "Stripe pay links",
  email_reminders: "Email payment reminders",
  renewal_generator: "Renewal-suggestion generator",
  case_study_generator: "Case-study generator",
  referral_requests: "Referral requests",
  sms_whatsapp: "WhatsApp & SMS reminders",
  white_label: "White-label",
  custom_domain: "Custom domain",
  custom_email_sender: "Custom email sender",
};

export class LimitError extends Error {
  constructor(
    message: string,
    public upgradeTo: PlanKey | null,
  ) {
    super(message);
  }
}

export function featureError(feature: Feature): LimitError {
  const need = requiredPlanFor(feature);
  return new LimitError(
    `${FEATURE_LABELS[feature]} is available on the ${PLANS[need].name} plan and above.`,
    need,
  );
}

/**
 * Resolve the effective entitlement from license + subscription rows.
 * Pure function so it is fully unit-testable.
 */
export function resolveEntitlement(input: {
  licenses: { license_key: string; tier: number; status: string; deactivated_at: string | Date | null; superseded_by?: string | null }[];
  subscriptions: { plan: string; status: string; current_period_end: string | Date | null }[];
  now?: Date;
}): Entitlement {
  const now = input.now ?? new Date();
  const candidates: Entitlement[] = [];

  for (const l of input.licenses) {
    if (l.status === "active" && !l.superseded_by) {
      candidates.push({ plan: planForAppsumoTier(l.tier), source: "appsumo", mode: "full", licenseKey: l.license_key });
    }
  }
  for (const s of input.subscriptions) {
    const ok = ["active", "trialing", "past_due"].includes(s.status);
    if (ok && PAID_PLANS.includes(s.plan as PlanKey)) {
      candidates.push({ plan: s.plan as PlanKey, source: "stripe", mode: "full" });
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => PLAN_ORDER.indexOf(b.plan) - PLAN_ORDER.indexOf(a.plan));
    return candidates[0];
  }

  // No paid access. If a license was deactivated, keep data read-only for the grace window.
  const deactivated = input.licenses
    .filter((l) => l.status === "deactivated" && l.deactivated_at && !l.superseded_by)
    .sort((a, b) => new Date(b.deactivated_at!).getTime() - new Date(a.deactivated_at!).getTime())[0];
  if (deactivated) {
    const until = new Date(new Date(deactivated.deactivated_at!).getTime() + READONLY_GRACE_DAYS * 86400_000);
    return {
      plan: planForAppsumoTier(deactivated.tier),
      source: "appsumo",
      mode: until > now ? "readonly" : "expired",
      readonlyUntil: until.toISOString(),
      licenseKey: deactivated.license_key,
    };
  }
  return { plan: "free", source: "free", mode: "full" };
}
