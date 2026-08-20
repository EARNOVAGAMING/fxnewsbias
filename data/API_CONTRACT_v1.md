# FXNewsBias Public API - Contract v1 (frozen 2026-08-21)

This document is the authoritative contract for the Sandbox tier. Nothing in a
`/v1` response may change shape or semantics; breaking changes require a new
`/v2` path. Additive changes (new OPTIONAL response fields) are permitted but
discouraged.

## Authentication

```
Authorization: Bearer fxnb_live_<64 hex chars>
```

- Header only. Keys are never accepted in the URL or query string.
- Keys are issued per email via `POST /api/keys` and delivered **by email
  only** - the raw key is never returned in an HTTP response and only its
  SHA-256 hash is stored server-side.
- Requesting a new key for the same email revokes the previous one
  (self-service rotation).

## Endpoint

```
GET https://fxnewsbias.com/api/v1/sentiment
```

### 200 response (application/json)

```json
{
  "schema": "fxnb.sentiment.v1",
  "generated_at": "2026-08-21T09:00:12Z",
  "next_update_expected": "2026-08-21T12:00:00Z",
  "attribution": {
    "required": true,
    "text": "Data by FXNewsBias",
    "url": "https://fxnewsbias.com"
  },
  "data": [
    { "currency": "USD", "score": 72, "bias": "Bullish",
      "updated_at": "2026-08-21T09:00:00Z" }
  ]
}
```

### Frozen semantics

| Field | Contract |
|---|---|
| `schema` | Always `"fxnb.sentiment.v1"` on this path |
| `data` | Always exactly 8 rows, ordered `USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD` |
| `data[].currency` | One of the 8 codes above |
| `data[].score` | Integer **0-100**; 50 is the neutral midpoint |
| `data[].bias` | Exactly one of `Bullish`, `Bearish`, `Neutral` |
| `data[].updated_at` | ISO-8601 UTC - when this score was computed |
| `generated_at` | ISO-8601 UTC - server time of this response |
| `next_update_expected` | ISO-8601 UTC - next scheduled 3-hour refresh cycle |
| `attribution` | Fixed server-side; consumers displaying or republishing the data must retain it. Never derived from client input |

Scores refresh every **3 hours** (00:00, 03:00, … UTC). Polling more often
than that returns the same values - expected behaviour, not an error.

Query parameters are **ignored**. This endpoint exposes the current snapshot
only: no historical data, no session scorecard, no CSV, no other fields.

### Rate limiting - Sandbox tier

- **100 requests per UTC calendar day** per key, resetting at 00:00 UTC.
- Every response carries:
  - `X-RateLimit-Limit: 100`
  - `X-RateLimit-Remaining: <n>`
  - `X-RateLimit-Reset: <unix epoch of next 00:00 UTC>`

### Errors

| Status | Body | When |
|---|---|---|
| `401` | `{"error":"unauthorized"}` | Missing/malformed header, unknown key, revoked key |
| `405` | `{"error":"method-not-allowed"}` | Anything but GET |
| `429` | `{"error":"rate-limited","retry_after_seconds":n}` + `Retry-After` header | Request 101+ in a UTC day |

### Caching

Responses are `Cache-Control: no-store` (they carry per-key rate headers).
Consumers are encouraged to cache locally - a 3-hour TTL loses nothing.

## Key issuance

```
POST /api/keys
Content-Type: application/json
{"email": "you@example.com"}
```

- Response: `{"ok":true,"message":"API key sent to your email"}` - the key
  itself arrives by email only.
- Issuance is throttled (3/day per email and per IP).
- No site account is required for the Sandbox tier.

## Terms (Sandbox)

- Personal and internal non-commercial use.
- Attribution must be retained wherever the data is displayed or republished.
- No redistribution, resale, or use to build a competing sentiment service.
- Keys may be revoked for abuse. Commercial/higher-volume use:
  contact@fxnewsbias.com.
