(function() {
'use strict';

const SUPABASE_URL = 'https://vtbmtxtgtdprpbilragm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ym10eHRndGRwcnBiaWxyYWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NDA0NzMsImV4cCI6MjA5MzExNjQ3M30.brlTWgFgTw0536PO_fXWgrGzSkqAMhOojlUA-UwlMnA';

function getImpactClass(impact) {
  if (!impact) return 'imp-med';
  const i = impact.toLowerCase();
  if (i === 'high') return 'imp-high';
  if (i === 'low') return 'imp-low';
  return 'imp-med';
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff/60)}h ago`;
  return `${Math.floor(diff/1440)}d ago`;
}

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function decodeEntities(s){
  if(!s) return '';
  const t = document.createElement('textarea'); t.innerHTML = String(s); return t.value;
}

function getHost(url){
  try { return new URL(url).hostname.replace(/^www\./,''); } catch(e) { return ''; }
}

function favicon(url, size){
  const host = getHost(url);
  if(!host) return '';
  return `https://www.google.com/s2/favicons?domain=${host}&sz=${size||64}`;
}

function sourceLogoHTML(item){
  const host = getHost(item.url);
  const src = item.source || host || 'News';
  const initials = src.replace(/[^A-Za-z ]/g,'').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase() || 'N';
  if(host){
    return `<img src="${esc(favicon(item.url, 128))}" alt="${esc(src)}" loading="lazy" onerror="this.outerHTML='<div class=\\'fav-fallback\\'>${esc(initials)}</div>'"><div class="src-badge" title="${esc(src)}">${esc(src)}</div>`;
  }
  return `<div class="fav-fallback">${esc(initials)}</div><div class="src-badge">${esc(src)}</div>`;
}

function pillsForCurrencies(arr, impact){
  if(!Array.isArray(arr) || arr.length===0) return '';
  const isHigh = (impact||'').toLowerCase()==='high';
  const cls = isHigh ? 'affect-bear' : 'affect-bull';
  const arrow = isHigh ? '⬇' : '⬆';
  return arr.slice(0,6).map(c => `<span class="affect-pill ${cls}">${esc(c)} ${arrow}</span>`).join('');
}

