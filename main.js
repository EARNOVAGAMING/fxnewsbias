const SUPABASE_URL = 'https://vtbmtxtgtdprpbilragm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ym10eHRndGRwcnBiaWxyYWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NDA0NzMsImV4cCI6MjA5MzExNjQ3M30.brlTWgFgTw0536PO_fXWgrGzSkqAMhOojlUA-UwlMnA';

function updateDateTime() {
  const now = new Date();
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `📅 ${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  document.getElementById('topbar-date').textContent = dateStr;
}

function updateSessions() {
  const now = new Date();
  const utcHour = now.getUTCHours();

  const sessions = {
    sydney:  { open: 21, close: 6 },
    tokyo:   { open: 0,  close: 9 },
    london:  { open: 7,  close: 16 },
    newyork: { open: 12, close: 21 }
  };

  function isOpen(s) {
    if (s.open < s.close) return utcHour >= s.open && utcHour < s.close;
    return utcHour >= s.open || utcHour < s.close;
  }

  function setStatus(id, open, label) {
    const el = document.getElementById(id);
    if (!el) return;
    if (open) {
      el.textContent = 'OPEN';
      el.className = 'session-status open-status';
    } else {
      el.textContent = label || 'CLOSED';
      el.className = 'session-status closed-status';
    }
  }

  setStatus('london-status', isOpen(sessions.london));
  setStatus('newyork-status', isOpen(sessions.newyork));
  setStatus('tokyo-status', isOpen(sessions.tokyo));
  setStatus('sydney-status', isOpen(sessions.sydney));

  const sessionEl = document.getElementById('topbar-session');
  const nyOpen = isOpen(sessions.newyork);
  const ldnOpen = isOpen(sessions.london);
  if (nyOpen && ldnOpen) sessionEl.textContent = '🌐 London & NY Open';
  else if (nyOpen) sessionEl.textContent = '🌐 New York Open';
  else if (ldnOpen) sessionEl.textContent = '🌐 London Open';
  else if (isOpen(sessions.tokyo)) sessionEl.textContent = '🌐 Tokyo Open';
  else if (isOpen(sessions.sydney)) sessionEl.textContent = '🌐 Sydney Open';
  else sessionEl.textContent = '🌐 Markets Closed';
}

async function loadSentiment() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sentiment?order=created_at.desc,id.desc&limit=8`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const data = await res.json();
    if (!data || data.length === 0) return;

    let bullishCount = 0;
    let bearishCount = 0;
    let scoreSum = 0;
    let scoreN = 0;

    data.forEach(item => {
      const { currency, score, bias, drivers, created_at } = item;

      if (bias === 'Bullish') bullishCount++;
      else if (bias === 'Bearish') bearishCount++;
      const numScore = Number(score);
      if (!Number.isNaN(numScore)) { scoreSum += numScore; scoreN++; }

      const card = document.querySelector(`[data-currency="${currency}"]`);
      if (!card) return;

      const scoreEl = card.querySelector('.sent-score');
      if (scoreEl) {
        scoreEl.textContent = score;
        scoreEl.style.color = bias === 'Bullish' ? '#10b981' : bias === 'Bearish' ? '#ef4444' : '#f59e0b';
      }

      const fill = card.querySelector('.sent-fill');
      if (fill) {
        fill.style.width = score + '%';
        fill.style.background = bias === 'Bullish' ? '#10b981' : bias === 'Bearish' ? '#ef4444' : '#f59e0b';
      }

      const badge = card.querySelector('.sent-badge');
      if (badge) {
        badge.textContent = bias;
        badge.className = 'sent-badge ' + (bias === 'Bullish' ? 'bull-bg' : bias === 'Bearish' ? 'bear-bg' : 'neut-bg');
      }

      const driver = card.querySelector('.sent-driver');
      const driversArr = Array.isArray(drivers) ? drivers : (drivers ? [drivers] : []);
      if (driver && driversArr.length > 0) {
        driver.textContent = driversArr[0];
        driver.classList.remove('loading-pulse');
      }
    });

    const moodIcon = document.getElementById('mood-icon');
    const moodTitle = document.getElementById('mood-title');
    const moodDesc = document.getElementById('mood-desc');

    const avgScore = scoreN > 0 ? Math.round(scoreSum / scoreN) : 50;
    const summary = `${bullishCount} bullish · ${bearishCount} bearish · avg score ${avgScore}`;

    if (avgScore > 55) {
      moodIcon.textContent = '🟢';
      moodTitle.textContent = 'Market Mood: Risk-On';
      moodDesc.textContent = `${summary} · Risk appetite high`;
    } else if (avgScore < 45) {
      moodIcon.textContent = '🔴';
      moodTitle.textContent = 'Market Mood: Risk-Off';
      moodDesc.textContent = `${summary} · Safe-haven demand rising`;
    } else {
      moodIcon.textContent = '⚠️';
      moodTitle.textContent = 'Market Mood: Mixed';
      moodDesc.textContent = `${summary} · Trade with caution`;
    }

    const updated = new Date(data[0].created_at);
    const mins = Math.floor((Date.now() - updated) / 60000);
    const lastUpdatedEl = document.getElementById('last-updated');
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
    }

    const newsCountEl = document.getElementById('news-count');
    if (newsCountEl) {
      try {
        const cntRes = await fetch(`${SUPABASE_URL}/rest/v1/news?select=id`, {
          headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}`, 'Prefer': 'count=exact', 'Range': '0-0' }
        });
        const range = cntRes.headers.get('content-range');
        const total = range ? parseInt(range.split('/')[1]) : 0;
        newsCountEl.textContent = total > 0 ? total : '--';
      } catch(e) { newsCountEl.textContent = '--'; }
    }

    updateHotPairs(data);

  } catch(e) {}
}

function updateHotPairs(data) {
  const pairs = [
    { pair: 'EUR/USD', c1: 'EUR', c2: 'USD' },
    { pair: 'GBP/JPY', c1: 'GBP', c2: 'JPY' },
    { pair: 'USD/JPY', c1: 'USD', c2: 'JPY' },
    { pair: 'AUD/USD', c1: 'AUD', c2: 'USD' }
  ];

  const sentiment = {};
  data.forEach(d => { if (!sentiment[d.currency]) sentiment[d.currency] = d; });

  const hotPairs = document.querySelectorAll('#hot-pairs .session-row');
  pairs.forEach((p, i) => {
    if (!hotPairs[i]) return;
    const s1 = sentiment[p.c1];
    const s2 = sentiment[p.c2];
    const statusEl = hotPairs[i].querySelector('.session-status');
    if (!statusEl || !s1 || !s2) return;

    statusEl.classList.remove('loading-pulse');
    if (s1.score > s2.score) {
      statusEl.textContent = 'BULLISH';
      statusEl.className = 'session-status open-status';
    } else if (s1.score < s2.score) {
      statusEl.textContent = 'BEARISH';
      statusEl.className = 'session-status';
      statusEl.style.background = '#fee2e2';
      statusEl.style.color = '#991b1b';
    } else {
      statusEl.textContent = 'NEUTRAL';
      statusEl.className = 'session-status';
      statusEl.style.background = '#fef3c7';
      statusEl.style.color = '#92400e';
    }
  });
}

async function loadPrices() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/prices?order=id.desc&limit=50`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const allData = await res.json();
    if (!allData || allData.length === 0) return;

    const pricesByPair = {};
    allData.forEach(p => {
      if (!pricesByPair[p.pair]) pricesByPair[p.pair] = p;
    });

    document.querySelectorAll('.ticker-item').forEach(item => {
      const pairEl = item.querySelector('.pair');
      const priceEl = item.querySelector('.price');
      if (!pairEl || !priceEl) return;
      const pairName = pairEl.textContent.trim();
      const data = pricesByPair[pairName];
      if (data) {
        const price = parseFloat(data.price);
        priceEl.textContent = price.toFixed(pairName.includes('JPY') ? 3 : pairName.includes('XAU') ? 2 : 5);
        priceEl.classList.remove('loading-pulse');
      }
    });

  } catch(e) {}
}

async function loadNews() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/news?order=id.desc&limit=4`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const data = await res.json();
    if (!data || data.length === 0) return;

    const newsList = document.getElementById('news-list');
    if (!newsList) return;

    // Escape all Supabase strings before inserting into innerHTML to prevent
    // layout breakage or injection from hostile RSS feed content.
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    newsList.innerHTML = data.map(item => `
      <a href="/news" style="text-decoration:none;color:inherit;">
      <div class="news-item">
        <div class="news-meta">
          <span class="news-impact imp-${esc((item.impact || 'med').toLowerCase())}">${esc(item.impact || 'Medium')} Impact</span>
          <span>${esc(item.source || 'Reuters')} · Just now</span>
        </div>
        <div class="news-title">${esc(item.title)}</div>
        <div class="news-effect">Latest market-moving news</div>
      </div></a>
    `).join('');

  } catch(e) {}
}

async function loadMarketPulse() {
  // Escape all Supabase strings before inserting into innerHTML to prevent
  // layout breakage or injection from hostile feed content.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // Coerce score-like fields to numbers; Postgres numeric arrives as a string
  // through PostgREST and string concatenation here would corrupt the gauge.
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

  try {
    const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString();
    const [sentRes, priceRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/sentiment?created_at=gte.${sinceIso}&order=created_at.desc&limit=500`,
        { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }),
      fetch(`${SUPABASE_URL}/rest/v1/prices?order=updated_at.desc&limit=50`,
        { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } })
    ]);
    const sent = await sentRes.json();
    const prices = (await priceRes.json()) || [];
    if (!Array.isArray(sent) || sent.length === 0) return;

    const latest = {};
    const yesterday = {};
    const cutoff = Date.now() - 24 * 3600000;
    for (const r of sent) {
      const score = num(r.score);
      if (score == null) continue;
      const row = { ...r, score };
      const t = new Date(r.created_at).getTime();
      if (!latest[r.currency]) latest[r.currency] = row;
      if (!yesterday[r.currency] && t <= cutoff) yesterday[r.currency] = row;
    }

    const risk = ['AUD', 'NZD', 'CAD'];
    const safe = ['USD', 'JPY', 'CHF'];
    const riskScores = risk.filter(c => latest[c]).map(c => latest[c].score);
    const safeScores = safe.filter(c => latest[c]).map(c => latest[c].score);
    const gaugeFill = document.getElementById('gauge-fill');
    const needle = document.getElementById('gauge-needle');
    const scoreEl = document.getElementById('pulse-score');
    const modeEl = document.getElementById('pulse-mode');
    const explainerEl = document.getElementById('pulse-explainer');

    if (riskScores.length === 0 || safeScores.length === 0) {
      if (scoreEl) { scoreEl.textContent = '--'; scoreEl.style.color = 'var(--text-muted)'; }
      if (modeEl)  { modeEl.textContent = 'INSUFFICIENT DATA'; modeEl.style.color = 'var(--text-muted)'; }
      if (explainerEl) explainerEl.textContent = 'Waiting for sentiment readings on the risk and safe-haven currency baskets.';
    } else {
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const riskAvg = avg(riskScores);
      const safeAvg = avg(safeScores);
      let riskOnScore = Math.round(50 + (riskAvg - safeAvg) / 2);
      riskOnScore = Math.max(0, Math.min(100, riskOnScore));

      if (gaugeFill) {
        const arcLen = Math.PI * 110;
        gaugeFill.setAttribute('stroke-dasharray', `${arcLen * (riskOnScore / 100)} 999`);
      }
      if (needle) {
        const needleAngle = -90 + (riskOnScore / 100) * 180;
        needle.setAttribute('transform', `rotate(${needleAngle} 140 140)`);
        needle.style.transition = 'transform 0.8s ease-out';
      }

      let mode, modeColor, explainer;
      if (riskOnScore >= 65) { mode = 'RISK-ON'; modeColor = '#10b981';
        explainer = 'Traders are buying risk currencies (AUD/NZD/CAD). Safe-havens (USD/JPY/CHF) under pressure.'; }
      else if (riskOnScore <= 35) { mode = 'RISK-OFF'; modeColor = '#ef4444';
        explainer = 'Flight to safety. USD/JPY/CHF in demand, commodity currencies under selling pressure.'; }
      else { mode = 'BALANCED'; modeColor = '#f59e0b';
        explainer = 'No clear risk regime. Markets mixed between risk-on and risk-off positioning.'; }

      if (scoreEl) { scoreEl.textContent = riskOnScore; scoreEl.style.color = modeColor; }
      if (modeEl) { modeEl.textContent = mode; modeEl.style.color = modeColor; }
      if (explainerEl) explainerEl.textContent = explainer;
    }

    const byCurr = {};
    for (const r of sent) {
      (byCurr[r.currency] = byCurr[r.currency] || []).push(r);
    }
    const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
    Object.keys(byCurr).forEach(c => {
      const rows = byCurr[c];
      if (!rows.length) return;
      const dayBias = [];
      const seen = new Set();
      for (const r of rows) {
        const dk = dayKey(r.created_at);
        if (seen.has(dk)) continue;
        seen.add(dk);
        dayBias.push({ day: dk, bias: r.bias });
      }
      const currentBias = dayBias[0]?.bias;
      let streakDays = 0;
      for (const d of dayBias) {
        if (d.bias !== currentBias) break;
        streakDays++;
      }
      const card = document.querySelector(`.sent-card[data-currency="${c}"]`);
      if (!card) return;
      const pill = card.querySelector('.sent-streak');
      if (!pill) return;
      if (!currentBias || streakDays < 2) {
        pill.textContent = '';
        pill.className = 'sent-streak';
        return;
      }
      const cls = currentBias === 'Bullish' ? 'bull' : currentBias === 'Bearish' ? 'bear' : 'neut';
      const icon = currentBias === 'Bullish' ? '▲' : currentBias === 'Bearish' ? '▼' : '●';
      pill.textContent = `${icon} ${currentBias} ${streakDays}d streak`;
      pill.className = `sent-streak show ${cls}`;
    });

    const movers = [];
    Object.keys(latest).forEach(c => {
      if (!yesterday[c]) return;
      const delta = latest[c].score - yesterday[c].score;
      if (Math.abs(delta) < 3) return;
      movers.push({ currency: c, delta });
    });
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const moversEl = document.getElementById('movers-list');
    if (moversEl) {
      if (movers.length === 0) {
        moversEl.innerHTML = '<div class="pulse-movers-empty">Sentiment steady across all currencies in the last 24h.</div>';
      } else {
        moversEl.innerHTML = movers.slice(0, 5).map(m => {
          const up = m.delta > 0;
          const arrow = up ? '▲' : '▼';
          const sign = up ? '+' : '';
          return `<div class="pulse-mover-row ${up ? 'up' : 'down'}"><span class="mover-curr">${esc(m.currency)}</span><span class="mover-delta">${arrow} ${sign}${m.delta.toFixed(0)} pts</span></div>`;
        }).join('');
      }
    }

    const pairBaseQuote = {
      'EUR/USD': ['EUR','USD'], 'GBP/USD': ['GBP','USD'], 'AUD/USD': ['AUD','USD'],
      'NZD/USD': ['NZD','USD'], 'USD/JPY': ['USD','JPY'], 'USD/CHF': ['USD','CHF'],
      'USD/CAD': ['USD','CAD'], 'EUR/JPY': ['EUR','JPY'], 'GBP/JPY': ['GBP','JPY'],
      'EUR/GBP': ['EUR','GBP'], 'AUD/JPY': ['AUD','JPY']
    };
    const divergences = [];
    const divgList = document.getElementById('divg-list');
    const divgBadge = document.getElementById('divg-count-badge');
    try {
      const yestDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const [todayFx, yestFx] = await Promise.all([
        fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json').then(r => r.json()),
        fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${yestDate}/v1/currencies/usd.json`).then(r => r.json())
      ]);
      const todayRates = todayFx?.usd || {};
      const yestRates = yestFx?.usd || {};
      const fxPr = (rates, b, q) => {
        const bv = rates[b.toLowerCase()], qv = rates[q.toLowerCase()];
        return (bv && qv) ? qv / bv : null;
      };
      Object.entries(pairBaseQuote).forEach(([pair, [B, Q]]) => {
        if (!latest[B] || !latest[Q] || !yesterday[B] || !yesterday[Q]) return;
        const sentDelta = (latest[B].score - latest[Q].score) - (yesterday[B].score - yesterday[Q].score);
        if (Math.abs(sentDelta) < 5) return;
        const pToday = fxPr(todayRates, B, Q);
        const pYest  = fxPr(yestRates,  B, Q);
        if (!pToday || !pYest) return;
        const priceDelta = (pToday - pYest) / pYest * 100;
        if (Math.abs(priceDelta) < 0.10) return;
        if (Math.sign(sentDelta) === Math.sign(priceDelta)) return;
        const sentArrow  = sentDelta  > 0 ? 'up' : 'down';
        const priceArrow = priceDelta > 0 ? 'up' : 'down';
        const desc = sentDelta > 0
          ? `News favours ${B} — price still falling. Sentiment may lead a reversal higher.`
          : `News turns bearish on ${B} — price still rising. Possible fade-the-rally setup.`;
        divergences.push({ pair, B, Q, sentDelta, priceDelta, sentArrow, priceArrow, desc,
          score: Math.abs(sentDelta) + Math.abs(priceDelta) * 20 });
      });
      divergences.sort((a, b) => b.score - a.score);
    } catch (fxErr) {}

    if (divgList) {
      if (divergences.length === 0) {
        if (divgBadge) { divgBadge.textContent = 'All Clear'; divgBadge.className = 'divg-badge divg-badge-clear'; }
        divgList.innerHTML = `<div class="divg-clear">
          <div class="divg-clear-icon">✅</div>
          <div>
            <div class="divg-clear-title">No divergences across all 11 pairs</div>
            <div class="divg-clear-desc">Sentiment and price are pointing in the same direction right now. Divergence alerts appear here when news flow and price action meaningfully disagree — a setup that historically precedes a reversal within 1–3 sessions.</div>
          </div>
        </div>`;
      } else {
        if (divgBadge) {
          divgBadge.textContent = `${divergences.length} Alert${divergences.length > 1 ? 's' : ''}`;
          divgBadge.className = 'divg-badge divg-badge-active';
        }
        divgList.innerHTML = `<div class="divg-cards">${divergences.slice(0, 6).map(d => {
          const sSign = d.sentDelta  > 0 ? '+' : '';
          const pSign = d.priceDelta > 0 ? '+' : '';
          const cls   = d.sentDelta  > 0 ? 'bull-divg' : 'bear-divg';
          const tag   = d.sentDelta  > 0 ? 'Bullish Divergence' : 'Bearish Divergence';
          return `<div class="divg-card ${cls}">
            <div class="divg-card-header">
              <span class="divg-card-pair">${esc(d.pair)}</span>
              <span class="divg-card-tag">${tag}</span>
            </div>
            <div class="divg-meters">
              <div class="divg-meter">
                <div class="divg-meter-lbl">Sentiment 24h</div>
                <div class="divg-meter-val ${d.sentArrow}">${sSign}${d.sentDelta.toFixed(0)} pts</div>
              </div>
              <div class="divg-meter">
                <div class="divg-meter-lbl">Price 24h</div>
                <div class="divg-meter-val ${d.priceArrow}">${pSign}${d.priceDelta.toFixed(2)}%</div>
              </div>
            </div>
            <div class="divg-card-desc">${esc(d.desc)}</div>
          </div>`;
        }).join('')}</div>`;
      }
    }
  } catch (e) {}
}

// NEXT UPDATE TIME — fixed 3-hour cadence (matches cron `0 */3 * * *`)
// Hardcoded cadence so off-schedule manual DB rows can't corrupt the countdown.
// If the cron schedule changes, update SENTIMENT_CRON_INTERVAL_MS to match.
const SENTIMENT_CRON_INTERVAL_MS = 3 * 3600 * 1000;
let nextUpdateState = { lastRunMs: null, intervalMs: SENTIMENT_CRON_INTERVAL_MS };

async function loadNextRunSchedule() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sentiment?select=created_at&order=created_at.desc&limit=50`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return;

    let lastRunMs = null;
    for (const r of rows) {
      const t = new Date(r.created_at).getTime();
      if (!Number.isFinite(t)) continue;
      const d = new Date(t);
      if (d.getUTCMinutes() <= 5 && d.getUTCHours() % 3 === 0) {
        lastRunMs = Date.UTC(
          d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
          d.getUTCHours(), 0, 0, 0
        );
        break;
      }
    }
    if (lastRunMs == null) {
      lastRunMs = new Date(rows[0].created_at).getTime();
    }

    nextUpdateState.lastRunMs = lastRunMs;
    nextUpdateState.intervalMs = SENTIMENT_CRON_INTERVAL_MS;
    updateNextRunTime();
  } catch (e) {}
}

function updateNextRunTime() {
  const nextUpdateEl = document.getElementById('next-update');
  const nextUpdateSub = document.getElementById('next-update-sub');
  const nextStat = document.getElementById('next-update-stat');
  const lastStat = document.getElementById('last-updated-stat');
  if (!nextUpdateEl) return;

  const now = Date.now();
  const { lastRunMs, intervalMs } = nextUpdateState;

  const isStale = !!(lastRunMs && intervalMs && (now - lastRunMs) > 1.5 * intervalMs);
  const staleTip = isStale
    ? 'Sentiment feed is behind schedule — the latest update is more than one cycle late.'
    : '';
  for (const el of [nextStat, lastStat]) {
    if (!el) continue;
    el.classList.toggle('is-stale', isStale);
    if (isStale) el.setAttribute('title', staleTip);
    else el.removeAttribute('title');
  }

  let nextMs;
  if (lastRunMs && intervalMs) {
    nextMs = lastRunMs + intervalMs;
    while (nextMs <= now) nextMs += intervalMs;
  } else if (lastRunMs) {
    nextUpdateEl.textContent = 'soon';
    if (nextUpdateSub) nextUpdateSub.textContent = 'schedule unavailable';
    return;
  } else {
    nextUpdateEl.textContent = '--:--';
    if (nextUpdateSub) nextUpdateSub.textContent = '--';
    return;
  }

  const next = new Date(nextMs);
  const utcClock =
    String(next.getUTCHours()).padStart(2, '0') + ':' +
    String(next.getUTCMinutes()).padStart(2, '0') + ' UTC';
  nextUpdateEl.textContent = isStale ? 'overdue' : utcClock;

  if (nextUpdateSub) {
    if (isStale) {
      const lateMins = Math.floor((now - lastRunMs - intervalMs) / 60000);
      const h = Math.floor(lateMins / 60);
      const m = lateMins % 60;
      nextUpdateSub.textContent = h > 0
        ? `late by ${h}h ${String(m).padStart(2,'0')}m`
        : `late by ${m}m`;
    } else {
      const totalMins = Math.max(0, Math.ceil((nextMs - now) / 60000));
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
      nextUpdateSub.textContent = h > 0 ? `in ${h}h ${String(m).padStart(2,'0')}m` : `in ${m}m`;
    }
  }
}

updateDateTime();
updateSessions();
loadSentiment();
loadPrices();
loadNews();
loadMarketPulse();
loadNextRunSchedule();
setInterval(updateNextRunTime, 60000);
setInterval(loadNextRunSchedule, 15 * 60000);

window.addEventListener('userLoaded', (e) => {
  if (e.detail.isPro) {
    const banner = document.getElementById('pro-banner');
    if (banner) banner.style.display = 'none';
    document.querySelectorAll('.ad-slot').forEach(ad => {
      ad.style.display = 'none';
    });
  }
});

setInterval(() => {
  loadSentiment();
  loadPrices();
  loadNews();
  loadMarketPulse();
  updateSessions();
}, 300000);

setInterval(updateDateTime, 60000);
