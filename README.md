# ClientWrap

> Wrap up every client's month: results, invoices and next steps in one link.

ClientWrap is a self-serve web app for people who sell services (solo consultants, freelancers, new agency owners). Each client gets one private, branded link with:

- **monthly results** in the client's own units,
- **invoices** with a pay button (on the provider's own Stripe) and a friendly automatic reminder sequence, and
- a **suggested next step** for renewal.

The same data produces case-study drafts (published only after the client approves) and referral requests.

---

## For AppSumo reviewers

Log in at `/login` with any account below. The password for all of them is **`Review-ClientWrap-2026`** (or the `REVIEWER_PASSWORD` set when the database was seeded).

| Account | Plan | What's inside |
|---|---|---|
| `reviewer+free@clientwrap.app` | Free (no license) | 1 coaching client with 7 months of results, invoices and a sent report |
| `reviewer+tier1@clientwrap.app` | **AppSumo Tier 1 (Solo)**: 5 clients | 3 clients, sent reports, open, overdue and paid invoices, reminder schedule |
| `reviewer+tier2@clientwrap.app` | **AppSumo Tier 2 (Growth)**: 15 clients | 6 clients, a published client-approved case study, renewal suggestions, SMS consent record |
| `reviewer+tier3@clientwrap.app` | **AppSumo Tier 3 (Agency)**: 40 clients | 9 clients, white-label on (no ClientWrap branding in portals, emails or PDFs) |
| `reviewer+admin@clientwrap.app` | Tier 3 + **support admin** | `/admin`: license lookup, webhook history, jobs, errors, refund-CSV reconciliation |

**Unredeemed licenses for testing redemption:** `REVIEW-SPARE-T1`, `REVIEW-SPARE-T2`, `REVIEW-SPARE-T3`. Create a new account, open **Plan & usage** and paste one. (Each can be redeemed once. The admin search `REVIEW` lists them all.)

Things to try:

1. **Onboarding:** sign up with a fresh email and follow the 5-step guided setup, or click **Load demo workspace**.
2. **Client portal:** open a client, then **Copy link / Open** under "Client results page". No login is needed and it is mobile-friendly.
3. **Report:** open a client → generate a wrap → edit → **Send a test to me** → **Download PDF**.
4. **Invoices & reminders:** **Invoices → New invoice**; see the reminder schedule and message log on the invoice page.
5. **Data intake:** a client's **Results data** tab has manual entry, CSV import with mapping and an error report, and a webhook with Zapier, Make and n8n snippets.
6. **Growth (Tier 2+):** **Growth** has the renewal suggestion, case study with client approval, and referral request.
7. **White-label (Tier 3):** **Settings → White-label** has branding removal, a custom domain and a custom email sender.

---

## Stack

- **Next.js 15** (App Router, Server Actions) + **TypeScript**, Tailwind CSS 4
- **PostgreSQL** (works on Supabase, Neon or RDS) with **row-level security forced on every table**
- **Stripe** (platform subscriptions + the provider's own account for invoice pay links), **Resend** (email), **Twilio** (SMS/WhatsApp, bring your own), **Anthropic/OpenAI** (AI summaries, bring your own key)
- Postgres-backed **job queue** (idempotent jobs, retries with backoff, dead-letter queue), driven by Vercel Cron → `/api/cron` or `npm run worker`
- **Vitest** (unit + integration against real Postgres), **Playwright** (end-to-end)

Why custom auth instead of Supabase Auth: it keeps the app portable to any Postgres, and every query runs under a restricted DB role with RLS (details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Local development

```bash
# Postgres 15+ with a role that can create roles (migrations create cw_app / cw_service)
createuser --createrole --createdb -P clientwrap      # password: clientwrap
createdb -O clientwrap clientwrap_dev
createdb -O clientwrap clientwrap_test               # for npm test

cp .env.example .env   # fill APP_SECRET and ENCRYPTION_KEY (see comments)
npm install
npm run db:migrate
npm run db:seed        # reviewer accounts + demo data
npm run dev            # http://localhost:3000
npm run worker         # (optional) background jobs locally; or GET /api/cron with the CRON_SECRET
```

Without `RESEND_API_KEY`, every email is captured in the database and viewable at **`/dev/mailbox`** (disabled in production).

## Tests

```bash
npm run typecheck
npm test               # unit + integration (tier limits, reminders, CSV, reports, crypto,
                       # cross-tenant RLS, AppSumo every event, metrics webhook, Stripe webhooks, jobs)
npm run build && npm run test:e2e   # Playwright: onboarding → first wrap, AppSumo redemption
                                    # (new + existing user, upgrade/downgrade/deactivate/reactivate),
                                    # refund cooldown, admin lookup, webhook/invoice/reminder/unsubscribe
```

CI (`.github/workflows/ci.yml`) runs migrations (fresh plus re-run), typecheck, all tests, build and Playwright on every push and PR.

## Scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Apply SQL migrations in `migrations/` (tracked in `schema_migrations`) |
| `npm run db:seed` | Reviewer accounts for every tier + spare licenses (licenses are created via signed webhook payloads) |
| `npm run worker` | Long-running job worker (alternative to Vercel Cron) |
| `npm run appsumo:reconcile -- file.csv [--dry-run]` | Import AppSumo's refunded/redeemed-codes CSV; revoke refunded licenses (also in `/admin`) |
| `npm run backup` | `pg_dump` backup (optional GPG encryption and S3 upload); runs daily via `.github/workflows/backup.yml` |

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for staging/production on Vercel + Supabase/Neon, webhooks, DNS and backups.

## Project docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): data model, security model, jobs, licensing state machine
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): environments, env vars, webhooks, cron, backups, monitoring
- [docs/STATUS.md](docs/STATUS.md): milestone report (what's done, what needs keys/DNS/accounts)
- [docs/launch/](docs/launch): landing copy, 2-minute demo script, screenshot shot list, FAQ, comparison, AppSumo deal-page copy, "From the founders" post
