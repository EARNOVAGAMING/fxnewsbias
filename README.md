# FXNewsBias

> Free AI-powered forex news sentiment dashboard — live currency bias scores updated every 3 hours from real market news.

🌐 **[fxnewsbias.com](https://fxnewsbias.com)** · 💬 **[@fxnewsbias_bot](https://t.me/fxnewsbias_bot)**

[![Live Site](https://img.shields.io/badge/live-fxnewsbias.com-22c55e?style=for-the-badge)](https://fxnewsbias.com)
[![Telegram Bot](https://img.shields.io/badge/telegram-@fxnewsbias__bot-26A5E4?style=for-the-badge&logo=telegram)](https://t.me/fxnewsbias_bot)
[![Updated](https://img.shields.io/badge/sentiment-updated%20every%203h-blue?style=for-the-badge)](https://fxnewsbias.com)

---

## What it does

FXNewsBias pulls live forex news every 3 hours from Reuters, Bloomberg, ForexLive, and central bank wires, then uses Claude AI to score each story as bullish, bearish, or neutral for the 8 major currencies — giving traders an instant fundamental read on the market.

### Built for retail forex traders who need:

- **[Live currency sentiment scores](https://fxnewsbias.com/currencies)** — strongly bearish → strongly bullish for all 8 majors
- **[Per-pair bias analysis](https://fxnewsbias.com/pairs)** — 15 forex pairs with sentiment-vs-price divergence flags
- **[Real-time forex news feed](https://fxnewsbias.com/news)** — AI-tagged, deduplicated, multi-source
- **[Economic calendar](https://fxnewsbias.com/calendar)** — high-impact events with sentiment context
- **[Daily market insights](https://fxnewsbias.com/insight/)** — AI-written ASEAN, London, and New York session briefs

---

## Why FXNewsBias?

Most retail traders read 30+ news headlines a day and still feel lost on bias. FXNewsBias does the reading for you — scoring every story, weighting it by source credibility, and rolling it up into a single number per currency. **No paid subscription needed for the core dashboard.**

### Specific currency pages

| Currency | Page |
|---|---|
| 🇺🇸 US Dollar | [/currencies/usd/](https://fxnewsbias.com/currencies/usd/) |
| 🇪🇺 Euro | [/currencies/eur/](https://fxnewsbias.com/currencies/eur/) |
| 🇬🇧 British Pound | [/currencies/gbp/](https://fxnewsbias.com/currencies/gbp/) |
| 🇯🇵 Japanese Yen | [/currencies/jpy/](https://fxnewsbias.com/currencies/jpy/) |
| 🇦🇺 Australian Dollar | [/currencies/aud/](https://fxnewsbias.com/currencies/aud/) |
| 🇨🇦 Canadian Dollar | [/currencies/cad/](https://fxnewsbias.com/currencies/cad/) |
| 🇨🇭 Swiss Franc | [/currencies/chf/](https://fxnewsbias.com/currencies/chf/) |
| 🇳🇿 New Zealand Dollar | [/currencies/nzd/](https://fxnewsbias.com/currencies/nzd/) |

### Top forex pair pages

[EUR/USD](https://fxnewsbias.com/pairs/eur-usd/) · [GBP/USD](https://fxnewsbias.com/pairs/gbp-usd/) · [USD/JPY](https://fxnewsbias.com/pairs/usd-jpy/) · [AUD/USD](https://fxnewsbias.com/pairs/aud-usd/) · [USD/CAD](https://fxnewsbias.com/pairs/usd-cad/) · [USD/CHF](https://fxnewsbias.com/pairs/usd-chf/) · [NZD/USD](https://fxnewsbias.com/pairs/nzd-usd/) · [EUR/JPY](https://fxnewsbias.com/pairs/eur-jpy/) · [GBP/JPY](https://fxnewsbias.com/pairs/gbp-jpy/)

---

## Features

- 🤖 **AI sentiment scoring** powered by Anthropic Claude
- 📈 **Live forex prices** via Twelve Data API
- 🔔 **Telegram alerts** for sentiment shifts via [@fxnewsbias_bot](https://t.me/fxnewsbias_bot)
- 📊 **Sentiment vs price divergence detector** — spots when news disagrees with price action
- 🗓️ **Economic calendar** with sentiment context
- 📰 **Daily session insights** at 08:00 / 14:00 / 20:00 MY time
- 💎 **Pro tier** ($9.99/mo) — extended sentiment history, real-time alerts, ad-free

---

## Tech stack

- **Frontend:** Vanilla HTML / CSS / JS (no framework bloat, sub-1s page loads)
- **Hosting:** Cloudflare Workers + Pages
- **Database:** Supabase (sentiment data) + Firebase Firestore (subscriptions)
- **Auth:** Firebase Authentication
- **AI:** Anthropic Claude API
- **Market data:** Twelve Data API
- **Charts:** Chart.js
- **Payments:** Stripe
- **Email:** Resend

---

## Try it free

👉 **[fxnewsbias.com](https://fxnewsbias.com)** — no signup needed for the free tier.

---

## Connect

- 🌐 Website: **[fxnewsbias.com](https://fxnewsbias.com)**
- 💬 Telegram bot: **[@fxnewsbias_bot](https://t.me/fxnewsbias_bot)**
- 📧 Contact: **[contact@fxnewsbias.com](mailto:contact@fxnewsbias.com)**
- ℹ️ About: [fxnewsbias.com/about](https://fxnewsbias.com/about)

---

## License

© 2026 FXNewsBias. All rights reserved.

---

**Topics:** `forex` `forex-trading` `sentiment-analysis` `forex-news` `currency-bias` `forex-dashboard` `trading-tools` `claude-ai` `cloudflare-workers` `forex-signals`
