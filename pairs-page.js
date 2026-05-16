(function() {
'use strict';

// Topbar date
const topbarDate = document.getElementById('topbar-date');
if (topbarDate) {
  const now = new Date();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  topbarDate.textContent = `📅 ${dayNames[now.getDay()]}, ${monthNames[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

const SUPABASE_URL = 'https://vtbmtxtgtdprpbilragm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ym10eHRndGRwcnBiaWxyYWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NDA0NzMsImV4cCI6MjA5MzExNjQ3M30.brlTWgFgTw0536PO_fXWgrGzSkqAMhOojlUA-UwlMnA';

const FLAGS = {
  USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', JPY:'🇯🇵', AUD:'🇦🇺',
  CAD:'🇨🇦', CHF:'🇨🇭', NZD:'🇳🇿', XAU:'🥇'
};

const ALL_PAIRS = [
  { pair:'EUR/USD', cat:'major' }, { pair:'GBP/USD', cat:'major' }, { pair:'USD/JPY', cat:'major' },
  { pair:'USD/CHF', cat:'major' }, { pair:'AUD/USD', cat:'major' }, { pair:'USD/CAD', cat:'major' },
  { pair:'NZD/USD', cat:'major' },
  { pair:'EUR/JPY', cat:'jpy' }, { pair:'GBP/JPY', cat:'jpy' }, { pair:'AUD/JPY', cat:'jpy' },
  { pair:'CAD/JPY', cat:'jpy' }, { pair:'CHF/JPY', cat:'jpy' }, { pair:'NZD/JPY', cat:'jpy' },
  { pair:'EUR/GBP', cat:'major' }, { pair:'EUR/CHF', cat:'major' }, { pair:'GBP/CAD', cat:'major' },
  { pair:'XAU/USD', cat:'commodity' }
];

let sentimentData = {};
let pricesData = {};
let activeFilter = 'all';
let activeSort = 'conviction';

function getWatchlist(){ try { return JSON.parse(localStorage.getItem('fxnb_pair_watchlist')||'[]'); } catch(e){ return []; } }
function setWatchlist(list){ try { localStorage.setItem('fxnb_pair_watchlist', JSON.stringify(list)); } catch(e){} }
function toggleWatch(pair){
  const w = getWatchlist();
  const i = w.indexOf(pair);
  if (i >= 0) w.splice(i,1); else w.push(pair);
  setWatchlist(w); render();
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 60) return diff + 'm ago';
  if (diff < 1440) return Math.floor(diff/60) + 'h ago';
  return Math.floor(diff/1440) + 'd ago';
}

function getPairPrice(pair){
  if (pricesData[pair]) return { ...pricesData[pair], derived: false };
  const [b, q] = pair.split('/');
  const baseUsd = priceVsUsd(b);
  const quoteUsd = priceVsUsd(q);
  if (!baseUsd || !quoteUsd) return null;
  const price = baseUsd.price / quoteUsd.price;
  const cB = baseUsd.change_24h || 0;
  const cQ = quoteUsd.change_24h || 0;
  const change_24h = ((1 + cB/100) / (1 + cQ/100) - 1) * 100;
  return { price, change_24h, derived: true };
}

function priceVsUsd(curr){
  if (curr === 'USD') return { price: 1, change_24h: 0 };
  if (pricesData[curr + '/USD']) {
    return { price: pricesData[curr+'/USD'].price, change_24h: pricesData[curr+'/USD'].change_24h };
  }
  if (pricesData['USD/' + curr]) {
    const p = pricesData['USD/'+curr];
    const chg = p.change_24h || 0;
    return { price: 1 / p.price, change_24h: ((1/(1+chg/100)) - 1) * 100 };
  }
  return null;
}

async function loadAllData(){
  try {
    const sentRes = await fetch(SUPABASE_URL + '/rest/v1/sentiment?order=created_at.desc&limit=80', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON }
    });
    const sentArr = await sentRes.json();
    sentArr.forEach(s => { if (!sentimentData[s.currency]) sentimentData[s.currency] = s; });

    const priceRes = await fetch(SUPABASE_URL + '/rest/v1/prices?order=updated_at.desc&limit=200', {
      headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON }
    });
    const priceArr = await priceRes.json();
    priceArr.forEach(p => {
      if (!pricesData[p.pair]) pricesData[p.pair] = {
        price: parseFloat(p.price),
        change_24h: parseFloat(p.change_pct || 0),
        updated_at: p.updated_at
      };
    });

    if (sentArr[0]) {
      const el = document.getElementById('last-update');
      if (el) el.textContent = '⏱ Sentiment ' + timeAgo(sentArr[0].created_at);
    }

    renderMood();
    renderMovers();
    render();
  } catch(e){
    document.getElementById('pair-grid').innerHTML = '<div class="empty-state">Could not load pair data. Please refresh.</div>';
  }
}

function computePairBias(base, quote){
  if (base === 'XAU' || base === 'XAG' || base === 'WTI'){
    const usd = sentimentData['USD'];
    if (!usd) return null;
    const inferredScore = 100 - usd.score;
    const gap = inferredScore - usd.score;
    const bias = gap > 10 ? 'Bullish' : gap < -10 ? 'Bearish' : 'Neutral';
    return {
      bias,
      gap,
      baseScore: inferredScore, baseBias: bias,
      quoteScore: usd.score, quoteBias: usd.bias,
      drivers: { pos: [], neg: [] }
    };
  }
  const b = sentimentData[base];
  const q = sentimentData[quote];
  if (!b || !q) return null;
  const gap = b.score - q.score;
  const bias = gap > 10 ? 'Bullish' : gap < -10 ? 'Bearish' : 'Neutral';
  return {
    bias, gap,
    baseScore: b.score, baseBias: b.bias,
    quoteScore: q.score, quoteBias: q.bias,
    drivers: {}
  };
}

function biasClass(b){ return b === 'Bullish' ? 'bull-bg' : b === 'Bearish' ? 'bear-bg' : 'neut-bg'; }
function fillColor(score){
  if (score >= 60) return '#10b981';
  if (score <= 40) return '#ef4444';
  return '#f59e0b';
}
function formatPrice(pair, num){
  if (pair.includes('JPY')) return num.toFixed(2);
  if (pair === 'XAU/USD') return num.toFixed(2);
  return num.toFixed(4);
}
function rationale(pair, b){
  const [base, quote] = pair.split('/');
  if (base === 'XAU') {
    return b.bias === 'Bullish'
      ? `<strong>USD weak</strong> (${b.quoteScore}) → gold tends to <strong>rise</strong> as a hedge.`
      : b.bias === 'Bearish'
      ? `<strong>USD strong</strong> (${b.quoteScore}) → gold under <strong>pressure</strong>.`
      : `USD score is balanced — <strong>no clear edge</strong> for gold.`;
  }
  const baseLine = `<strong>${base}</strong> ${b.baseBias.toLowerCase()} (${b.baseScore})`;
  const quoteLine = `<strong>${quote}</strong> ${b.quoteBias.toLowerCase()} (${b.quoteScore})`;
  if (b.bias === 'Bullish') {
    return `${baseLine} vs ${quoteLine} → ${base} has the edge, <strong>${pair} bias up</strong>.`;
  }
  if (b.bias === 'Bearish') {
    return `${baseLine} vs ${quoteLine} → ${quote} has the edge, <strong>${pair} bias down</strong>.`;
  }
  return `${baseLine} vs ${quoteLine} → strength is <strong>balanced</strong>, range-bound.`;
}

function renderMood(){
  const moodVal = document.getElementById('mood-value');
  const moodSub = document.getElementById('mood-sub');
  const usdEl = document.getElementById('usd-strength');
  const usdFill = document.getElementById('usd-fill');
  const vsVal = document.getElementById('vs-value');
  const vsSub = document.getElementById('vs-sub');

  const usd = sentimentData['USD'];
  if (!usd){ return; }

  const risk = ['AUD','NZD','CAD'].map(c => sentimentData[c] && sentimentData[c].score).filter(x=>x!=null);
  const safe = ['JPY','CHF','USD'].map(c => sentimentData[c] && sentimentData[c].score).filter(x=>x!=null);
  const riskAvg = risk.reduce((a,b)=>a+b,0)/(risk.length||1);
  const safeAvg = safe.reduce((a,b)=>a+b,0)/(safe.length||1);
  const diff = riskAvg - safeAvg;
  let mood, dot, sub;
  if (diff > 8){ mood='Risk-On'; dot='#10b981'; sub='Risk currencies leading — appetite for yield.'; }
  else if (diff < -8){ mood='Risk-Off'; dot='#ef4444'; sub='Safe havens bid — defensive flows dominate.'; }
  else { mood='Mixed'; dot='#f59e0b'; sub='No clear risk regime — trade individual stories.'; }
  moodVal.innerHTML = `<span class="mood-dot" style="background:${dot};"></span>${mood}`;
  moodSub.textContent = sub;

  usdEl.textContent = `${usd.score} · ${usd.bias}`;
  usdFill.style.width = usd.score + '%';
  usdFill.style.background = fillColor(usd.score);

  const arr = Object.values(sentimentData).filter(s => s.currency).sort((a,b)=>b.score-a.score);
  if (arr.length >= 2){
    const top = arr[0], bot = arr[arr.length-1];
    vsVal.textContent = `${top.currency} ${top.score} vs ${bot.currency} ${bot.score}`;
    const suggestedPair = `${top.currency}/${bot.currency}`;
    vsSub.textContent = `Watch ${suggestedPair} — biggest strength gap (${top.score - bot.score} pts)`;
  }
}

function renderMovers(){
  const grid = document.getElementById('movers-grid');
  if (!grid) return;
  const cards = ALL_PAIRS.map(p => {
    const b = computePairBias(p.pair.split('/')[0], p.pair.split('/')[1]);
    const pr = getPairPrice(p.pair);
    return { pair: p.pair, b, pr };
  }).filter(x => x.b);

  const mostBull = [...cards].filter(x=>x.b.bias==='Bullish').sort((a,b)=>b.b.gap-a.b.gap)[0];
  const mostBear = [...cards].filter(x=>x.b.bias==='Bearish').sort((a,b)=>a.b.gap-b.b.gap)[0];
  const withChg = cards.filter(x => x.pr && x.pr.change_24h != null);
  const topGain = [...withChg].sort((a,b)=>b.pr.change_24h - a.pr.change_24h)[0];
  const topLoss = [...withChg].sort((a,b)=>a.pr.change_24h - b.pr.change_24h)[0];

  function card(tag, tagClass, item, kind){
    if (!item) return `<div class="mover-card"><div class="mover-tag ${tagClass}">${tag}</div><div class="mover-pair">—</div><div class="mover-meta">No data</div></div>`;
    let meta = '';
    if (kind === 'bias') meta = `Gap ${item.b.gap > 0 ? '+' : ''}${item.b.gap} pts`;
    else if (item.pr) {
      const c = item.pr.change_24h;
      const sign = c > 0 ? '+' : '';
      meta = `${formatPrice(item.pair, item.pr.price)}  ${sign}${c.toFixed(2)}%`;
    }
    return `<div class="mover-card"><div class="mover-tag ${tagClass}">${tag}</div><div class="mover-pair">${item.pair}</div><div class="mover-meta">${meta}</div></div>`;
  }

  grid.innerHTML =
    card('🟢 Strongest Bullish', 'tag-bull', mostBull, 'bias') +
    card('🔴 Strongest Bearish', 'tag-bear', mostBear, 'bias') +
    card('▲ Biggest Gainer 24h', 'tag-up', topGain, 'price') +
    card('▼ Biggest Loser 24h', 'tag-down', topLoss, 'price');
}

function pairCard(p){
  const [base, quote] = p.pair.split('/');
  const b = computePairBias(base, quote);
  const pr = getPairPrice(p.pair);
  const watch = getWatchlist().includes(p.pair);

  if (!b) return '';
  const conv = Math.abs(b.gap);
  const convLabel = conv >= 30 ? 'High' : conv >= 15 ? 'Medium' : 'Low';
  const isHigh = conv >= 30;

  let priceBlock = '';
  if (pr){
    const sign = pr.change_24h > 0 ? '+' : '';
    const chgClass = pr.change_24h > 0 ? 'up' : pr.change_24h < 0 ? 'down' : '';
    priceBlock = `
      <div class="pc-price-row">
        <div>
          <div class="pc-price">${formatPrice(p.pair, pr.price)}</div>
          ${pr.derived ? '<span class="pc-derived" title="Calculated from live USD pairs">DERIVED</span>' : ''}
        </div>
        <div class="pc-change ${chgClass}">${sign}${pr.change_24h.toFixed(2)}% <span style="font-size:10px;color:var(--text-muted);font-weight:500;">24h</span></div>
      </div>`;
  } else {
    priceBlock = `<div class="pc-price-row"><div class="pc-no-price">Price unavailable</div></div>`;
  }

  const baseFlag = FLAGS[base] || '';
  const quoteFlag = FLAGS[quote] || '';
  const faceoff = `
    <div class="faceoff">
      <div class="faceoff-label">Strength face-off</div>
      <div class="faceoff-bars">
        <div class="fb-row">
          <div class="fb-curr">${baseFlag} ${base}</div>
          <div class="fb-track"><div class="fb-fill" style="width:${b.baseScore}%;background:${fillColor(b.baseScore)};"></div></div>
          <div class="fb-score">${b.baseScore}</div>
        </div>
        <div class="fb-row">
          <div class="fb-curr">${quoteFlag} ${quote}</div>
          <div class="fb-track"><div class="fb-fill" style="width:${b.quoteScore}%;background:${fillColor(b.quoteScore)};"></div></div>
          <div class="fb-score">${b.quoteScore}</div>
        </div>
      </div>
    </div>`;

  return `
    <div class="pair-card ${isHigh ? 'high-conviction' : ''}" data-pair="${p.pair}">
      <div class="pc-top">
        <div class="pc-id">
          <span class="pc-flags">${baseFlag}${quoteFlag}</span>
          <span class="pc-name">${p.pair}</span>
          <button class="pc-fav ${watch ? 'on' : ''}" data-watch="${p.pair}" title="${watch ? 'Remove from watchlist' : 'Add to watchlist'}">${watch ? '★' : '☆'}</button>
        </div>
        <div class="pc-bias">
          <span class="pc-badge ${biasClass(b.bias)}">${b.bias}</span>
          <div class="pc-conviction">${convLabel} · gap ${b.gap > 0 ? '+' : ''}${b.gap}</div>
        </div>
      </div>
      ${priceBlock}
      ${faceoff}
      <div class="pc-rationale">${rationale(p.pair, b)}</div>
    </div>`;
}

function render(){
  const grid = document.getElementById('pair-grid');
  if (!grid) return;
  const watch = getWatchlist();
  let items = ALL_PAIRS.map(p => {
    const [b, q] = p.pair.split('/');
    return { ...p, _b: computePairBias(b, q), _pr: getPairPrice(p.pair) };
  }).filter(x => x._b);

  if (activeFilter === 'major') items = items.filter(x => x.cat === 'major');
  else if (activeFilter === 'jpy') items = items.filter(x => x.cat === 'jpy');
  else if (activeFilter === 'commodity') items = items.filter(x => x.cat === 'commodity');
  else if (activeFilter === 'bullish') items = items.filter(x => x._b.bias === 'Bullish');
  else if (activeFilter === 'bearish') items = items.filter(x => x._b.bias === 'Bearish');
  else if (activeFilter === 'conviction') items = items.filter(x => Math.abs(x._b.gap) >= 30);
  else if (activeFilter === 'watchlist') items = items.filter(x => watch.includes(x.pair));

  if (activeSort === 'conviction') items.sort((a,b) => Math.abs(b._b.gap) - Math.abs(a._b.gap));
  else if (activeSort === 'change') items.sort((a,b) => ((b._pr && b._pr.change_24h) || -999) - ((a._pr && a._pr.change_24h) || -999));
  else items.sort((a,b) => a.pair.localeCompare(b.pair));

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">No pairs match this filter${activeFilter==='watchlist' ? '. Tap ☆ on any pair to add it to your watchlist.' : '.'}</div>`;
  } else {
    grid.innerHTML = items.map(pairCard).join('');
  }

  grid.querySelectorAll('.pc-fav').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); toggleWatch(btn.dataset.watch); });
  });
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    render();
  });
});
document.getElementById('sort-select').addEventListener('change', e => {
  activeSort = e.target.value;
  render();
});

loadAllData();

})();
