---
title: White-label, custom domain & email sender
description: Remove ClientWrap branding and use your own domain and sender (Agency plan).
order: 8
---
# White-label (Agency plan)

All settings are in **Settings → White-label**.

## Remove ClientWrap branding
Tick **Remove "Powered by ClientWrap"** to remove product branding from client pages, emails and PDFs.

## Custom portal domain
1. Enter a subdomain you own, e.g. `results.youragency.com`, and save.
2. At your DNS provider add the two records shown:
   - `CNAME results.youragency.com → portal.clientwrap.app`
   - `TXT _clientwrap.results.youragency.com → cw-verify-…`
3. Click **Verify**. DNS can take up to an hour. Once verified, all client links use your domain (HTTPS is automatic).

## Custom email sender
1. Enter the address you want to send from, e.g. `reports@youragency.com`.
2. Add the DNS records shown (SPF/DKIM) at your DNS provider.
3. Click **Verify**. From then on, client emails come from your address.

Until verified, emails are sent as "*Your business* via ClientWrap" with replies going to your reply-to address.
