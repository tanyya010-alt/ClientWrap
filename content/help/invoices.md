---
title: Invoices, payments & reminders
description: Stripe pay links, status sync and a friendly reminder sequence.
order: 6
---
# Invoices, payments & reminders

## Create and send
**Invoices → New invoice**: choose the client, due date, currency and line items, then **Save & send**. The client gets an email with the PDF and a **View & pay** link. Invoice numbers are sequential (`INV-0001`…).

## Getting paid with Stripe
ClientWrap uses **your own Stripe account**; money goes straight to you. In **Settings → Integrations → Stripe**:

1. In Stripe, open *Developers → API keys → Create restricted key*.
2. Give it **Write** access to *Prices*, *Payment Links* and *Webhook Endpoints*, and **Read** access to *Checkout Sessions*.
3. Paste the key (it starts with `rk_live_`) and click **Connect**.

Each sent invoice gets a single-use Stripe Payment Link. When the client pays, Stripe notifies ClientWrap, the invoice is marked **paid**, a receipt is emailed, and **all reminders stop**. An hourly check also catches payments if a notification was missed.

No Stripe? Add bank-transfer details under **Settings → Business → Payment instructions**, and use **Mark as paid** when money arrives.

## Automatic reminders (Solo plan and up)
Default sequence: **3 days before** the due date, then **1, 7, 14 and 30 days after**. Edit it in **Settings → Reminders**.

- Reminders stop when the invoice is paid or voided, when you **pause** a client (Client settings), or when the client clicks **Unsubscribe**.
- They're sent only outside **quiet hours** in the client's timezone (default 20:00–08:00, no weekends).
- Only one reminder is ever sent per step, and older missed steps are skipped instead of sent in a burst.
- Every message includes an unsubscribe link.
- **Tone guardrails**: templates are friendly and professional. Custom wording is checked, and threats, legal or debt-collection language, insults, shouting and profanity are rejected. ClientWrap is not a debt-collection tool.

## WhatsApp & SMS (Growth plan, when enabled)
Connect your own Twilio account under **Settings → Integrations**. SMS/WhatsApp messages go only to clients with a recorded **consent** (Client settings → Messaging consent). WhatsApp requires a WhatsApp-approved template: paste its Content SID (`HX…`) on the reminder step.

## Message log
**Message log** lists every email/SMS/WhatsApp sent or skipped, with the reason (e.g. "Client unsubscribed").
