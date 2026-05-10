(function() {
  'use strict';

  const PAIRS_CONFIG = {
    'EUR/USD': { from: 'EUR', to: 'USD' },
    'GBP/USD': { from: 'GBP', to: 'USD' },
    'USD/JPY': { from: 'USD', to: 'JPY' },
    'USD/CHF': { from: 'USD', to: 'CHF' },
    'AUD/USD': { from: 'AUD', to: 'USD' },
    'USD/CAD': { from: 'USD', to: 'CAD' },
    'NZD/USD': { from: 'NZD', to: 'USD' }
  };

  function formatPair(pair, now, prev) {
    const decimals = pair.includes('JPY') ? 2 : 4;
    const price = now.toFixed(decimals);
    const pct = ((now - prev) / prev) * 100;
    const cls = pct >= 0 ? 'up' : 'down';
    const sign = pct >= 0 ? '+' : '';
    return `<span class="pair">${pair}</span><span>${price}</span><span class="${cls}">${sign}${pct.toFixed(2)}%</span>`;
  }

  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  async function loadTicker() {
    const ticker = document.getElementById('ticker-inner');
    if (!ticker) return;

    try {
      const ydate = new Date(Date.now() - 86400000);
      const [today, yesterday] = await Promise.all([
        fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,CHF,CAD,AUD,NZD').then(r => r.json()),
        fetch(`https://api.frankfurter.app/${fmtDate(ydate)}?from=USD&to=EUR,GBP,JPY,CHF,CAD,AUD,NZD`).then(r => r.json())
      ]);

      const r = today.rates || {};
      const y = yesterday.rates || {};

      const pairData = {
        'EUR/USD': r.EUR && y.EUR ? { now: 1 / r.EUR, prev: 1 / y.EUR } : null,
        'GBP/USD': r.GBP && y.GBP ? { now: 1 / r.GBP, prev: 1 / y.GBP } : null,
        'USD/JPY': r.JPY && y.JPY ? { now: r.JPY, prev: y.JPY } : null,
        'USD/CHF': r.CHF && y.CHF ? { now: r.CHF, prev: y.CHF } : null,
        'AUD/USD': r.AUD && y.AUD ? { now: 1 / r.AUD, prev: 1 / y.AUD } : null,
        'USD/CAD': r.CAD && y.CAD ? { now: r.CAD, prev: y.CAD } : null,
        'NZD/USD': r.NZD && y.NZD ? { now: 1 / r.NZD, prev: 1 / y.NZD } : null
      };

      const items = ticker.querySelectorAll('.ticker-item');
      items.forEach(item => {
        const pairEl = item.querySelector('.pair');
        if (!pairEl) return;
        const pair = pairEl.textContent.trim();
        const data = pairData[pair];
        if (data) {
          item.innerHTML = formatPair(pair, data.now, data.prev);
        } else if (pair === 'XAU/USD') {
          item.innerHTML = `<span class="pair">XAU/USD</span><span>—</span>`;
        }
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

  setInterval(loadTicker, 5 * 60 * 1000);
})();
