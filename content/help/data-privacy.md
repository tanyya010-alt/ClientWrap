---
title: Data export, deletion & security
description: Export everything, delete your account, and how your data is protected.
order: 12
---
# Data export, deletion & security

## Export
**Settings → Data & privacy → Export JSON** (one file) or **Export CSV (zip)** (one CSV per table). Includes clients, results, reports, invoices, payments, reminders, message log, consent records and audit log. Export works even when your account is read-only.

## Delete your account
**Settings → Data & privacy → Delete account**. Type your email to confirm. This permanently deletes your account, workspace and all client data immediately. AppSumo licenses are unlinked (not refunded).

## Security
- Every database table uses **row-level security**: one workspace can never read another's data, and an automated test proves it on every release.
- API keys, webhook secrets, Stripe and Twilio credentials are **encrypted at rest** (AES-256-GCM).
- Login and webhooks are **rate-limited**; passwords are hashed with scrypt.
- Client links, pay links and unsubscribe links are cryptographically signed.
- Every important action is recorded in your **audit log** (Settings → Audit log).
- Daily encrypted database backups; see the [status page](/status) for live health.

See our [Privacy Policy](/legal/privacy) and [DPA](/legal/dpa).
