# FXNewsBias — SEO / AI Architecture Audit & Adaptation Plan

_Author: Lead AI Systems Architect review • Date: 1 Aug 2026_

> Goal: evolve FXNewsBias into a **self-improving** AI forex-intelligence platform that
> learns from real search performance — **without** replacing the existing production
> architecture. Extend working systems; never rebuild them.

---

## Phase 1 — Architecture Audit

### Two Cloudflare Workers

| Worker | File | Role |
|---|---|---|
| `fxnewsbias` | `worker.js` (375 ln) | Request-time SSR/injection: serves assets, injects `seo_cache` HTML at `<!-- seo_inject -->`, rewrites `dateModified` + "Page reviewed" to today, clean-URL 301s, SSRs forecast posts from Firestore, refreshes sitemap `lastmod`. 3-min CDN cache. |
| `fxnewsbias-cron` | `cf/cron_worker.js` (4,462 ln) | The brain: all cron jobs + ~30 HTTP admin/ops endpoints + Stripe webhook + contact form + welcome email + weekly report + admin data. |

### Cron schedule (live = `wrangler_cron.jsonc`, 9 triggers)

```
*/15 * * * *   prices (Twelve Data)
0  */3 * * *   sentiment: RSS→Haiku→Supabase+Telegram   (Sun 21:00 also → weekly report)
7  */3 * * *   pairSEO      (15 pairs, Haiku)
10 */3 * * *   currencySEO  (8 ccy,  Haiku)
15 */3 * * *   cleanup + IndexNow            — at 03:15 ALSO → GSC ingest (E1)
13 0  * * *    ASEAN insight   (weekdays)
13 6  * * *    London insight  (weekdays)
13 12 * * *    NY insight      (weekdays)
30 6  * * *    daily broadcast email (weekdays)
```

⚠️ **Cron constraint:** Cloudflare enforces a ~5-cron soft limit; 9 are packed here. Do **not**
add/edit triggers — fold new schedules into existing triggers (as E1 did inside `15 */3`, and the
weekly report does inside `0 */3` on Sundays). `wrangler-cron.jsonc` (dash) is a stale drift trap;
only the underscore file deploys.

### Pipeline diagram

```
   DATA SOURCES                     fxnewsbias-cron (the brain)                    STORES
 ┌──────────────┐    0 */3  runSentimentAnalysis
 │ 16 RSS feeds │──► fetchAllNews (parallel, cap100, title-dedupe)
 └──────────────┘      → saveNews: keyword prefilter → Haiku relevance
 ┌──────────────┐        → impact/ccy tag → UPSERT news(on_conflict=url) ───────► SUPABASE
 │ Twelve Data  │──►   → analyzeSentiment (Haiku, 8-ccy JSON) → sentiment(append)  (PostgREST)
 └──────────────┘      → Telegram alert                                            • sentiment
 ┌──────────────┐    7/10 */3  generateAll{Pair,Currency}SEO (15+8 × Haiku)        • news
 │ Anthropic    │◄─    → seo_cache UPSERT + _addInternalLinks (E4, deterministic)   • prices
 │ Haiku 4.5    │      → PATCH <title>/meta/H1 → commit to GitHub                   • seo_cache
 └──────────────┘    15 */3  cleanup + IndexNow  + [03:15 → GSC ingest E1]          • step_runs
 ┌──────────────┐    13 0/6/12  generateDailyInsight (weekdays)                     • system_state
 │ Search Console│─►   sentiment+24h news → _insBuildNarrativeAI (Haiku 3k)         • weekly_reports
 │  (E1)        │      → render HTML + OG PNG (resvg-wasm)                          • gsc_performance ← was unmigrated
 └──────────────┘      → commit 6 files to GitHub (article, manifest, index,
 ┌──────────────┐        rss, sitemap, og)
 │ Firestore    │◄─►  30 6 daily broadcast • Sun21 weekly report
 │ subs/posts/  │
 │ forecasts    │    USER ─HTTP─► worker.js ─inject seo_cache─► static HTML
 └──────────────┘    GitHub push → GH Action → Cloudflare Pages
 ┌──────────────┐
 │ Stripe       │──webhook──► Pro status → Firestore
 └──────────────┘
```

