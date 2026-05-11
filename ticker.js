(function() {
  'use strict';

  const BASE = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
  const FALLBACK = 'https://latest.currency-api.pages.dev/v1/currencies/usd.json';

  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function dayUrls(yyyymmdd) {
    return [
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${yyyymmdd}/v1/currencies/usd.json`,
      `https://${yyyymmdd}.currency-api.pages.dev/v1/currencies/usd.json`
    ];
  }

  async function fetchJson(urls) {
    for (const u of urls) {
      try {
        const r = await fetch(u);
        if (r.ok) return await r.json();
      } catch(e) {}
    }
    throw new Error('All endpoints failed');
  }

  // Find the most recent past day whose EUR rate differs from `today` (skips
  // weekends/holidays where the API just repeats Friday's close → 0% change).
  async function fetchPrev(todayDate, todayEur) {
    const anchor = new Date(todayDate + 'T00:00:00Z');
    for (let i = 1; i <= 7; i++) {
      const d = fmtDate(new Date(anchor.getTime() - i * 86400000));
      try {
        const j = await fetchJson(dayUrls(d));
        const eur = j.usd && j.usd.eur;
        if (eur && eur !== todayEur) return j;
      } catch(e) {}
    }
    return null;
  }

  function formatPair(pair, now, prev) {
    const decimals = pair.includes('JPY') ? 2 : (pair.includes('XAU') ? 2 : 4);
    const price = now.toFixed(decimals);
    const pct = ((now - prev) / prev) * 100;
    const cls = pct >= 0 ? 'up' : 'down';
    const sign = pct >= 0 ? '+' : '';
    return `<span class="pair">${pair}</span><span>${price}</span><span class="${cls}">${sign}${pct.toFixed(2)}%</span>`;
  }

  async function loadTicker() {
    const ticker = document.getElementById('ticker-inner');
    if (!ticker) return;
    try {
      const today = await fetchJson([BASE, FALLBACK]);
      const r = today.usd || {};
      const yesterday = await fetchPrev(today.date || fmtDate(new Date()), r.eur);
      const y = (yesterday && yesterday.usd) || {};

      // XAU rate is "USD per gram" — invert and *31.1035 for USD per troy ounce
      const xauNow = r.xau ? (1 / r.xau) * 31.1034768 : null;
      const xauPrev = y.xau ? (1 / y.xau) * 31.1034768 : null;

      const pairData = {
        'EUR/USD': r.eur && y.eur ? { now: 1 / r.eur, prev: 1 / y.eur } : null,
        'GBP/USD': r.gbp && y.gbp ? { now: 1 / r.gbp, prev: 1 / y.gbp } : null,
        'USD/JPY': r.jpy && y.jpy ? { now: r.jpy, prev: y.jpy } : null,
        'USD/CHF': r.chf && y.chf ? { now: r.chf, prev: y.chf } : null,
        'AUD/USD': r.aud && y.aud ? { now: 1 / r.aud, prev: 1 / y.aud } : null,
        'USD/CAD': r.cad && y.cad ? { now: r.cad, prev: y.cad } : null,
        'NZD/USD': r.nzd && y.nzd ? { now: 1 / r.nzd, prev: 1 / y.nzd } : null,
        'XAU/USD': xauNow && xauPrev ? { now: xauNow, prev: xauPrev } : null
      };

      ticker.querySelectorAll('.ticker-item').forEach(item => {
        const pairEl = item.querySelector('.pair');
        if (!pairEl) return;
        const pair = pairEl.textContent.trim();
        const data = pairData[pair];
        if (data) item.innerHTML = formatPair(pair, data.now, data.prev);
      });
    } catch (e) {
      console.warn('Ticker fetch failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTicker);
  } else {
    loadTicker();
  }
  setInterval(loadTicker, 60 * 1000);
})();