async function loadNews() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/news?order=id.desc&limit=20`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const data = await res.json();
    if (!data || data.length === 0) return;

    const featured = document.querySelector('.featured');
    if (featured && data[0]) {
      const top = data[0];
      const topTitle = decodeEntities(top.title);
      const affected = Array.isArray(top.currencies_affected) ? top.currencies_affected : [];
      featured.innerHTML = `
        <span class="featured-tag">🔥 Top Story · ${esc(top.impact || 'Medium')} Impact</span>
        <h2 class="featured-title">${esc(topTitle)}</h2>
        <p class="featured-summary">Latest from ${esc(top.source || 'News Source')} — tap to read the full article on the publisher's site.</p>
        <div class="featured-meta">
          <span>📰 ${esc(top.source || 'News Source')}</span>
          <span>⏰ ${esc(timeAgo(top.created_at))}</span>
          ${pillsForCurrencies(affected, top.impact)}
        </div>
      `;
      featured.style.cursor = 'pointer';
      featured.onclick = () => { if (top.url) window.open(top.url, '_blank', 'noopener'); };
    }

    const updEl = document.querySelector('.section-update');
    if (updEl) updEl.textContent = `⏱ Updated ${timeAgo(data[0].created_at)}`;

    const parent = document.getElementById('news-feed');
    if (!parent) return;
    parent.querySelectorAll('.news-card').forEach(card => card.remove());

    data.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'news-card';
      const titleClean = decodeEntities(item.title);
      const affected = Array.isArray(item.currencies_affected) ? item.currencies_affected : [];
      card.setAttribute('data-source', (item.source || '').toLowerCase());
      card.setAttribute('data-impact', (item.impact || 'medium').toLowerCase());
      card.setAttribute('data-title', titleClean.toLowerCase());
      card.setAttribute('data-currencies', affected.join(',').toLowerCase());

      const summaryLine = affected.length
        ? `Affecting <b>${esc(affected.join(', '))}</b> — tap to read the full article on ${esc(item.source || 'the source')}.`
        : `Tap to read the full article on ${esc(item.source || 'the source')}.`;

      card.innerHTML = `
        <div class="news-img">${sourceLogoHTML(item)}</div>
        <div class="news-content">
          <div class="news-meta-top">
            <span class="news-impact ${getImpactClass(item.impact)}">${esc(item.impact || 'Medium')} Impact</span>
            <span>📰 ${esc(item.source || 'News')}</span>
            <span>⏰ ${esc(timeAgo(item.created_at))}</span>
          </div>
          <h3 class="news-title">${esc(titleClean)}</h3>
          <p class="news-summary">${summaryLine}</p>
          <div class="news-affects">${pillsForCurrencies(affected, item.impact)}</div>
        </div>
      `;

      card.style.cursor = 'pointer';
      card.onclick = () => {
        if (item.url) window.open(item.url, '_blank', 'noopener');
      };

      parent.appendChild(card);
    });

  } catch(e) {}
}

function setupFilters() {
  const catTabs = document.querySelectorAll('.cat-tab');
  catTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      catTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const newsCards = document.querySelectorAll('.news-card');
      if (index === 0) {
        newsCards.forEach(card => card.style.display = 'flex');
        return;
      }
      const filterMap = {
        1: ['central bank', 'fed', 'ecb', 'boe', 'boj', 'rba', 'rate hike', 'rate cut'],
        2: ['gdp', 'cpi', 'nfp', 'pmi', 'unemployment', 'inflation', 'payroll'],
        3: ['geopolit', 'war', 'tension', 'conflict', 'political', 'middle east', 'sanction'],
        4: ['oil', 'gold', 'silver', 'commodity', 'iron', 'copper', 'opec'],
        5: ['usd', 'dollar', 'federal reserve'],
        6: ['eur', 'euro', 'ecb', 'eurozone'],
        7: ['gbp', 'sterling', 'britain', 'uk unemployment', 'bank of england'],
        8: ['jpy', 'yen', 'boj', 'japan']
      };
      const keywords = filterMap[index] || [];
      const currencyMap = { 5:'usd', 6:'eur', 7:'gbp', 8:'jpy' };
      const wantedCurrency = currencyMap[index];
      newsCards.forEach(card => {
        const title = (card.getAttribute('data-title') || '').toLowerCase();
        const currs = (card.getAttribute('data-currencies') || '').toLowerCase();
        let matches;
        if (wantedCurrency) {
          matches = currs.split(',').includes(wantedCurrency) || keywords.some(kw => title.includes(kw));
        } else {
          matches = keywords.some(kw => title.includes(kw));
        }
        card.style.display = matches ? 'flex' : 'none';
      });
    });
  });

  const sourceTags = document.querySelectorAll('.source-tag');
  sourceTags.forEach(tag => {
    tag.style.cursor = 'pointer';
    tag.addEventListener('click', () => {
      sourceTags.forEach(t => t.style.background = '');
      tag.style.background = '#eff6ff';
      tag.style.borderRadius = '6px';
      tag.style.padding = '4px 8px';

      const sourceNameEl = tag.querySelector('.source-name');
      const rawText = (sourceNameEl ? sourceNameEl.textContent : tag.textContent).trim().toLowerCase()
        .replace(/[^\w\s]/g, '').trim();

      const newsCards = document.querySelectorAll('.news-card');
      let visible = 0;
      newsCards.forEach(card => {
        const cardSource = (card.getAttribute('data-source') || '').toLowerCase();
        const words = rawText.split(' ').filter(w => w.length > 2);
        const match = words.some(w => cardSource.includes(w));
        card.style.display = match ? 'flex' : 'none';
        if (match) visible++;
      });
      if (visible === 0) newsCards.forEach(c => c.style.display = 'flex');
    });
  });
}

async function loadTrending() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/news?order=id.desc&limit=5`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const data = await res.json();
    if (!data || data.length === 0) return;

    const trendingList = document.getElementById('trending-list');
    if (!trendingList) return;

    trendingList.innerHTML = data.map((item, index) => `
      <div class="trending-item" data-title="${item.title.toLowerCase()}" style="cursor:pointer;">
        <span class="trending-num">${index + 1}</span>
        <div>
          <div class="trending-title">${item.title.length > 55 ? item.title.substring(0, 55) + '...' : item.title}</div>
          <span class="trending-meta">${item.source || 'News'} · ${timeAgo(item.created_at)}</span>
        </div>
      </div>
    `).join('');

    trendingList.querySelectorAll('.trending-item').forEach(item => {
      item.addEventListener('click', () => {
        const title = item.getAttribute('data-title');
        const cards = document.querySelectorAll('.news-card');
        cards.forEach(card => {
          card.style.display = 'flex';
          card.style.border = '';
          card.style.boxShadow = '';
        });
        const titleWords = title.split(' ').filter(w => w.length > 4).slice(0, 3);
        let found = null;
        cards.forEach(card => {
          const cardTitle = (card.getAttribute('data-title') || '').toLowerCase();
          const matches = titleWords.some(w => cardTitle.includes(w));
          if (matches && !found) {
            found = card;
            card.style.border = '2px solid #2563eb';
            card.style.boxShadow = '0 0 0 4px rgba(37,99,235,0.1)';
          }
        });
        if (found) found.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else document.querySelector('.section-title')?.scrollIntoView({ behavior: 'smooth' });
      });
    });

  } catch(e) {}
}

loadNews();
loadTrending();
setupFilters();

window.addEventListener('userLoaded', (e) => {
  if (e.detail && e.detail.isPro) {
    document.querySelectorAll('.ad-slot').forEach(ad => {
      ad.style.display = 'none';
    });
  }
  if (e.detail && (e.detail.email || e.detail.uid)) {
    const briefCard = document.getElementById('daily-brief-card');
    if (briefCard) briefCard.style.display = 'none';
  }
});

const _d = new Date();
const _days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _topbarDate = document.getElementById('topbar-date');
if (_topbarDate) _topbarDate.textContent = `📅 ${_days[_d.getDay()]}, ${_months[_d.getMonth()]} ${_d.getDate()}, ${_d.getFullYear()}`;

})();
