/* FXNB Forecast Intelligence — shared data layer + helpers.
   Every /forecast* page uses this. Reads the public (RLS
   read-only) pair_forecasts ledger straight from Supabase,
   exactly like the rest of the site reads sentiment/news. */
(function () {
  'use strict';
  const SB = 'https://vtbmtxtgtdprpbilragm.supabase.co';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ym10eHRndGRwcnBiaWxyYWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NDA0NzMsImV4cCI6MjA5MzExNjQ3M30.brlTWgFgTw0536PO_fXWgrGzSkqAMhOojlUA-UwlMnA';
  const HEADERS = { apikey: KEY, Authorization: 'Bearer ' + KEY };

  const FLAGS = { USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧', JPY:'🇯🇵', AUD:'🇦🇺', CAD:'🇨🇦', CHF:'🇨🇭', NZD:'🇳🇿' };

  async function sb(path) {
    const r = await fetch(SB + '/rest/v1/' + path, { headers: HEADERS });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // Full ledger (newest first). ~7 rows/weekday -> years of headroom at 2000.
  function fetchLedger(limit) {
    return sb('pair_forecasts?select=*&order=forecast_date.desc,pair.asc&limit=' + (limit || 2000));
  }
  function fetchPrices() { return sb('prices?select=pair,price,change_pct,updated_at'); }
  function fetchNewsFor(ccys, limit) {
    // currencies_affected is an array column; cs = contains
    const list = ccys.map(function (c) { return '"' + c + '"'; }).join(',');
    return sb('news?select=title,source,url,impact,currencies_affected,created_at&currencies_affected=cs.{' + list + '}&order=id.desc&limit=' + (limit || 6));
  }
  function fetchSentimentHistory(ccy, limit) {
    return sb('sentiment?select=score,created_at&currency=eq.' + ccy + '&order=id.desc&limit=' + (limit || 30));
  }

  // ── stats over settled directional forecasts ──
  function computeStats(rows) {
    const dir = rows.filter(function (r) { return r.direction !== 'Stand Aside'; });
    const settled = dir.filter(function (r) { return r.status === 'settled'; });
    const graded = settled.filter(function (r) { return r.outcome === 'hit' || r.outcome === 'miss'; });
    const hits = settled.filter(function (r) { return r.outcome === 'hit'; });
    const misses = settled.filter(function (r) { return r.outcome === 'miss'; });
    const flats = settled.filter(function (r) { return r.outcome === 'flat'; });
    const asides = rows.filter(function (r) { return r.direction === 'Stand Aside'; });

    function winRate(list) {
      const g = list.filter(function (r) { return r.outcome === 'hit' || r.outcome === 'miss'; });
      if (!g.length) return null;
      return g.filter(function (r) { return r.outcome === 'hit'; }).length / g.length * 100;
    }
    function since(days) {
      const cut = Date.now() - days * 864e5;
      return settled.filter(function (r) { return new Date(r.forecast_date).getTime() >= cut; });
    }
    function avgMove(list) {
      if (!list.length) return null;
      return list.reduce(function (s, r) { return s + Math.abs(parseFloat(r.move_pct) || 0); }, 0) / list.length;
    }
    // streak: walk settled graded results newest-first
    const seq = graded.slice().sort(function (a, b) { return b.forecast_date < a.forecast_date ? -1 : 1; });
    let streak = 0, streakType = null;
    for (var i = 0; i < seq.length; i++) {
      if (streakType === null) { streakType = seq[i].outcome; streak = 1; }
      else if (seq[i].outcome === streakType) streak++;
      else break;
    }
    let best = 0, cur = 0;
    seq.slice().reverse().forEach(function (r) {
      if (r.outcome === 'hit') { cur++; if (cur > best) best = cur; } else cur = 0;
    });
    const perPair = {};
    settled.forEach(function (r) {
      const p = perPair[r.pair] || (perPair[r.pair] = { pair: r.pair, n: 0, hits: 0, graded: 0, sumMove: 0 });
      p.n++;
      if (r.outcome === 'hit' || r.outcome === 'miss') { p.graded++; if (r.outcome === 'hit') p.hits++; }
      p.sumMove += Math.abs(parseFloat(r.move_pct) || 0);
    });
    const wins = hits.map(function (r) { return parseFloat(r.move_pct) || 0; });
    const losses = misses.map(function (r) { return Math.abs(parseFloat(r.move_pct) || 0); });

    return {
      total: rows.length, directional: dir.length, settled: settled.length,
      open: dir.filter(function (r) { return r.status === 'open'; }).length,
      hits: hits.length, misses: misses.length, flats: flats.length, asides: asides.length,
      winRate: winRate(settled), winRate30: winRate(since(30)), winRate90: winRate(since(90)),
      avgWin: avgMove(hits), avgLoss: avgMove(misses),
      largestWin: wins.length ? Math.max.apply(null, wins.map(Math.abs)) : null,
      largestLoss: losses.length ? Math.max.apply(null, losses) : null,
      streak: streak, streakType: streakType, bestStreak: best,
      standAsidePct: rows.length ? asides.length / rows.length * 100 : null,
      perPair: Object.values(perPair).map(function (p) {
        return { pair: p.pair, n: p.n, winRate: p.graded ? p.hits / p.graded * 100 : null, avgMove: p.n ? p.sumMove / p.n : null };
      }).sort(function (a, b) { return (b.winRate || 0) - (a.winRate || 0); }),
    };
  }

  // ── formatting ──
  function fmtPct(v, signed) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    const n = parseFloat(v);
    return (signed && n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtPrice(pair, v) {
    if (v === null || v === undefined) return '—';
    const n = parseFloat(v);
    return pair.indexOf('JPY') >= 0 ? n.toFixed(3) : n.toFixed(5);
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d + (String(d).length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  }
  function dirLabel(d) { return d === 'Bullish' ? 'BUY' : d === 'Bearish' ? 'SELL' : 'STAND ASIDE'; }
  function dirClass(d) { return d === 'Bullish' ? 'long' : d === 'Bearish' ? 'short' : 'aside'; }
  function outcomePill(r) {
    if (r.status === 'open') return '<span class="st-pill st-open">● Open</span>';
    if (r.outcome === 'hit') return '<span class="st-pill st-hit">✓ Hit</span>';
    if (r.outcome === 'miss') return '<span class="st-pill st-miss">✕ Miss</span>';
    if (r.outcome === 'flat') return '<span class="st-pill st-flat">– Flat</span>';
    return '<span class="st-pill st-na">– N/A</span>';
  }
  function convDots(n) {
    let h = '<span class="conv-dots" role="img" aria-label="Conviction ' + n + ' of 5">';
    for (var i = 1; i <= 5; i++) h += '<span class="conv-dot' + (i <= n ? ' on' : '') + '"></span>';
    return h + '</span>';
  }
  function scoreColor(s) { return s >= 55 ? '#34d399' : s <= 45 ? '#fb7185' : '#fbbf24'; }
  function pairFlags(pair) {
    const b = pair.slice(0, 3), q = pair.slice(4);
    return (FLAGS[b] || '') + (FLAGS[q] || '');
  }
  function pairSlug(pair) { return pair.replace('/', '-').toLowerCase(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // sparkline for sentiment history (ascending values)
  function spark(values, color, w, h) {
    w = w || 120; h = h || 32;
    const v = (values || []).filter(function (x) { return x != null; });
    if (v.length < 2) return '';
    const min = Math.min.apply(null, v), max = Math.max.apply(null, v), rng = (max - min) || 1;
    const pts = v.map(function (s, i) {
      return [(i / (v.length - 1)) * w, h - 3 - ((s - min) / rng) * (h - 6)];
    });
    const d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:' + h + 'px;display:block;"><path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="' + color + '" opacity="0.1"/><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }

  window.FC = {
    fetchLedger: fetchLedger, fetchPrices: fetchPrices, fetchNewsFor: fetchNewsFor,
    fetchSentimentHistory: fetchSentimentHistory, computeStats: computeStats,
    fmtPct: fmtPct, fmtPrice: fmtPrice, fmtDate: fmtDate, fmtTime: fmtTime,
    dirLabel: dirLabel, dirClass: dirClass, outcomePill: outcomePill, convDots: convDots,
    scoreColor: scoreColor, pairFlags: pairFlags, pairSlug: pairSlug, esc: esc, spark: spark,
    FLAGS: FLAGS,
  };
})();