### Reliability layer (mature — keep untouched)
`withRetry` (3 attempts) → `step_runs` log → consecutive-failure Telegram alerts; staleness
detection; retention-based cleanup jobs; incident tracking.

### Existing SEO logic
- **Prompts:** sentiment scorer, relevance classifier, `_insBuildNarrativeAI` (rich insight prompt
  w/ banned-phrase lists), `generateCurrencySEO`/`generatePairSEO` (strict title format + banned words). Mature, anti-boilerplate.
- **Metadata:** every 3h, pair/currency `<title>`/`og`/`twitter`/`description`/`H1` regenerated and
  **committed to GitHub** as static-file patches; live block cached in `seo_cache`.
- **Internal linking (E4):** `_addInternalLinks` — deterministic, zero-cost, capped 4/block, now also in insight bodies.
- **Article updates:** insights are **write-once**; only `dateModified`/"reviewed" cosmetically bumped per request.

### E1 verification (1 Aug 2026, read-only)
Source side is **healthy**: SA `fxnewsbias-analytics@fxnewsbias.iam.gserviceaccount.com`
authenticates, has `sc-domain:fxnewsbias.com (siteFullUser)`, and returns real query + page rows.
**But** `gsc_performance` had **no committed migration** → the daily upsert likely 404s inside the
cron's `.catch()`, so nothing is stored. Search traffic is currently tiny (single-digit daily
impressions; many queries at position 40–62) — which makes churning titles especially harmful.

---

## Phase 2 — Gap Analysis (ranked by traffic impact)

1. **🔴 GSC ingest is write-only + `gsc_performance` unmigrated** — the whole feedback premise is unwired.
2. **🔴 Titles/meta rewritten every 3h regardless of performance** — 8 title changes/day dilutes ranking signal, overwrites winners, no memory. "Optimising blind."
3. **🔴 Keyword cannibalisation** — 174 near-duplicate insights competing with each other and with money pages.
4. **🟠 No content decay/refresh** — old insights rot but stay indexed → site-wide quality drag.
5. **🟠 Internal linking one-directional/shallow** — money pages don't link out to fresh insights; no clusters; no near-winner targeting.
6. **🟠 Thin schema** — no FAQPage on money pages, no NewsArticle on insights (forfeits Top Stories).
7. **🟠 GA4 not wired into decisions.**
8. **🟠 No article-worthiness gate** — insights fire on a fixed clock even on quiet days → manufactured thin content.
9. **🔴 (enabler) No experiment/measurement record** — nothing logs title changes → no attribution → no learning.
10. **🟢 Dead branch:** `syncForecastSitemap` (`5 0 * * *`) never registered.

---

## Phase 3 — Adaptation Plan (extend, never replace)

All items reuse the existing cron worker, Supabase, GitHub-commit path, and Haiku. **Zero new cron
triggers.** Net API cost ≈ flat-to-down (gating removes wasted title regenerations).

- **A1 — Foundation:** `gsc_performance` migration + `seo_title_history` + `page_performance_7d` view. _(Sprint 0 — see `cf/RUN_THESE_SEO_MIGRATIONS.sql`.)_ Low complexity, near-zero risk.
- **A2 — Performance-gated titles:** before overwriting a `<title>`, read `page_performance_7d`; skip pos ≤3 healthy-CTR winners; only rewrite stuck (p.8–20) or low-CTR pages. Keeps the live `seo_cache` block fresh every cycle. **Highest ROI.** API cost ↓.
- **A3 — CTR optimiser + real-query prompts:** feed each page's top GSC queries into the Haiku title prompt for high-impression/low-CTR pages.
- **A4 — Insight decay/consolidation:** weekly (fold into Sun 21:00) — score each insight → keep/refresh/merge/301/noindex. Approval-gated first (301s are hard to reverse).
- **A5 — Bidirectional linking + FAQ/NewsArticle schema.** Deterministic, no API cost.

