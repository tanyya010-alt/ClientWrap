# Deployment

Recommended: **Vercel** (Next.js + Cron) + **Supabase or Neon Postgres** + **Resend**. Any Node 20+ host works; use `npm run worker` instead of Vercel Cron if you self-host.

## Environments

| | Staging | Production |
|---|---|---|
| Branch / trigger | `main` (auto-deploy) | tag `v*` (migrations run by `.github/workflows/release.yml` after a backup) |
| Database | separate project (e.g. `clientwrap-staging`) | `clientwrap-prod` |
| Stripe | test mode keys | live keys |
| AppSumo | partner test webhooks | live |
| `APP_URL` | `https://staging.clientwrap.app` | `https://app.clientwrap.app` |

GitHub environment secrets: `STAGING_DATABASE_URL`, `PRODUCTION_DATABASE_URL`, `BACKUP_S3_URI`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`.

## 1. Database
1. Create a Postgres 15+ database. Use a role that owns the schema and has `CREATEROLE` (on Supabase: the `postgres` role).
2. `DATABASE_URL=... npm run db:migrate`. This creates the `cw_app`/`cw_service` roles and all RLS policies.
3. `npm run db:seed` on staging (and on production only if you want the reviewer accounts there, which AppSumo needs).
4. Set `DATABASE_SSL=true` for managed providers. On Supabase use the pooled URL for `DATABASE_URL` and the direct URL for `DATABASE_MIGRATION_URL`.

## 2. App (Vercel)
- Import the repo and set every variable from `.env.example` (generate `APP_SECRET`, `ENCRYPTION_KEY` and `CRON_SECRET` with `openssl rand -base64 32/48`).
- `vercel.json` registers the cron (`/api/cron` every 5 minutes); Vercel sends `Authorization: Bearer $CRON_SECRET`.
- **Never rotate `ENCRYPTION_KEY`** without re-encrypting stored secrets (users would need to re-enter keys).

## 3. Webhooks & OAuth to configure
| Service | URL | Events |
|---|---|---|
| AppSumo webhook | `https://app.clientwrap.app/api/webhooks/appsumo` | all license events |
| AppSumo OAuth redirect | `https://app.clientwrap.app/api/appsumo/oauth` | |
| Stripe (platform) | `https://app.clientwrap.app/api/webhooks/stripe-billing` | `customer.subscription.created/updated/deleted` |
| Google OAuth redirect | `https://app.clientwrap.app/api/auth/google/callback` | scopes `openid email profile` |
| Provider Stripe accounts | registered automatically per workspace at `/api/webhooks/stripe/<workspaceId>` | `checkout.session.completed`, `checkout.session.async_payment_succeeded` |

Stripe platform products: create prices for Solo/Growth/Agency monthly and annual and put the IDs in `STRIPE_PRICE_*`. Enable the Stripe customer portal.

## 4. DNS
- `app.clientwrap.app` → Vercel.
- `portal.clientwrap.app` → Vercel (target for customers' custom-domain CNAMEs; `CUSTOM_DOMAIN_CNAME_TARGET`).
- Resend: verify the `clientwrap.app` sending domain (SPF, DKIM, DMARC).
- Set `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` so verified customer domains are attached automatically (TLS issued by Vercel).

## 5. Backups & monitoring
- `.github/workflows/backup.yml` runs `scripts/backup.sh` daily (encrypted if `BACKUP_GPG_RECIPIENT` is set, uploaded to S3/R2). Supabase/Neon point-in-time recovery is recommended in addition.
- Restore drill: `pg_restore --clean --no-owner -d $TARGET_URL clientwrap-<stamp>.dump`.
- Errors: `SENTRY_DSN`; also stored in `error_events` (`/admin/jobs`).
- Uptime: point an uptime monitor at `/api/health` (returns 503 when the DB is down).

## 6. Feature flags
- `FEATURE_SMS_WHATSAPP=true` turns on SMS/WhatsApp reminders for Growth+ (users bring their own Twilio account and approved WhatsApp templates).

## After AppSumo delisting
Keep `/api/webhooks/appsumo` and `/api/appsumo/oauth` deployed with valid `APPSUMO_*` keys for at least 3 months (nothing in the code disables them by date).
