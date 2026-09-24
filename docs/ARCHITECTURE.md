# Architecture

## Overview

```
Browser ──► Next.js (App Router, Server Components + Server Actions)
              │  src/app/app/*        provider app (session cookie)
              │  src/app/p|pay|u|approve|cs/*   client-facing, signed-token pages (no login)
              │  src/app/api/*        webhooks, cron, exports, JSON API
              ▼
          src/lib/*  (domain logic, no framework code)
              │  withTenant()  → SET LOCAL ROLE cw_app  + app.user_id/app.workspace_id
              │  withService() → SET LOCAL ROLE cw_service (webhooks, jobs, auth, admin)
              ▼
          PostgreSQL (RLS forced on every table)
```

External services are all optional at runtime except Postgres. Without them, features fall back gracefully: emails go to an outbox (dev only), AI summaries use the built-in writer, and invoices show payment instructions instead of a Stripe button.

## Security model

| Concern | Implementation |
|---|---|
| Tenant isolation | `migrations/001_init.sql`: every table has `ENABLE` **and** `FORCE ROW LEVEL SECURITY`. Tenant tables allow `cw_app` only rows where `workspace_id = app.workspace_id()`. The connection role itself (table owner) has no policy, so code that bypasses the helpers sees **nothing** (fails closed). |
| Proof | `tests/integration/rls.test.ts` seeds one row in every tenant table for workspace B and asserts workspace A reads, updates, deletes and inserts none of them. It also checks that every table has RLS forced and that service-only tables are denied to tenants. |
| Licenses | Tenants have `SELECT` on their own licenses only; no insert/update grants. Only `applyLicenseEvent()` (called from the AppSumo webhook or the refund-CSV replay) changes license state. |
| Secrets at rest | AES-256-GCM (`src/lib/crypto.ts`) for AI keys, Stripe keys and webhook secrets, Twilio tokens and webhook signing secrets. |
| Secrets in client code | `tests/unit/security.test.ts` fails if any `"use client"` file imports server modules or reads non-public env vars. |
| Signed links | Portal, pay, unsubscribe and case-study approval links are HMAC-signed and purpose-bound (`signedToken(value, purpose)`); portal links can be rotated/revoked. |
| Rate limiting | Postgres fixed-window limiter (`src/lib/ratelimit.ts`) on login (per IP + per email), signup, password reset, license redemption, exports, and all webhooks. |
| Passwords | scrypt (N=2^15), constant-time compare, dummy hash on unknown users (no enumeration). |
| Audit log | `audit_log`: account, client, invoice, report, consent, license, admin actions (append-only for tenants). |
| Headers | HSTS, nosniff, frame-options, referrer and permissions policies (`next.config.ts`). |

## Data model

All tenant tables carry `workspace_id`. Identity/licensing tables are keyed by `user_id`.

- `users`, `sessions`, `auth_tokens` (email verification, password reset)
- `workspaces`: the provider's business (branding, quiet hours, BYO integrations, white-label). One per account.
- `clients`: "client workspaces" (plan-limited), with `metric_config` (label/unit/aggregation/direction per metric)
- `portal_links`, `webhook_secrets`, `metric_events (client_id, metric, value, unit, occurred_at, source, idempotency_key)`, `csv_imports`
- `reports (client_id, period, data_snapshot, narrative, next_step, status, sent_at)`
- `invoices`, `invoice_items`, `payments`
- `reminder_rules`, `message_log` (every send/skip/failure; unique `(invoice_id, step_key)` for sent reminders), `consent_records`
- `case_studies`, `renewal_suggestions`, `usage_counters`, `audit_log`
- `licenses (license_key, tier, status, user_id, …)`, `license_events` (every raw payload), `pending_redemptions`, `subscriptions`, `stripe_events`
- `jobs` (queue + dead letter), `rate_limits`, `email_outbox`, `support_tickets`, `error_events`

## Tiers and feature gates

`src/lib/tiers.ts` is the single config file for plans, AppSumo tier mapping, limits and features. `resolveEntitlement()` derives the effective plan from licenses and subscriptions. The highest active one wins; a deactivated license means read-only for 30 days, then expired. Every gate calls `assertFeature()`, `assertWritable()`, `consumeUsage()` or `assertClientCapacity()`, and each throws a `LimitError` whose message names the plan that unlocks it.

## AppSumo licensing (v2)

- **Webhook** `POST /api/webhooks/appsumo`: verifies `X-Appsumo-Signature = HMAC_SHA256(API_KEY, timestamp + body)` and rejects timestamps more than 5 minutes off. It stores the raw payload (`license_events`, deduped by hash, so replays are no-ops), then applies the state machine:
  - `purchase` → license row (`inactive` unless AppSumo says active)
  - `activate` → `active` (also reactivates a deactivated license)
  - `upgrade` / `downgrade` / `migrate` → new key active with the new tier; previous key `deactivated` + `superseded_by`; owner carried over
  - `deactivate` → `deactivated`, marked refunded, owner blocked from redeeming for 24 h; data read-only for 30 days, then `licenses.cleanup` purges client data
  - `test: true` payloads are acknowledged and stored but don't change licenses
- **OAuth** `GET /api/appsumo/oauth?code=`: code → token → `license_key`. If the user is logged in, the license is linked immediately. Otherwise it goes into a signed cookie, then to `/appsumo`, then signup/login, where it's linked automatically (3 steps). If OAuth beats the webhook, a `pending_redemptions` row links it when the webhook arrives.
- **No expiry** of unredeemed licenses (≥ 60-day redemption window) and no date-based shutdown of these endpoints (they keep working after delisting).
- **Refund CSV** `npm run appsumo:reconcile` or `/admin`: replays `deactivate` through the same state machine.

## Jobs

`src/lib/jobs/queue.ts`: `jobs` table with `dedupe_key` (unique → idempotent enqueue), `FOR UPDATE SKIP LOCKED` claiming, exponential backoff, `max_attempts`, then `dead` (dead-letter, retryable from `/admin/jobs`, reported to error monitoring).
`tick()` (every 5 min via Vercel Cron or `npm run worker`) enqueues:

| Job | Schedule | Notes |
|---|---|---|
| `reminders.scan` → `reminders.invoice` | every 15 min | per-invoice advisory lock; client-timezone quiet hours; one message per step; stale steps superseded; stops on paid/void/pause/unsubscribe |
| `reports.scan` → `reports.monthly` | hourly | on the client's report day (≥ 08:00 local); auto-send or email the provider a draft |
| `invoices.sync` | hourly | Stripe fallback in case a payment webhook was missed |
| `licenses.cleanup` | daily | purge client data 30 days after deactivation |
| `housekeeping` | daily | expire sessions, tokens, rate-limit windows, old jobs |
| `appsumo.reconcile` | on demand | CSV reconciliation |

## Messaging guardrails

`src/lib/messaging.ts` is the only path to clients. It checks the recipient, **consent** (email: not unsubscribed; SMS/WhatsApp: explicit consent record), **tone** (`src/lib/tone.ts`: no legal, credit or criminal threats, collections language, insults, profanity, shouting or "!!!"), feature flag and plan, fair-use quota, and demo clients. It appends the unsubscribe link plus `List-Unsubscribe`/one-click headers, and logs the outcome (sent/failed/skipped + reason) in `message_log`. WhatsApp sends only approved Twilio Content templates.

## Observability

- `error_events` table (viewable in `/admin/jobs`) + optional Sentry via `SENTRY_DSN`
- `/api/health` (DB + job lag) and public `/status` page
- Full `audit_log` and `message_log`