---

## Phase 4 — AI Agent Design

**Do NOT build an autonomous multi-agent system.** For a lean cron pipeline it adds cost,
nondeterminism, and failure surface for no traffic gain. Build **one thin "SEO Intelligence"
analysis step**; keep everything else deterministic.

| Agent | Verdict | Rationale |
|---|---|---|
| SEO Intelligence | ✅ lightweight | One weekly LLM call reads `gsc_performance` → writes `seo_actions`. The missing brain / E1 consumer. |
| Content Refresh | ✅ | = A4 decay job; reads `seo_actions`, acts via GitHub-commit path. |
| Internal Linking | ❌ | Already deterministic; an LLM here wastes money + adds nondeterminism. |
| QA | ⚠️ deterministic checker | Pre-commit dup-phrase/banned-pattern/word-count validator; no LLM needed. |
| Market Intelligence | ❌ | Already exists = `analyzeSentiment`. |
| Content Generation | ❌ | Already exists = insight/SEO generators. |

**Communication (no new infra):** the `seo_actions` table _is_ the bus. Intelligence writes actions;
existing SEO/insight functions read + execute; outcomes (before/after position) written back to learn.

---

## Phase 5 — Search Console Integration

- **Where:** `gsc_performance` (done) + add query×page pull for cannibalisation.
- **Frequency:** daily (03:15). GSC lags ~2–3d; rolling 3–7-day upsert window is correct. No more than daily.
- **Metrics (priority):** impressions (demand) → position → CTR-vs-expected-for-position (title quality) → clicks → query→page (intent/cannibalisation).
- **Influence:** generation = feed real queries into prompts; updates = gate title rewrites (protect winners); title/meta = CTR-gap detector; linking = steer links to pos 5–15 near-winners; expansion = impressions-with-no-content → FAQ/new section.
- **Guardrail:** every automated action must cite a metric threshold — enforced in code.

---

## Phase 6 — Continuous Learning Loop

Weekly, per URL, from GSC (+ GA4 later):

| Decision | Trigger | Why |
|---|---|---|
| Leave unchanged | pos ≤3 AND CTR ≥ expected | Protect equity — never churn winners. |
| Rewrite title only | good pos + CTR below curve | Copy problem, not content. |
| Refresh | impressions + decaying pos, or stale age | Regenerate body, real `dateModified`. |
| Expand | pos 8–20 + rising impressions + thin | Add FAQ/depth to reach page 1. |
| Merge | many URLs, same intent, all weak | Consolidate to strongest, 301 rest. |
| Redirect/Delete | ~0 impressions after 90d + dup | 301 to hub or noindex + drop from sitemap. |

Decisions → `seo_actions` **with outcome tracking** (before/after position 2–4 weeks later). Actions
start approval-gated; graduate to auto-apply once outcomes prove positive.

---

## Phase 7 — Roadmap (ROI-ordered)

| Sprint | Deliverable | ROI | Risk |
|---|---|---|---|
| **0 — Unblock** | `gsc_performance` migration + `seo_title_history` + view; verify ingest writes; retire dead branch | Enables everything | None |
| **1 — Stop churn** | A2 gated titles + title history | **Highest** (stability + ↓ spend) | Low |
| **2 — Brain** | SEO Intelligence weekly → `seo_actions` (Sun 21:00 slot) | Turns E1 into a live loop | Low |
| **3 — CTR optimiser** | A3 real-query titles | High click uplift | Low |
| **4 — Debt paydown** | A4 decay/consolidation (dry-run→approval→auto) | Removes cannibalisation drag | Med (301s) |
| **5 — Links + schema** | A5 bidirectional linking + FAQ/NewsArticle | Rankings + rich results | Low |
| **6 — Prioritise compute** | Regenerate winners/near-winners more, quiet pages less | Efficiency | Low |

**Cost/infra:** no new Workers, no new cron triggers, no new external services. One weekly LLM
analysis call; title-regen volume decreases. Everything rides existing Supabase + GitHub-commit + Haiku.
