# FXNewsBias Data Dictionary

Reference documentation for the FXNewsBias dataset. Everything described here
is produced by the automated pipeline described below, recorded in UTC, and
governed by the immutability policy in §5.

**Series start: 2026-05-19** (sentiment). Data before this date does not exist.

---

## 1. Datasets

### 1.1 `sentiment` currency news-tone time series (core dataset)

AI-derived news-tone score per currency, published on a fixed cycle.

| Column | Type | Description |
|---|---|---|
| `id` | integer | Monotonic row id (unique across live + archive) |
| `currency` | text | ISO code, one of USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD |
| `score` | integer | News-tone score 0 to 100. 50 = neutral; >50 leaning bullish tone, <50 leaning bearish tone |
| `bias` | text | Categorical label derived from score: `Bullish` / `Bearish` / `Neutral` |
| `drivers` | text[] | Short phrases naming the news themes that drove the score |
| `created_at` | timestamptz | Publication timestamp (UTC). Never backfilled or edited |

- **Cadence:** every 3 hours, 8 currencies → 64 rows/day, 7 days/week.
- **Method (summary):** headlines from the news corpus (§1.2) are classified by
  a large language model into per-currency tone implications, aggregated into
  the 0 to 100 score. Scores are point-in-time: they reflect the news available
  at publication, are never revised, and are not trading recommendations.
- **Completeness:** verify live at `GET /data-quality.json` (see §4).

### 1.2 `news` headline corpus

| Column | Type | Description |
|---|---|---|
| `id` | integer | Row id |
| `title` | text | Headline text |
| `source` | text | Publisher (e.g. FXStreet, ForexLive, CNBC, MarketWatch) |
| `url` | text | Canonical link to the original article |
| `impact` | text | Pipeline's impact tag |
| `currencies_affected` | text[] | Currencies the pipeline mapped the headline to |
| `created_at` | timestamptz | Ingestion timestamp (UTC) |

Headlines only. No article bodies are stored or redistributed.
Corpus continuous from **2026-07-19** (earlier headlines predate the archive policy).

### 1.3 `session_bias`, the Session Bias Scorecard ledger

Append-only outcome ledger. Each row is one pair/session read, later settled
against the next session's open.

| Column | Type | Description |
|---|---|---|
| `session_date`, `session` | date, text | Trading date and session (`asean`=Asia, `london`, `newyork`) |
| `pair` | text | One of 11 covered FX pairs |
| `tone` | text | `Bullish` / `Bearish` / `Neutral`, the published read |
| `strength` | integer | 1 to 5 conviction of the read at publication |
| `entry_price`, `entry_time` | numeric, timestamptz | Reference price frozen at publication |
| `settle_price`, `settled_at` | numeric, timestamptz | Next-session settlement |
| `move_pips`, `move_pct` | numeric | Realized move between entry and settle |
| `band_pct` | numeric | Pair-specific volatility band (k·σ) used for the quiet test |
| `alignment` | text | `aligned` (moved with tone) / `contra` (against) / `quiet` (inside band) / `na` (Neutral tone, no directional claim to score) |
| `status` | text | `open` → `settled` |

- Ledger begins **2026-08-06**. Rows are **settled once and never edited
  afterward; deletion is blocked at the database level** (§5).
- This is a scorecard of news-tone reporting quality, not trade signals, and
  `alignment` is not a trading P&L.

### 1.4 `price_history` hourly FX price reference

Hourly mid prices per pair (source: licensed market-data API), from
**2026-05-06**. Used for settlement and volatility bands.

---

## 2. Storage tiers

| Tier | Tables | Purpose |
|---|---|---|
| Hot | `sentiment`, `news` | Dashboard/API serving. Retention: sentiment 730 d, news 365 d (env-tunable) |
| Archive | `sentiment_archive`, `news_archive` | Everything past the hot window, forever. Append-only, database-enforced |
| Unified | `sentiment_full`, `news_full` (views) | Hot ∪ archive, the canonical full series, one query surface |

Rows move hot → archive via the atomic `archive_prune_*` functions (copy first,
delete only what was copied, single transaction). Nothing is ever destroyed.

---

## 3. Redundancy

Weekly (Sunday 03:15 UTC) the complete series (`sentiment_full`,
`session_bias`, `news_full`) is exported as CSV to
[`data/exports/`](./exports/) in this repository. Git history preserves every
weekly version, so the dataset survives independently of the database.

CSV conventions: UTF-8, header row, RFC-4180 quoting, arrays joined with `|`,
timestamps ISO-8601 UTC.

---

## 4. Data quality, live and machine-readable

`GET https://fxnewsbias.com/data-quality.json`

The same figures are rendered for humans at
<https://fxnewsbias.com/data-quality>.

Returns first/last timestamps, row counts (live + archived), expected vs actual
daily coverage for the last 30 days with individual gap days listed, and ledger
settlement counts. Cached 5 minutes.

Known caveats (stated, not hidden):

- Sentiment series starts 2026-05-19; ledger starts 2026-08-06. Depth is
  honest and grows daily.
- Boundary days (window edges, current day in progress) can appear in
  `gap_days_last_30` with partial counts; a genuine mid-series gap would show
  the same way and is what the field exists to expose.
- LLM model version per row is not currently recorded (roadmap item).

---

## 5. Immutability policy

- `session_bias`: settlement updates only. **DELETE is rejected by a database
  trigger** for every role, including the service role.
- `sentiment_archive` / `news_archive`: **UPDATE and DELETE rejected by
  triggers**, append-only, permanently.
- `sentiment` / `news` hot rows: written once by the pipeline; the only removal
  path is the archive-then-prune transaction.

These are engine-level guarantees, not conventions.

---

## 6. Licensing

The dataset is © FXNewsBias. Public site content may be viewed freely;
programmatic access, redistribution, and commercial use require a data
licence, contact contact@fxnewsbias.com. Headlines remain © their publishers;
FXNewsBias stores and displays titles/links only.

*This document describes data as-is and is not investment advice.*
