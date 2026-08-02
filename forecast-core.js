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

  // ── settlement countdown (entry + 24h horizon) ──
  function countdown(entryTime) {
    if (!entryTime) return null;
    const due = new Date(entryTime).getTime() + 24 * 3600 * 1000;
    const ms = due - Date.now();
    if (ms <= 0) return 'Settling at next run';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return 'Settles in ' + (h > 0 ? h + 'h ' : '') + m + 'm';
  }

  // ── per-pair track record from an already-fetched ledger (no extra query) ──
  function pairStats(rows, pair) {
    const graded = rows.filter(function (r) {
      return r.pair === pair && r.status === 'settled' && (r.outcome === 'hit' || r.outcome === 'miss');
    });
    if (!graded.length) return { graded: 0, winRate: null };
    const hits = graded.filter(function (r) { return r.outcome === 'hit'; }).length;
    return { graded: graded.length, hits: hits, winRate: hits / graded.length * 100 };
  }

  // ── frozen drivers -> premium chips (only stored drivers, never invented) ──
  function driverChips(drivers, base, quote) {
    const d = drivers || {};
    const items = [].concat(
      (Array.isArray(d.base) ? d.base : []).map(function (t) { return { c: base, t: t }; }),
      (Array.isArray(d.quote) ? d.quote : []).map(function (t) { return { c: quote, t: t }; })
    ).filter(function (x) { return x.t; });
    if (!items.length) return '';
    return '<div class="drv-chips">' + items.slice(0, 6).map(function (x) {
      return '<span class="drv-chip"><b>' + esc(x.c) + '</b>' + esc(x.t) + '</span>';
    }).join('') + '</div>';
  }

  // ── conviction as a segmented meter (aria-labelled) ──
  function convMeter(n) {
    let segs = '';
    for (let i = 1; i <= 5; i++) segs += '<span class="cm-seg' + (i <= n ? ' on' : '') + '"></span>';
    return '<span class="conv-meter5" role="img" aria-label="Conviction ' + n + ' of 5">' + segs
      + '<span class="cm-num">' + n + '/5</span></span>';
  }

  // last-N settled results as coloured squares
  function resultSquares(rows, pair, n) {
    const settled = rows.filter(function (r) {
      return r.pair === pair && r.status === 'settled' && r.direction !== 'Stand Aside';
    }).slice(0, n || 10);
    if (!settled.length) return '';
    return '<span class="resq" role="img" aria-label="Last ' + settled.length + ' results">'
      + settled.map(function (r) {
        const c = r.outcome === 'hit' ? 'h' : r.outcome === 'miss' ? 'm' : 'f';
        return '<i class="' + c + '" title="' + fmtDate(r.forecast_date) + ' — ' + (r.outcome || '') + '"></i>';
      }).join('') + '</span>';
  }

  // ── count-up animation for stat figures (respects reduced motion) ──
  function countUp(el, target, suffix, decimals) {
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !isFinite(target)) { el.textContent = target.toFixed(decimals || 0) + (suffix || ''); return; }
    const t0 = performance.now(), dur = 700;
    function tick(t) {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (target * e).toFixed(decimals || 0) + (suffix || '');
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ── upcoming high-impact events from the production weekly report API ──
  // Lazy + cached; fails soft to null so callers can hide the section.
  let _eventsCache;
  function fetchKeyEvents() {
    if (_eventsCache !== undefined) return Promise.resolve(_eventsCache);
    return fetch('https://fxnewsbias-cron.dineshsanther123gf.workers.dev/api/weekly-report')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { _eventsCache = (j && Array.isArray(j.key_events)) ? j.key_events : null; return _eventsCache; })
      .catch(function () { _eventsCache = null; return null; });
  }

  // ── forecast detail modal (institutional trade-report style) ──
  function closeModal() {
    const m = document.getElementById('fc-modal');
    if (m) { m.remove(); document.body.style.overflow = ''; }
    if (closeModal._prev && closeModal._prev.focus) closeModal._prev.focus();
  }
  function openModal(r, allRows) {
    closeModal();
    closeModal._prev = document.activeElement;
    const base = r.pair.slice(0, 3), quote = r.pair.slice(4);
    const bs = r.base_score == null ? 50 : r.base_score, qs = r.quote_score == null ? 50 : r.quote_score;
    const cls = dirClass(r.direction);
    const chip = cls === 'long' ? 'dir-long' : cls === 'short' ? 'dir-short' : 'dir-aside';
    const ps = pairStats(allRows || [], r.pair);
    const mv = r.move_pct == null ? null : parseFloat(r.move_pct);

    function bar(cc, s) {
      return '<div class="gapbar"><span class="cc">' + cc + '</span>'
        + '<span class="track"><span class="fill" style="width:' + s + '%;background:' + scoreColor(s) + '"></span></span>'
        + '<span class="sc" style="color:' + scoreColor(s) + '">' + s + '</span></div>';
    }

    const wrap = document.createElement('div');
    wrap.id = 'fc-modal';
    wrap.innerHTML =
      '<div class="fcm-backdrop"></div>'
      + '<div class="fcm-panel" role="dialog" aria-modal="true" aria-label="' + esc(r.pair) + ' forecast detail">'
      + '<div class="fcm-head"><div><span class="fcard-pair">' + pairFlags(r.pair) + ' ' + esc(r.pair) + '</span>'
      + ' <span class="dir-chip ' + chip + '">' + dirLabel(r.direction) + '</span></div>'
      + '<button class="fcm-close" aria-label="Close">✕</button></div>'
      + '<div class="fcm-body">'
      + '<div class="fcm-sec"><h4>Overview</h4><div class="fcard-nums" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr));">'
      + '<div class="fnum"><div class="fnum-lab">Entry</div><div class="fnum-val">' + fmtPrice(r.pair, r.entry_price) + '</div></div>'
      + '<div class="fnum"><div class="fnum-lab">Published</div><div class="fnum-val" style="font-size:12px;">' + fmtTime(r.entry_time) + '</div></div>'
      + (r.status === 'settled'
        ? '<div class="fnum"><div class="fnum-lab">Result</div><div class="fnum-val">' + fmtPrice(r.pair, r.result_price) + '</div></div>'
          + '<div class="fnum"><div class="fnum-lab">Move</div><div class="fnum-val" style="color:' + (mv > 0 ? '#34d399' : mv < 0 ? '#fb7185' : '#aab6c8') + '">' + fmtPct(r.move_pct, true) + '</div></div>'
        : '<div class="fnum"><div class="fnum-lab">Status</div><div class="fnum-val" style="font-size:12px;">' + esc(countdown(r.entry_time) || 'Open') + '</div></div>')
      + '</div>'
      + (r.conviction ? '<div style="margin-top:10px;">' + convMeter(r.conviction) + '</div>' : '')
      + '<div style="margin-top:10px;">' + outcomePill(r) + '</div></div>'
      + '<div class="fcm-sec"><h4>Sentiment Snapshot — frozen at publish</h4><div class="gapbars">' + bar(base, bs) + bar(quote, qs) + '</div>'
      + '<div class="fcm-gap">Gap <b style="color:' + (r.gap > 0 ? '#34d399' : r.gap < 0 ? '#fb7185' : '#aab6c8') + '">' + (r.gap > 0 ? '+' : '') + r.gap + '</b></div></div>'
      + (driverChips(r.drivers, base, quote) ? '<div class="fcm-sec"><h4>Evidence — stored drivers</h4>' + driverChips(r.drivers, base, quote) + '</div>' : '')
      + (r.narrative ? '<div class="fcm-sec"><h4>Narrative</h4><p class="fcm-narr">' + esc(r.narrative) + '</p></div>' : '')
      + '<div class="fcm-sec" id="fcm-events" hidden><h4>High-Impact Events — ' + base + ' &amp; ' + quote + '</h4><div id="fcm-events-list"></div></div>'
      + (ps.graded >= 3
        ? '<div class="fcm-sec"><h4>' + esc(r.pair) + ' Track Record</h4><div class="fcm-track"><span class="mono" style="color:' + (ps.winRate >= 50 ? '#34d399' : '#fb7185') + ';font-weight:700;">' + ps.winRate.toFixed(0) + '%</span> win rate · ' + ps.graded + ' graded ' + resultSquares(allRows || [], r.pair, 10) + '</div></div>'
        : '')
      + '<div class="fcm-foot"><a href="/forecast-pair?pair=' + pairSlug(r.pair) + '" class="fcard-link">Full pair analysis →</a></div>'
      + '</div></div>';
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    wrap.querySelector('.fcm-backdrop').addEventListener('click', closeModal);
    wrap.querySelector('.fcm-close').addEventListener('click', closeModal);
    document.addEventListener('keydown', function esc_(e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc_); }
    });
    wrap.querySelector('.fcm-close').focus();
    // lazy events — real weekly-report data, hidden entirely if unavailable
    fetchKeyEvents().then(function (evs) {
      if (!evs) return;
      const rel = evs.filter(function (e) {
        return e && (e.currency === base || e.currency === quote) && String(e.impact || '').toLowerCase() === 'high';
      }).slice(0, 4);
      if (!rel.length) return;
      const box = document.getElementById('fcm-events');
      if (!box) return;
      document.getElementById('fcm-events-list').innerHTML = rel.map(function (e) {
        return '<div class="fcm-ev"><span class="day-chip">' + esc(e.day || '—') + '</span>'
          + '<span class="fcm-ev-t">' + esc(e.event || '') + '</span>'
          + '<span class="fcm-ev-c mono">' + (FLAGS[e.currency] || '') + ' ' + esc(e.currency || '') + '</span></div>';
      }).join('');
      box.hidden = false;
    });
  }

  // ── shared Pro-access state (freemium split) ──
  // localStorage gives an instant best-guess; firebase.js's userLoaded event
  // delivers the authoritative value. Gated sections render a teaser first and
  // upgrade to the real content if/when Pro resolves true.
  var _proState = false;
  try { _proState = localStorage.getItem('fxnb_is_pro') === 'true'; } catch (_) {}
  var _proCbs = [];
  window.addEventListener('userLoaded', function (e) {
    var p = !!(e.detail && e.detail.isPro);
    _proState = p;
    try { localStorage.setItem('fxnb_is_pro', p ? 'true' : 'false'); } catch (_) {}
    _proCbs.forEach(function (cb) { try { cb(p); } catch (_) {} });
  });
  function isPro() { return _proState === true; }
  function onProChange(cb) { _proCbs.push(cb); }

  var STRIPE_BUY = 'https://buy.stripe.com/4gMcN73RE0Dr7fpg3c0RG01';

  // Locked teaser shown to free users in place of a Pro-only section.
  function lockCard(title, sub) {
    return '<div class="fc-lock">'
      + '<div class="fc-lock-ico">🔒</div>'
      + '<div class="fc-lock-title">' + esc(title) + '</div>'
      + (sub ? '<div class="fc-lock-sub">' + esc(sub) + '</div>' : '')
      + '<a class="fc-lock-btn" href="' + STRIPE_BUY + '">⭐ Unlock with Pro — $30/mo</a>'
      + '<div class="fc-lock-note">7-day free trial · Already Pro? <a href="/login">Log in →</a></div>'
      + '</div>';
  }

  // Slim upgrade strip for the public proof pages (ledger/performance).
  function upgradeStrip(msg) {
    return '<a class="fc-upstrip" href="' + STRIPE_BUY + '">'
      + '<span class="fc-upstrip-txt">' + esc(msg || "This is the public track record. Pro members get today's live calls the moment they publish.") + '</span>'
      + '<span class="fc-upstrip-cta">Go Pro — $30/mo →</span>'
      + '</a>';
  }

  window.FC = {
    isPro: isPro, onProChange: onProChange, lockCard: lockCard, upgradeStrip: upgradeStrip,
    fetchLedger: fetchLedger, fetchPrices: fetchPrices, fetchNewsFor: fetchNewsFor,
    fetchSentimentHistory: fetchSentimentHistory, computeStats: computeStats,
    fmtPct: fmtPct, fmtPrice: fmtPrice, fmtDate: fmtDate, fmtTime: fmtTime,
    dirLabel: dirLabel, dirClass: dirClass, outcomePill: outcomePill, convDots: convDots,
    scoreColor: scoreColor, pairFlags: pairFlags, pairSlug: pairSlug, esc: esc, spark: spark,
    countdown: countdown, pairStats: pairStats, driverChips: driverChips, convMeter: convMeter,
    resultSquares: resultSquares, countUp: countUp, openModal: openModal, closeModal: closeModal,
    fetchKeyEvents: fetchKeyEvents,
    FLAGS: FLAGS,
  };
})();
