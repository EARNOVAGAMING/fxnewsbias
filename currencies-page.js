(function() {
'use strict';

const SUPABASE_URL = 'https://vtbmtxtgtdprpbilragm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ym10eHRndGRwcnBiaWxyYWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NDA0NzMsImV4cCI6MjA5MzExNjQ3M30.brlTWgFgTw0536PO_fXWgrGzSkqAMhOojlUA-UwlMnA';

const CURRENCY_INFO = {
  USD: { flag: '🇺🇸', name: 'US Dollar', bank: 'Federal Reserve' },
  EUR: { flag: '🇪🇺', name: 'Euro', bank: 'ECB' },
  GBP: { flag: '🇬🇧', name: 'British Pound', bank: 'Bank of England' },
  JPY: { flag: '🇯🇵', name: 'Japanese Yen', bank: 'Bank of Japan' },
  AUD: { flag: '🇦🇺', name: 'Australian Dollar', bank: 'RBA' },
  CAD: { flag: '🇨🇦', name: 'Canadian Dollar', bank: 'Bank of Canada' },
  CHF: { flag: '🇨🇭', name: 'Swiss Franc', bank: 'Swiss National Bank' },
  NZD: { flag: '🇳🇿', name: 'NZ Dollar', bank: 'RBNZ' }
};

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 60000);
  if (diff < 60) return diff + 'm ago';
  if (diff < 1440) return Math.floor(diff/60) + 'h ago';
  return Math.floor(diff/1440) + 'd ago';
}

async function loadCurrencies() {
  try {
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/sentiment?order=id.desc&limit=8',
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON } }
    );
    const data = await res.json();
    if (!data || data.length === 0) return;

    const updateEl = document.querySelector('.filter-update');
    if (updateEl && data[0]) updateEl.textContent = '⏱ Last update: ' + timeAgo(data[0].created_at);

    const bullishCount = data.filter(d => d.bias === 'Bullish').length;
    const bearishCount = data.filter(d => d.bias === 'Bearish').length;
    const neutralCount = data.filter(d => d.bias === 'Neutral').length;
    const filterBtns = document.querySelectorAll('.filter-btn');
    if (filterBtns[0]) filterBtns[0].textContent = 'All (' + data.length + ')';
    if (filterBtns[1]) filterBtns[1].textContent = '🟢 Bullish (' + bullishCount + ')';
    if (filterBtns[2]) filterBtns[2].textContent = '🔴 Bearish (' + bearishCount + ')';
    if (filterBtns[3]) filterBtns[3].textContent = '🟡 Neutral (' + neutralCount + ')';

    const grid = document.querySelector('.curr-grid');
    grid.innerHTML = '';

    data.forEach(item => {
      const info = CURRENCY_INFO[item.currency] || { flag: '🏳️', name: item.currency, bank: 'Central Bank' };
      const biasClass = item.bias === 'Bullish' ? 'bull-bg' : item.bias === 'Bearish' ? 'bear-bg' : 'neut-bg';
      const colorVar = item.bias === 'Bullish' ? 'var(--bull)' : item.bias === 'Bearish' ? 'var(--bear)' : 'var(--neutral)';
      const stanceClass = item.score >= 60 ? 'stance-hawk' : item.score <= 40 ? 'stance-dove' : 'stance-neut';
      const stanceText = item.score >= 60 ? 'Hawkish' : item.score <= 40 ? 'Dovish' : 'Neutral';

      const driversArr = Array.isArray(item.drivers) ? item.drivers : (item.drivers ? [item.drivers] : []);
      const drivers = driversArr.map(d => {
        const isPositive = item.bias === 'Bullish';
        return '<div class="driver"><span class="' + (isPositive ? 'driver-pos' : 'driver-neg') + '">' + (isPositive ? '▲' : '▼') + '</span> ' + d + '</div>';
      }).join('');

      const card = document.createElement('div');
      card.className = 'curr-card';
      card.setAttribute('data-bias', item.bias);
      card.innerHTML = `
        <div class="curr-top">
          <div class="curr-id">
            <span class="curr-flag">${info.flag}</span>
            <div class="curr-info"><h3>${item.currency}</h3><p>${info.name}</p></div>
          </div>
          <div class="curr-bias">
            <div class="curr-badge ${biasClass}">${item.bias}</div>
            <div class="curr-score" style="color:${colorVar};">${item.score}</div>
          </div>
        </div>
        <div class="curr-bar"><div class="curr-fill" style="width:${item.score}%;background:${colorVar};"></div></div>
        <div class="curr-section">
          <div class="curr-sec-label">🏦 ${info.bank} Stance</div>
          <div class="curr-bank">
            <span style="flex:1;">Based on latest sentiment analysis</span>
            <span class="bank-stance ${stanceClass}">${stanceText}</span>
          </div>
        </div>
        <div class="curr-section">
          <div class="curr-sec-label">📊 Key Drivers</div>
          <div class="driver-list">${drivers}</div>
        </div>
        <div class="curr-foot">
          <span class="curr-news-count">📰 Updated ${timeAgo(item.created_at)}</span>
          <a href="/news" class="curr-arrow">Deep Dive →</a>
        </div>
      `;
      grid.appendChild(card);
    });

  } catch(e) {}
}

function setupFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.textContent.trim();
      const cards = document.querySelectorAll('.curr-card');
      cards.forEach(card => {
        const bias = card.getAttribute('data-bias');
        if (filter.includes('All')) card.style.display = 'block';
        else if (filter.includes('Bullish') && bias === 'Bullish') card.style.display = 'block';
        else if (filter.includes('Bearish') && bias === 'Bearish') card.style.display = 'block';
        else if (filter.includes('Neutral') && bias === 'Neutral') card.style.display = 'block';
        else card.style.display = 'none';
      });
    });
  });
}

setupFilters();
loadCurrencies();

window.addEventListener('userLoaded', (e) => {
  if (e.detail.isPro) {
    document.querySelectorAll('.ad-slot').forEach(ad => ad.style.display = 'none');
  }
});

const _d = new Date();
const _days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _topbarDate = document.getElementById('topbar-date');
if (_topbarDate) _topbarDate.textContent = `📅 ${_days[_d.getDay()]}, ${_months[_d.getMonth()]} ${_d.getDate()}, ${_d.getFullYear()}`;

})();
