/**
 * Server-side environment access. Nothing in this module may be imported by client components:
 * secrets are only ever read on the server.
 */
// Server-only module: tests/unit/no-client-secrets.test.ts enforces that client components never import it.

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const env = {
  get NODE_ENV() {
    return process.env.NODE_ENV ?? "development";
  },
  get APP_URL() {
    return (opt("APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get DATABASE_URL() {
    const v = opt("DATABASE_URL");
    if (!v) throw new Error("DATABASE_URL is not set");
    return v;
  },
  get APP_SECRET() {
    const v = opt("APP_SECRET");
    if (!v) {
      if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET is not set");
      return "dev-only-app-secret-change-me-dev-only-app-secret";
    }
    return v;
  },
  /** 32-byte key, base64 or hex. Used for AES-256-GCM encryption of secrets at rest. */
  get ENCRYPTION_KEY() {
    const v = opt("ENCRYPTION_KEY");
    if (!v) {
      if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY is not set");
      return "ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE="; // "dev-only-encryption-key-32bytes!"
    }
    return v;
  },
  get CRON_SECRET() {
    return opt("CRON_SECRET");
  },
  get ADMIN_EMAILS() {
    return (opt("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  },
  get SUPPORT_EMAIL() {
    return opt("SUPPORT_EMAIL") ?? "support@clientwrap.app";
  },
  // Email
  get RESEND_API_KEY() {
    return opt("RESEND_API_KEY");
  },
  get EMAIL_FROM() {
    return opt("EMAIL_FROM") ?? "ClientWrap <hello@clientwrap.app>";
  },
  // Google sign-in
  get GOOGLE_CLIENT_ID() {
    return opt("GOOGLE_CLIENT_ID");
  },
  get GOOGLE_CLIENT_SECRET() {
    return opt("GOOGLE_CLIENT_SECRET");
  },
  // Platform Stripe (our own subscriptions)
  get STRIPE_SECRET_KEY() {
    return opt("STRIPE_SECRET_KEY");
  },
  get STRIPE_WEBHOOK_SECRET() {
    return opt("STRIPE_WEBHOOK_SECRET");
  },
  stripePrice(plan: string, interval: "month" | "year") {
    return opt(`STRIPE_PRICE_${plan.toUpperCase()}_${interval === "month" ? "MONTHLY" : "ANNUAL"}`);
  },
  // AppSumo Licensing v2
  get APPSUMO_CLIENT_ID() {
    return opt("APPSUMO_CLIENT_ID");
  },
  get APPSUMO_CLIENT_SECRET() {
    return opt("APPSUMO_CLIENT_SECRET");
  },
  get APPSUMO_API_KEY() {
    return opt("APPSUMO_API_KEY");
  },
  get APPSUMO_BASE_URL() {
    return (opt("APPSUMO_BASE_URL") ?? "https://appsumo.com").replace(/\/$/, "");
  },
  // Feature flags
  get FEATURE_SMS_WHATSAPP() {
    return opt("FEATURE_SMS_WHATSAPP") === "true";
  },
  // Observability
  get SENTRY_DSN() {
    return opt("SENTRY_DSN");
  },
  // Custom domains
  get CUSTOM_DOMAIN_CNAME_TARGET() {
    return opt("CUSTOM_DOMAIN_CNAME_TARGET") ?? "portal.clientwrap.app";
  },
  get VERCEL_TOKEN() {
    return opt("VERCEL_TOKEN");
  },
  get VERCEL_PROJECT_ID() {
    return opt("VERCEL_PROJECT_ID");
  },
  get VERCEL_TEAM_ID() {
    return opt("VERCEL_TEAM_ID");
  },
  get CRISP_WEBSITE_ID() {
    return opt("CRISP_WEBSITE_ID");
  },
};

export const isProd = () => env.NODE_ENV === "production";
