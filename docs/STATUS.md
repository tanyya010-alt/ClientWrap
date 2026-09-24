# Milestone status

Status against the brief, as of this commit. "Verified" means covered by an automated test that passes in CI.

## Test suite

| Suite | What it covers |
|---|---|
| Unit (`tests/unit`) | Tier config and entitlements, reminder scheduling, quiet hours, tone guardrails, consent rules, CSV parsing and mapping, report math and narrative, crypto and signatures, no secrets in client code |
| Integration (`tests/integration`, real Postgres) | Cross-tenant RLS on every table; AppSumo webhook for **every event**, plus OAuth exchange and refund CSV; metrics webhook; Stripe workspace and billing webhooks; reminder job (stops on payment, pause, unsubscribe, quiet hours; SMS needs consent); job retries and dead-letter |
| E2E (`tests/e2e`, Playwright against a production build) | Onboarding → first wrap sent; demo workspace; AppSumo new user (3 steps) and existing user; upgrade/downgrade/deactivate/reactivate with correct limits; 24h refund block; admin lookup; webhook HMAC and idempotency; invoice → reminder → unsubscribe → mark paid; public, legal and help pages live |

## Definition of done

| Item | Status |
|---|---|
| New user onboards and sends a first report in < 15 min, unaided | ✅ Verified (`onboarding.spec.ts`, which also asserts elapsed time) |
| Purchase, redeem, correct limits, upgrade, downgrade, deactivate, reactivate | ✅ Verified (integration + e2e) |
| Cross-workspace access test passes | ✅ Verified (`rls.test.ts`) |
| Refund revokes access; export works | ✅ Verified (webhook deactivate + CSV reconciliation; export in read-only mode) |
| Reminders stop on payment; unsubscribe works | ✅ Verified (integration + e2e) |
| Pricing, legal pages, help center, changelog live | ✅ Verified (e2e page checks) |
| Reviewer accounts and README | ✅ `npm run db:seed`; credentials in README |

## Done

1. **Accounts:** email/password, Google sign-in, email verification, password reset, sessions, rate limits.
2. **Client portal:** signed no-login link, branding, mobile-first, rotate link, custom domain (Agency).
3. **Data intake:** manual entry, CSV import with mapping and error report, per-client webhook (HMAC, timestamp, idempotency, bearer fallback) with Zapier, Make and n8n snippets.
4. **Reports:** snapshot, change vs. last month, AI (BYO key) or built-in narrative, editable, PDF, share link, scheduled delivery.
5. **Invoices & payments:** PDF, Stripe Payment Links on the provider's own account, webhook plus hourly sync, receipts. Reminder sequence −3/+1/+7/+14/+30 with quiet hours, pause, unsubscribe, consent, tone guardrails and a full message log. WhatsApp/SMS behind `FEATURE_SMS_WHATSAPP`.
6. **Growth:** renewal suggestion (shown in the portal), case study with client approval before publishing, referral request.
7. **White-label:** branding removal, custom domain (DNS verify + optional Vercel attach), custom email sender (Resend domains).
8. **Onboarding:** 5-step guided setup, one-click demo workspace, 4 service templates plus "other", in-app help, support form.
9. **AppSumo licensing v2:** OAuth signup/login redemption, webhook for all 6 events, signature and freshness checks, idempotency, raw payload storage, pending redemptions, 30-day read-only, cleanup job, 24h refund block, refund CSV script plus admin upload, admin dashboard.
10. **Tiers & pricing:** single config file, public pricing page, Stripe checkout and customer portal, usage meters and fair-use caps, BYO keys.
11. **Trust:** forced RLS, encrypted secrets, rate limits, audit log, export (JSON/CSV zip), account deletion, cookie notice, Terms/Privacy/DPA/Cookies/AUP, health check, status page, error monitoring, daily backups.
12. **Launch docs:** `docs/launch/`.

## Built but needs your keys or accounts to run live (no code changes needed)

| Needed | Env vars | Unlocks |
|---|---|---|
| Resend account + verified `clientwrap.app` domain | `RESEND_API_KEY`, `EMAIL_FROM` | Real email delivery (dev uses `/dev/mailbox`), custom sender domains |
| Google OAuth client | `GOOGLE_CLIENT_ID/SECRET` | "Continue with Google" (the button explains when not configured) |
| AppSumo partner credentials | `APPSUMO_CLIENT_ID/SECRET/API_KEY` | Live redemption + webhooks |
| Stripe (platform) products & prices, webhook secret | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | Monthly/annual subscriptions (pricing page shows plans; checkout is disabled until set) |
| Postgres (Supabase/Neon) staging + production | `DATABASE_URL` (+ `DATABASE_MIGRATION_URL`) | Deploy |
| Vercel project + token | `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` | Auto-attaching verified custom domains |
| DNS | `app.` and `portal.clientwrap.app` | App + custom-domain CNAME target |
| Sentry project (optional) | `SENTRY_DSN` | External error alerts (errors are always stored in `error_events`) |
| S3/R2 bucket (+ optional GPG key) | `BACKUP_S3_URI`, AWS keys, `BACKUP_GPG_RECIPIENT` | Off-site daily backups |
| Crisp (optional) | `CRISP_WEBSITE_ID` | In-app chat bubble (the support form works without it) |

## Known limitations / decisions to confirm

- **Legal pages** are complete drafts naming "ClientWrap" as operator. Have counsel review them and add your legal entity name and address.
- **AppSumo payload fields**: implemented per Licensing API v2 (`license_key`, `prev_license_key`, `event`, `tier`, `license_status`, `extra.reason`, headers `X-Appsumo-Signature`/`X-Appsumo-Timestamp`). Confirm on the partner call, and use their "send test webhook" button; test payloads are acknowledged without changing licenses.
- **Pricing** follows the suggested tiers ($59/$149/$299 lifetime vs. $290/$590/$1,290 per year regular). Adjust in `src/lib/tiers.ts` after the AppSumo call; a unit test enforces that regular prices exceed lifetime prices.
- **Report periods** are calendar months in UTC; reminders and scheduled delivery use each client's timezone.
- **SMS/WhatsApp** are behind a feature flag until you've tested with a real Twilio account and approved WhatsApp templates.
