---
title: Metrics webhook (Zapier, Make, n8n)
description: Send results automatically with a signed, idempotent webhook.
order: 5
---
# Metrics webhook

Each client can have its own webhook URL and signing secret (Solo plan and up). Open a client → **Results data** → **Create webhook**. The page has copy-paste snippets for **Zapier**, **Make**, **n8n** (importable workflow JSON) and **cURL**, with your URL and secret filled in.

## Request
`POST https://app.clientwrap.app/api/ingest/<token>` with a JSON body:

```json
{ "metric": "leads", "value": 42, "unit": "leads", "timestamp": "2026-09-01T00:00:00Z", "idempotency_key": "crm-2026-09-01" }
```

- `metric` (required): name, e.g. "Organic sessions". New metrics are added to the client automatically.
- `value` (required): number (strings like "1,200" are accepted).
- `unit` (optional), `timestamp` (optional, defaults to now; ISO date, `YYYY-MM`, or unix seconds).
- Batch up to 500 events: `{"events": [ {...}, {...} ]}`.

## Authentication
Preferred: sign every request.

```
X-ClientWrap-Timestamp: <unix seconds>
X-ClientWrap-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" using your secret>
```

Requests older than 5 minutes are rejected (protects against replays). Tools that can't compute an HMAC may send `Authorization: Bearer <secret>` instead (HTTPS only).

## Idempotency
Send an `Idempotency-Key` header (single event) or `idempotency_key` per event. Retries with the same key are accepted but stored once. The response tells you how many were `accepted` vs `duplicates`.

## Responses
| Status | Meaning |
|---|---|
| 200 | `{accepted, duplicates, rejected, errors[]}` |
| 400 | invalid JSON or no valid events (errors listed) |
| 401 | bad or missing signature / secret, or old timestamp |
| 402 | plan doesn't include the webhook, account read-only, or monthly fair-use limit reached |
| 404 | unknown or revoked URL |
| 429 | more than 600 requests per minute; batch events instead |

**Regenerate secret** immediately invalidates the old URL and secret.
