# FXNewsBias

> AI-scored forex news sentiment. Live bias for the 8 major currencies, refreshed every 3 hours, built from the market news that actually moved them.

🌐 **[fxnewsbias.com](https://fxnewsbias.com)** · 💬 **[@fxnewsbias_bot](https://t.me/fxnewsbias_bot)**

[![Live Site](https://img.shields.io/badge/live-fxnewsbias.com-22c55e?style=for-the-badge)](https://fxnewsbias.com)
[![Telegram Bot](https://img.shields.io/badge/telegram-@fxnewsbias__bot-26A5E4?style=for-the-badge&logo=telegram)](https://t.me/fxnewsbias_bot)
[![Updated](https://img.shields.io/badge/sentiment-updated%20every%203h-blue?style=for-the-badge)](https://fxnewsbias.com)

---

## The problem

A retail trader reads thirty forex headlines before London opens and still cannot answer one question: is the dollar bid or offered today, and why?

FXNewsBias answers it with a number. Every three hours, around the clock, seven days a week, the pipeline reads the FX newswire, scores each story for what it implies about each currency, and rolls the result into a single 0 to 100 bias score per currency. Above 50 leans bullish, below 50 leans bearish, 50 is neutral.

No opinions, no signal group, no guru. Just the news, read consistently, at the same times every day.

---

## What you get

### Free, no account needed

| | |
|---|---|
| **[Currency sentiment](https://fxnewsbias.com/currencies)** | Live 0 to 100 bias score for all 8 majors, with the news themes driving each one |
| **[Pair bias](https://fxnewsbias.com/pairs)** | 15 major and cross pairs, including a divergence flag when sentiment and price disagree |
| **[News feed](https://fxnewsbias.com/news)** | Deduplicated FX wire, each headline tagged with the currencies it touches |
| **[Economic calendar](https://fxnewsbias.com/calendar)** | High impact releases with the sentiment context around them |
| **[Session insights](https://fxnewsbias.com/insight/)** | A written brief for the Asia, London and New York sessions, three a day |
| **[Data quality](https://fxnewsbias.com/data-quality)** | Live coverage stats, gap days included, so you can audit the series yourself |

### Pro, $30/month with a 7-day free trial

- Completely ad free
- Sentiment history charts across 7, 30 and 90 days for all 8 currencies
- Bias flip email alerts, sent the moment a currency you follow changes direction
- Weekly Intelligence Brief with scorecards, pair setups and a risk radar
- Pro Dashboard with a per headline currency impact feed
- CSV export of your sentiment history

[See plans](https://fxnewsbias.com) · [Pro Dashboard](https://fxnewsbias.com/pro)

---

## What makes it different

**The scorecard is public.** Most sentiment products never tell you whether they were right. FXNewsBias keeps an append only ledger: every pair and session read is frozen with a reference price at publication, then settled against the next session's open and marked as aligned, contra, or quiet. Settled rows are never edited, and deletion is blocked at the database level. Over 340 reads are settled so far.

**The series is auditable.** Scores are point in time and never revised, and the hot and archive tables are protected by database triggers that reject edits and deletes outright. Those are engine level guarantees, not promises. Every field is documented in the [data dictionary](./data/DATA_DICTIONARY.md), and live coverage including any gap days is published at [/data-quality](https://fxnewsbias.com/data-quality).

**The cadence is honest.** Eight fixed cycles a day, 00:00 UTC onwards. It refreshes every three hours because that is how often the news meaningfully changes, not because a marketing page needed a smaller number.

---

## Coverage

**Currencies**

[🇺🇸 USD](https://fxnewsbias.com/currencies/usd/) · [🇪🇺 EUR](https://fxnewsbias.com/currencies/eur/) · [🇬🇧 GBP](https://fxnewsbias.com/currencies/gbp/) · [🇯🇵 JPY](https://fxnewsbias.com/currencies/jpy/) · [🇦🇺 AUD](https://fxnewsbias.com/currencies/aud/) · [🇨🇦 CAD](https://fxnewsbias.com/currencies/cad/) · [🇨🇭 CHF](https://fxnewsbias.com/currencies/chf/) · [🇳🇿 NZD](https://fxnewsbias.com/currencies/nzd/)

**Pairs**

[EUR/USD](https://fxnewsbias.com/pairs/eur-usd/) · [GBP/USD](https://fxnewsbias.com/pairs/gbp-usd/) · [USD/JPY](https://fxnewsbias.com/pairs/usd-jpy/) · [AUD/USD](https://fxnewsbias.com/pairs/aud-usd/) · [USD/CAD](https://fxnewsbias.com/pairs/usd-cad/) · [USD/CHF](https://fxnewsbias.com/pairs/usd-chf/) · [NZD/USD](https://fxnewsbias.com/pairs/nzd-usd/) · [EUR/GBP](https://fxnewsbias.com/pairs/eur-gbp/) · [EUR/JPY](https://fxnewsbias.com/pairs/eur-jpy/) · [EUR/CHF](https://fxnewsbias.com/pairs/eur-chf/) · [GBP/JPY](https://fxnewsbias.com/pairs/gbp-jpy/) · [AUD/JPY](https://fxnewsbias.com/pairs/aud-jpy/) · [CHF/JPY](https://fxnewsbias.com/pairs/chf-jpy/) · [CAD/JPY](https://fxnewsbias.com/pairs/cad-jpy/) · [AUD/NZD](https://fxnewsbias.com/pairs/aud-nzd/)

**Sources**

Dedicated FX wires including FXStreet, ForexLive and Action Forex, plus broader financial press. Headlines and links only. Article bodies are never stored or republished, and every headline keeps its link back to the original publisher.

---

## About this repository

This repository backs the public site. The [data dictionary](./data/DATA_DICTIONARY.md) documents every field, every retention rule, and the immutability guarantees behind the sentiment series and the scorecard ledger.

Implementation details are not documented here. This is a running commercial product, not a template.

---

## Contact

- 🌐 **[fxnewsbias.com](https://fxnewsbias.com)**
- 💬 Telegram: **[@fxnewsbias_bot](https://t.me/fxnewsbias_bot)**
- 📧 **[contact@fxnewsbias.com](mailto:contact@fxnewsbias.com)**
- ℹ️ [About](https://fxnewsbias.com/about) · [Terms](https://fxnewsbias.com/terms) · [Disclaimer](https://fxnewsbias.com/disclaimer)

---

## Disclaimer

FXNewsBias publishes news sentiment analysis, not trading advice, signals, or recommendations. Scores describe the tone of published news. They do not predict price. Nothing here is a solicitation to trade. Trading foreign exchange carries substantial risk of loss.

## License

© 2026 FXNewsBias. All rights reserved. The site content and the dataset are proprietary. Headlines remain the property of their publishers.
