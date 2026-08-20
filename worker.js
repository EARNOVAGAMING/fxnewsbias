// Cloudflare Worker — serves static assets and injects SEO content into pair + currency pages

const CURRENCY_CODES = new Set(['usd','eur','gbp','jpy','aud','cad','chf','nzd']);

// Upstream host for the public API. Kept in one place so the published
// docs and emails only ever reference fxnewsbias.com.
const API_ORIGIN_HOST = 'fxnewsbias-cron.dineshsanther123gf.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Enforce HTTPS
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    // Public API, served from fxnewsbias.com so published docs never expose the
    // internal workers.dev hostname. Method, headers (including Authorization)
    // and body are forwarded untouched, and the upstream response is returned
    // as-is so status codes and X-RateLimit-* headers pass through unchanged.
    // Sits before the non-GET guard below so CORS preflight (OPTIONS) works.
    if (url.pathname.startsWith('/api/v1/')) {
      const upstream = new URL(request.url);
      upstream.hostname = API_ORIGIN_HOST;
      const res = await fetch(new Request(upstream.toString(), request));
      return new Response(res.body, res);
    }

    // Allow HEAD through to dynamic routing so Googlebot HEAD crawls return
    // 200 (not 404) for dynamically-generated pages like /forecast/:id/.
    // All other non-GET/HEAD methods (POST, PUT …) go straight to ASSETS.
    if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);

    // Sitemap — refresh lastmod to today on dynamic (hourly/daily) pages so
    // Google re-crawls hub pages and discovers new articles faster. Article
    // and legal pages (weekly/monthly/yearly) keep their real publish dates.
    if (url.pathname === '/sitemap.xml') return serveSitemap(request, env);

    // .html → clean URL: single 301. _redirects rules exist but the ASSETS
    // binding serves exact file matches before redirect rules are evaluated,
    // so these must fire here in the Worker before any file lookup occurs.
    const HTML_REDIRECTS = {
      '/index.html': '/', '/calendar.html': '/calendar',
      '/currencies.html': '/currencies', '/pairs.html': '/pairs',
      '/news.html': '/news', '/about.html': '/about',
      '/community.html': '/community', '/contact.html': '/contact',
      '/disclaimer.html': '/disclaimer', '/how.html': '/how',
      '/privacy.html': '/privacy', '/terms.html': '/terms',
      '/login.html': '/login', '/register.html': '/register',
      '/history.html': '/history', '/report.html': '/report',
      '/pro.html': '/pro', '/profile.html': '/profile',
      '/forecast.html': '/forecast', '/forecast-history.html': '/forecast-history',
      '/forecast-performance.html': '/forecast-performance', '/forecast-pair.html': '/forecast-pair',
      '/developers.html': '/developers',
    };
    const cleanPath = HTML_REDIRECTS[url.pathname];
    if (cleanPath) {
      url.pathname = cleanPath;
      return Response.redirect(url.toString(), 301);
    }

    // Insight articles — /insight/SLUG.html or /insight/SLUG/ → 301 to /insight/SLUG
    // Cloudflare ASSETS emits a 307 (temp) for these; we need a permanent 301.
    const insightHtmlMatch = url.pathname.match(/^\/insight\/([\w-]+)\.html$/);
    if (insightHtmlMatch) {
      url.pathname = `/insight/${insightHtmlMatch[1]}`;
      return Response.redirect(url.toString(), 301);
    }
    const insightSlashMatch = url.pathname.match(/^\/insight\/([\w-]+)\/$/);
    if (insightSlashMatch) {
      url.pathname = `/insight/${insightSlashMatch[1]}`;
      return Response.redirect(url.toString(), 301);
    }

    const pairMatch = url.pathname.match(/^\/pairs\/([\w-]+)\/?$/);
    if (pairMatch) {
      // Canonical: /pairs/aud-jpy (no trailing slash). 301 the slash variant so
      // Google consolidates equity onto one URL instead of splitting it.
      if (url.pathname.endsWith('/')) {
        url.pathname = `/pairs/${pairMatch[1]}`;
        return Response.redirect(url.toString(), 301);
      }
      return servePairPage(request, pairMatch[1], env);
    }

    const ccyMatch = url.pathname.match(/^\/currencies\/([\w]+)\/?$/);
    if (ccyMatch && CURRENCY_CODES.has(ccyMatch[1].toLowerCase())) {
      // Canonical: /currencies/usd (no trailing slash).
      if (url.pathname.endsWith('/')) {
        url.pathname = `/currencies/${ccyMatch[1].toLowerCase()}`;
        return Response.redirect(url.toString(), 301);
      }
      return serveCurrencyPage(request, ccyMatch[1].toLowerCase(), env);
    }

    // Guides — evergreen reference library. Canonical: no trailing slash.
    // Each guide gets the current 8-currency news-bias strip injected at
    // request time (same placeholder machinery as the pair pages), so the
    // "live data it describes" stays genuinely live.
    const guideMatch = url.pathname.match(/^\/guides(?:\/([\w-]+))?\/?$/);
    if (guideMatch) {
      if (url.pathname !== '/guides' && url.pathname.endsWith('/')) {
        url.pathname = guideMatch[1] ? `/guides/${guideMatch[1]}` : '/guides';
        return Response.redirect(url.toString(), 301);
      }
      return serveGuidePage(request, guideMatch[1] || null, env);
    }

    // News hub — server-render the latest headlines so crawlers see real content.
    if (url.pathname === '/news') return serveNewsPage(request, env);

    // Economic calendar — in-house SSR (replaces the Investing.com iframe).
    if (url.pathname === '/calendar') return serveCalendarPage(request, env);

    // Forecast post pages — /forecast/DOCID/ (Firestore doc IDs are 20-char alphanumeric)
    const fcMatch = url.pathname.match(/^\/forecast\/([A-Za-z0-9]{10,})\/?$/);
    if (fcMatch) {
      // Canonical: /forecast/DOCID (no trailing slash).
      if (url.pathname.endsWith('/')) {
        url.pathname = `/forecast/${fcMatch[1]}`;
        return Response.redirect(url.toString(), 301);
      }
      const res = await serveForecastPost(fcMatch[1]);
      if (res) return res;
    }

    // Forecast track record — server-render the public win-rate + recent
    // results into the page so crawlers index real content (the client then
    // hydrates the interactive version). Fail-open to the plain asset.
    if (url.pathname === '/forecast' || url.pathname === '/forecast-history' || url.pathname === '/forecast-performance') {
      return serveForecastSSR(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function serveForecastSSR(request, env) {
  try {
    const [assetResp, scorecard, legacy] = await Promise.all([
      env.ASSETS.fetch(request),
      fetchScorecardLedger(env),
      fetchForecastLedger(env),
    ]);
    if (!assetResp.ok) return assetResp;
    if (!(assetResp.headers.get('content-type') || '').includes('text/html')) return assetResp;
    let html = await assetResp.text();
    if (html.includes('<!-- forecast_ssr -->')) {
      const block = (scorecard && scorecard.length)
        ? renderScorecardSSR(scorecard)
        : renderLegacySSR(legacy || []);
      html = html.replace('<!-- forecast_ssr -->', block);
    }
    return new Response(html, { status: 200, headers: buildHeaders(assetResp) });
  } catch {
    return env.ASSETS.fetch(request); // fail-open — never break the page
  }
}

async function fetchScorecardLedger(env) {
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/session_bias?select=pair,session_date,session,tone,strength,status,alignment,move_pct&status=eq.settled&order=session_date.desc,entry_time.desc&limit=300`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function fetchForecastLedger(env) {
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/pair_forecasts?select=pair,forecast_date,direction,status,outcome,move_pct&order=forecast_date.desc&limit=300`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const _ssrEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderScorecardSSR(rows) {
  const SESSION_LABEL = { asean: 'Asia', london: 'London', newyork: 'New York' };
  const scored = rows.filter((r) => r.alignment === 'aligned' || r.alignment === 'contra');
  const aligned = scored.filter((r) => r.alignment === 'aligned').length;
  const contra = scored.length - aligned;
  const quiet = rows.filter((r) => r.alignment === 'quiet').length;
  const rate = scored.length ? Math.round((aligned / scored.length) * 100) : null;
  const recent = rows.filter((r) => r.alignment && r.alignment !== 'na').slice(0, 20);
  const body = recent.map((r) =>
    `<tr><td style="padding:6px 8px;">${_ssrEsc(r.session_date)} ${_ssrEsc(SESSION_LABEL[r.session] || r.session)}</td><td style="padding:6px 8px;">${_ssrEsc(r.pair)}</td><td style="padding:6px 8px;">${r.tone === 'Bullish' ? '▲ Bullish tone' : '▼ Bearish tone'}</td><td style="padding:6px 8px;">${r.move_pct == null ? '—' : (r.move_pct > 0 ? '+' : '') + Number(r.move_pct).toFixed(2) + '%'}</td><td style="padding:6px 8px;">${_ssrEsc(r.alignment)}</td></tr>`
  ).join('');
  return `<section aria-label="Session bias scorecard" style="max-width:1280px;margin:0 auto;padding:4px 20px 0;color:#9aa7bd;">
    <p style="font-size:13px;line-height:1.6;margin:0 0 10px;">FXNewsBias reads the news tone for 11 forex pairs at every session open (Asia, London, New York — weekdays) and scores each read at the next session: did the market move <strong>with</strong> the news tone, <strong>against</strong> it, or stay <strong>quiet</strong> inside the pair's own volatility band${rate !== null ? ` — so far <strong>${rate}% aligned</strong> across ${scored.length} decisive reads (${aligned} aligned · ${contra} contra · ${quiet} quiet; ${rows.length} settled reads recorded in total)` : ''}. Every read is recorded and never edited. This is a scorecard of news-tone reporting, not trade advice.</p>
    ${recent.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;"><caption style="text-align:left;font-size:11px;color:#64748b;padding:4px 8px;">Recent scored session reads</caption><thead><tr><th style="text-align:left;padding:6px 8px;">Session</th><th style="text-align:left;padding:6px 8px;">Pair</th><th style="text-align:left;padding:6px 8px;">News tone</th><th style="text-align:left;padding:6px 8px;">Move</th><th style="text-align:left;padding:6px 8px;">Score</th></tr></thead><tbody>${body}</tbody></table>` : ''}
  </section>`;
}

// Legacy frozen ledger — shown only until the first scorecard rows settle.
function renderLegacySSR(rows) {
  const settled = rows.filter((r) => r.status === 'settled' && (r.outcome === 'hit' || r.outcome === 'miss'));
  const hits = settled.filter((r) => r.outcome === 'hit').length;
  const wr = settled.length ? Math.round((hits / settled.length) * 100) : null;
  const recent = rows.filter((r) => r.status === 'settled' && r.direction !== 'Stand Aside').slice(0, 20);
  const body = recent.map((r) =>
    `<tr><td style="padding:6px 8px;">${_ssrEsc(r.forecast_date)}</td><td style="padding:6px 8px;">${_ssrEsc(r.pair)}</td><td style="padding:6px 8px;">${r.direction === 'Bullish' ? '▲ Bullish' : '▼ Bearish'}</td><td style="padding:6px 8px;">${r.move_pct == null ? '—' : (r.move_pct > 0 ? '+' : '') + Number(r.move_pct).toFixed(2) + '%'}</td><td style="padding:6px 8px;">${_ssrEsc(r.outcome || '')}</td></tr>`
  ).join('');
  return `<section aria-label="Legacy forecast ledger" style="max-width:1280px;margin:0 auto;padding:4px 20px 0;color:#9aa7bd;">
    <p style="font-size:13px;line-height:1.6;margin:0 0 10px;">FXNewsBias now publishes a Session Bias Scorecard: news-tone reads for 11 pairs at each session open, scored at the next session. The first scored reads land shortly; below is the frozen archive of the earlier 24h forecast experiment${wr !== null ? ` (${wr}% hit rate across ${settled.length} settled)` : ''} — kept public because nothing here is ever deleted or edited.</p>
    ${recent.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;"><caption style="text-align:left;font-size:11px;color:#64748b;padding:4px 8px;">Frozen legacy ledger</caption><thead><tr><th style="text-align:left;padding:6px 8px;">Date</th><th style="text-align:left;padding:6px 8px;">Pair</th><th style="text-align:left;padding:6px 8px;">Tone</th><th style="text-align:left;padding:6px 8px;">Move</th><th style="text-align:left;padding:6px 8px;">Outcome</th></tr></thead><tbody>${body}</tbody></table>` : ''}
  </section>`;
}

// ── Pair pages ────────────────────────────────────────────────────────────────
async function servePairPage(request, slug, env) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = `/pairs/${slug}/`;

  const [assetResp, seoHtml] = await Promise.all([
    env.ASSETS.fetch(new Request(assetUrl.toString(), request)),
    fetchSEOCache(slug, env),
  ]);

  if (!assetResp.ok) return assetResp;
  return injectAndServe(await assetResp.text(), seoHtml, assetResp);
}

// ── Currency pages ────────────────────────────────────────────────────────────
async function serveCurrencyPage(request, code, env) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = `/currencies/${code}/`;

  const [assetResp, seoHtml] = await Promise.all([
    env.ASSETS.fetch(new Request(assetUrl.toString(), request)),
    fetchSEOCache(`ccy-${code}`, env),
  ]);

  if (!assetResp.ok) return assetResp;
  return injectAndServe(await assetResp.text(), seoHtml, assetResp);
}

// ── Guides ────────────────────────────────────────────────────────────────────
async function serveGuidePage(request, slug, env) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = slug ? `/guides/${slug}/` : '/guides/';

  const [assetResp, strip] = await Promise.all([
    env.ASSETS.fetch(new Request(assetUrl.toString(), request)),
    slug ? buildLiveBiasStrip(env) : Promise.resolve(null),
  ]);

  if (!assetResp.ok) return assetResp;
  return injectAndServe(await assetResp.text(), strip, assetResp);
}

// Compact current-bias strip for guide pages. Fail-open: null just leaves
// the placeholder comment in the page.
async function buildLiveBiasStrip(env) {
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/sentiment?select=currency,score&order=id.desc&limit=16`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const seen = {};
    for (const row of await r.json()) if (seen[row.currency] == null) seen[row.currency] = row.score;
    const order = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
    const parts = order.filter((c) => seen[c] != null).map((c) => {
      const s = seen[c];
      const col = s >= 55 ? '#047857' : s <= 45 ? '#dc2626' : '#b45309';
      return `<span class="ls-ccy"><b>${c}</b> <span style="color:${col};font-weight:700;">${s}</span></span>`;
    });
    if (parts.length < 4) return null;
    return `<div class="live-strip">📡 <b>News bias right now</b> (0–100, refreshed through the day):<br>${parts.join('')}<a href="/" style="font-size:12.5px;">full dashboard →</a></div>`;
  } catch { return null; }
}

// ── Sitemap lastmod refresh ─────────────────────────────────────────────────
async function serveSitemap(request, env) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = '/sitemap.xml';

  const resp = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  if (!resp.ok) return resp;

  let xml = await resp.text();
  const today = new Date().toISOString().slice(0, 10);

  // Per <url> block: only refresh entries that change frequently
  // (changefreq hourly|daily). Leaves article/legal pages untouched.
  xml = xml.replace(/<url>[\s\S]*?<\/url>/g, block =>
    /<changefreq>(hourly|daily)<\/changefreq>/.test(block)
      ? block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${today}</lastmod>`)
      : block
  );

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

// ── Shared inject logic ───────────────────────────────────────────────────────
function injectAndServe(html, seoHtml, assetResp) {
  const today = new Date().toISOString().slice(0, 10);

  // Always refresh dateModified in JSON-LD so Google sees today's date
  let result = html.replace(/"dateModified":"[\d-]+"/, `"dateModified":"${today}"`);

  // Update visible "Page reviewed" date to match today
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const d = new Date();
  const todayHuman = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  result = result.replace(/📅 Page reviewed: \d+ [A-Za-z]+ \d+/, `📅 Page reviewed: ${todayHuman}`);

  // Inject AI-written analysis at placeholder
  const placeholder = '<!-- seo_inject -->';
  if (seoHtml && result.includes(placeholder)) {
    result = result.replace(placeholder, `<div class="seo-live-block">${seoHtml}</div>`);
  }

  return new Response(result, {
    status: 200,
    headers: buildHeaders(assetResp),
  });
}

// ── Supabase seo_cache fetch ──────────────────────────────────────────────────
async function fetchSEOCache(slug, env) {
  try {
    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/seo_cache?select=html&slug=eq.${encodeURIComponent(slug)}&limit=1`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows?.[0]?.html || null;
  } catch {
    return null;
  }
}

function buildHeaders(assetResp) {
  const headers = new Headers(assetResp.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  // 3-minute CDN cache — fresh after every cron cycle
  headers.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=60');
  return headers;
}

// ── News hub SSR ──────────────────────────────────────────────────────────────
// /news is otherwise client-rendered, so crawlers saw a near-empty page (it
// ranked ~pos 52 for a large "forex news" query cluster). Inject the latest
// headlines server-side for real, indexable content. The client news-page.js
// removes these .news-card nodes and re-renders them on hydration (no dupes).
async function serveNewsPage(request, env) {
  const [assetResp, news] = await Promise.all([
    env.ASSETS.fetch(request),
    fetchLatestNews(env),
  ]);
  if (!assetResp.ok) return assetResp;
  if (!(assetResp.headers.get('content-type') || '').includes('text/html')) return assetResp;

  let html = await assetResp.text();
  if (news && news.length && html.includes('<!-- News Cards -->')) {
    html = html.replace('<!-- News Cards -->', news.map(renderNewsCard).join('\n'));
    const top = news[0];
    if (top && top.title) {
      html = html.replace(
        /<h2 class="featured-title"[^>]*>[\s\S]*?<\/h2>/,
        `<h2 class="featured-title">${esc(decodeNewsEntities(top.title))}</h2>`
      );
    }
  }
  return new Response(html, { status: 200, headers: buildHeaders(assetResp) });
}

async function fetchLatestNews(env) {
  try {
    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/news?select=title,source,url,impact,currencies_affected,created_at&order=id.desc&limit=40`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function decodeNewsEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function newsTimeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 6e4);
  if (!isFinite(m) || m < 0) return '';
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}

// Mirrors the card markup produced by news-page.js so hydration is seamless.
function renderNewsCard(item) {
  const impact = String(item.impact || 'medium').toLowerCase();
  const affs = Array.isArray(item.currencies_affected) ? item.currencies_affected : [];
  const title = decodeNewsEntities(item.title || '');
  const high = impact === 'high';
  const pillCls = high ? 'affect-bear' : 'affect-bull';
  const arrow = high ? '⬇' : '⬆';
  const pills = affs.slice(0, 6).map(a => `<span class="affect-pill ${pillCls}">${esc(a)} ${arrow}</span>`).join('');
  const affecting = affs.length ? `<div class="news-affecting">Affecting ${esc(affs.join(', '))}</div>` : '';
  return `<div class="news-card" data-source="${esc(String(item.source || '').toLowerCase())}" data-impact="${impact}" data-title="${esc(title.toLowerCase())}" data-currencies="${esc(affs.join(',').toLowerCase())}"><div class="news-content"><div class="news-meta-top"><span class="src">${esc(String(item.source || 'NEWS').toUpperCase())}</span><span class="ts">${esc(newsTimeAgo(item.created_at))}</span></div><h3 class="news-title">${esc(title)}</h3>${affecting}<div class="news-affects">${pills}</div></div></div>`;
}

// ── Economic calendar (in-house SSR — replaces the Investing.com iframe) ──────
// Renders the next ~3 weeks of reliably rule-derivable high-impact USD events
// (NFP, jobless claims, ISM, ADP) — accurate by construction, no data feed —
// merged with any curated events in system_state['economic_events'] (central-bank
// decisions etc. added from official schedules). Each event is tagged with the
// affected currency's live sentiment. Fully server-rendered so it is real,
// indexable content (the old cross-origin iframe indexed nothing → ranked pos 59).
const CAL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAL_DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const pad2 = (n) => String(n).padStart(2, '0');

function calNthWeekday(year, month, weekday, n) {
  const d = new Date(Date.UTC(year, month, 1)); let c = 0;
  while (d.getUTCMonth() === month) { if (d.getUTCDay() === weekday && ++c === n) return new Date(d); d.setUTCDate(d.getUTCDate() + 1); }
  return null;
}
function calNthBusinessDay(year, month, n) {
  const d = new Date(Date.UTC(year, month, 1)); let c = 0;
  while (d.getUTCMonth() === month) { const w = d.getUTCDay(); if (w !== 0 && w !== 6 && ++c === n) return new Date(d); d.setUTCDate(d.getUTCDate() + 1); }
  return null;
}
// Hours to add to US-Eastern to get UTC (EDT=+4 during DST, else EST=+5).
function usEasternOffset(date) {
  const y = date.getUTCFullYear();
  const dstStart = calNthWeekday(y, 2, 0, 2), dstEnd = calNthWeekday(y, 10, 0, 1);
  return (date >= dstStart && date < dstEnd) ? 4 : 5;
}
function calET(baseDate, hhET, mmET) {
  const d = new Date(baseDate); d.setUTCHours(0, 0, 0, 0);
  d.setUTCHours(hhET + usEasternOffset(d), mmET, 0, 0);
  return d;
}

function buildRecurringEvents(fromDate, days) {
  const start = new Date(fromDate); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * 864e5);
  const events = [];
  // Weekly — US Initial Jobless Claims, Thursdays 8:30 ET
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 4) events.push({ when: calET(d, 8, 30), currency: 'USD', impact: 'Medium', title: 'US Initial Jobless Claims', detail: 'Weekly first-time unemployment filings — a fast read on the US labour market.' });
  }
  // Monthly — for each month the window touches
  const months = new Set();
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) months.add(d.getUTCFullYear() + ':' + d.getUTCMonth());
  for (const key of months) {
    const [y, m] = key.split(':').map(Number);
    const ff = calNthWeekday(y, m, 5, 1); // first Friday
    if (ff) {
      events.push({ when: calET(ff, 8, 30), currency: 'USD', impact: 'High', title: 'US Non-Farm Payrolls (NFP)', detail: 'The month’s marquee US jobs report — the single biggest scheduled mover for the dollar.' });
      events.push({ when: calET(ff, 8, 30), currency: 'USD', impact: 'High', title: 'US Unemployment Rate & Avg Hourly Earnings', detail: 'Released with NFP; wage growth drives Fed rate expectations.' });
      const adp = new Date(ff); adp.setUTCDate(adp.getUTCDate() - 2); // Wed before NFP
      events.push({ when: calET(adp, 8, 15), currency: 'USD', impact: 'Medium', title: 'ADP Non-Farm Employment Change', detail: 'Private-payrolls preview two days before NFP.' });
    }
    const im = calNthBusinessDay(y, m, 1);
    if (im) events.push({ when: calET(im, 10, 0), currency: 'USD', impact: 'High', title: 'ISM Manufacturing PMI', detail: 'Factory-sector health; a reading below 50 signals contraction.' });
    const is = calNthBusinessDay(y, m, 3);
    if (is) events.push({ when: calET(is, 10, 0), currency: 'USD', impact: 'High', title: 'ISM Services PMI', detail: 'Services dominate US output — a key growth and inflation gauge.' });
  }
  return events.filter(e => e.when >= start && e.when <= end);
}

async function fetchCalendarSentiment(env) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/sentiment?select=currency,bias,score&order=created_at.desc&limit=16`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : [];
  } catch { return []; }
}
// Curated date-specific events (central-bank decisions etc.) live in
// system_state['economic_events'] as an array of {when,currency,impact,title,detail}.
async function fetchCalendarOverrides(env) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/system_state?key=eq.economic_events&select=value`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const v = (await r.json())?.[0]?.value;
    return Array.isArray(v) ? v : (Array.isArray(v?.events) ? v.events : []);
  } catch { return []; }
}

function renderCalendar(events, sentMap) {
  if (!events.length) return '';
  const byDay = new Map();
  for (const e of events.sort((a, b) => a.when - b.when)) {
    const k = e.when.toISOString().slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  let html = '';
  for (const [day, evs] of byDay) {
    const d = new Date(day + 'T00:00:00Z');
    html += `<div class="cal-day"><div class="cal-day-head">${CAL_DOW[d.getUTCDay()]}, ${d.getUTCDate()} ${CAL_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}</div>`;
    for (const e of evs) {
      const imp = String(e.impact || 'Medium');
      const s = sentMap[e.currency];
      const bias = s && s.bias
        ? `<span class="cal-bias b-${String(s.bias).toLowerCase()}" title="Live FXNewsBias sentiment">${esc(e.currency)} ${esc(s.bias)}${s.score != null ? ' ' + s.score : ''}</span>`
        : `<span class="cal-ccy">${esc(e.currency)}</span>`;
      html += `<div class="cal-row" data-impact="${imp.toLowerCase()}"><span class="cal-time">${pad2(e.when.getUTCHours())}:${pad2(e.when.getUTCMinutes())} UTC</span><span class="cal-imp i-${imp.toLowerCase()}">${esc(imp)}</span>${bias}<div class="cal-ev"><div class="cal-ev-title">${esc(e.title)}</div>${e.detail ? `<div class="cal-ev-detail">${esc(e.detail)}</div>` : ''}</div></div>`;
    }
    html += `</div>`;
  }
  return html;
}

async function serveCalendarPage(request, env) {
  const [assetResp, sentRows, overrides] = await Promise.all([
    env.ASSETS.fetch(request),
    fetchCalendarSentiment(env),
    fetchCalendarOverrides(env),
  ]);
  if (!assetResp.ok) return assetResp;
  if (!(assetResp.headers.get('content-type') || '').includes('text/html')) return assetResp;
  let html = await assetResp.text();
  const sentMap = {};
  for (const r of sentRows || []) if (!sentMap[r.currency]) sentMap[r.currency] = { bias: r.bias, score: r.score };
  // Recurring rule-based events show 21 days out; curated central-bank decisions
  // show up to ~8 weeks out (so the next FOMC/ECB/BoE/BoJ is always visible). A
  // full year of seeded dates can live in economic_events — only the in-window
  // ones render, so the calendar rolls itself forward with no maintenance.
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0);
  const horizon = new Date(startOfDay.getTime() + 60 * 864e5);
  const curated = (overrides || [])
    .map(o => ({ when: new Date(o.when), currency: String(o.currency || '').toUpperCase(), impact: o.impact || 'High', title: o.title, detail: o.detail || '' }))
    .filter(o => o.title && !isNaN(o.when) && o.when >= startOfDay && o.when <= horizon);
  const events = [...buildRecurringEvents(now, 21), ...curated];
  if (html.includes('<!-- CALENDAR_EVENTS -->')) {
    html = html.replace('<!-- CALENDAR_EVENTS -->', renderCalendar(events, sentMap) || '<p class="cal-empty">No major scheduled events in the next three weeks.</p>');
  }
  return new Response(html, { status: 200, headers: buildHeaders(assetResp) });
}

// ── Forecast post SSR ─────────────────────────────────────────────────────────
const FS_KEY  = 'AIzaSyD88nfD-GSk2icxgPMqOHOuLjCM19Zzso4';
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/fxnewsbias/databases/(default)/documents';

function fsVal(v) {
  if (!v) return null;
  if ('stringValue'    in v) return v.stringValue;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('booleanValue'   in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue'     in v) return (v.arrayValue.values||[]).map(fsVal);
  if ('mapValue'       in v) {
    const o={};
    for (const [k,w] of Object.entries(v.mapValue.fields||{})) o[k]=fsVal(w);
    return o;
  }
  return null;
}
function fsParseDoc(doc) {
  const d={};
  for (const [k,v] of Object.entries(doc.fields||{})) d[k]=fsVal(v);
  return d;
}
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function buildDesc(text, max) {
  const t=(text||'').replace(/\s+/g,' ').trim();
  if (t.length<=max) return t;
  const cut=t.slice(0,max);
  return cut.slice(0,cut.lastIndexOf(' '))+'…';
}
function fcBiasClass(b){ return b==='Bullish'?'bias-bull':b==='Bearish'?'bias-bear':'bias-neut'; }
function fcBiasIcon(b) { return b==='Bullish'?'🟢':b==='Bearish'?'🔴':b==='Neutral'?'🟡':''; }
function fcFmtPosted(d) {
  const date = d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  const time = d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
  return `${date} · ${time} UTC`;
}

async function serveForecastPost(postId) {
  let doc;
  try {
    const res = await fetch(`${FS_BASE}/forecasts/${postId}?key=${FS_KEY}`, {signal:AbortSignal.timeout(8000)});
    if (!res.ok) return null;
    doc = await res.json();
    if (doc.error) return null;
  } catch { return null; }

  const f          = fsParseDoc(doc);
  const postedAt   = (f.publishedAt instanceof Date && !isNaN(f.publishedAt)) ? f.publishedAt : new Date(doc.createTime);
  const title      = f.title || 'Forex Forecast';
  const desc       = buildDesc(f.content, 155);
  const ogImg      = f.imageUrl || 'https://fxnewsbias.com/og/forecast.webp';
  const postUrl    = `https://fxnewsbias.com/forecast/${postId}`;
  const createTime = postedAt;
  const pairs      = f.pairs || [];

  const pairsHtml = pairs.length
    ? `<div class="pairs-row">${pairs.map(p=>`<span class="pair-tag">${esc(p)}</span>`).join('')}</div>` : '';

  const articleLD = JSON.stringify({
    '@context':'https://schema.org','@type':'Article',
    headline:title, description:desc,
    datePublished:createTime.toISOString(), dateModified:createTime.toISOString(),
    author:{'@type':'Organization','name':'FXNewsBias Team','url':'https://fxnewsbias.com'},
    publisher:{'@type':'Organization','name':'FXNewsBias','logo':{'@type':'ImageObject','url':'https://fxnewsbias.com/logo-fxnb.png'}},
    mainEntityOfPage:{'@type':'WebPage','@id':postUrl}, image:ogImg
  });
  const breadcrumbLD = JSON.stringify({
    '@context':'https://schema.org','@type':'BreadcrumbList',
    itemListElement:[
      {'@type':'ListItem','position':1,'name':'Home','item':'https://fxnewsbias.com/'},
      {'@type':'ListItem','position':2,'name':'Forecast','item':'https://fxnewsbias.com/forecast'},
      {'@type':'ListItem','position':3,'name':title,'item':postUrl}
    ]
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(title)} — FXNewsBias</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
<meta name="author" content="FXNewsBias Team">
<link rel="canonical" href="${postUrl}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${postUrl}">
<meta property="og:image" content="${esc(ogImg)}">
<meta property="og:site_name" content="FXNewsBias">
<meta property="article:published_time" content="${createTime.toISOString()}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImg)}">
<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<script type="application/ld+json">${articleLD}</script>
<script type="application/ld+json">${breadcrumbLD}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Inter',-apple-system,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6;}a{text-decoration:none;color:inherit;}
header{background:#0f172a;border-bottom:1px solid #1e293b;position:sticky;top:0;z-index:100;box-shadow:0 1px 8px rgba(0,0,0,.18);}
.header-inner{max-width:1280px;margin:0 auto;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;}
.logo{display:flex;align-items:center;gap:10px;}.logo img{height:36px;}
nav ul{list-style:none;display:flex;gap:24px;}nav a{color:#f1f5f9;font-weight:500;font-size:14px;}nav a:hover{color:#60a5fa;}
.nav-actions{display:flex;gap:10px;align-items:center;}.btn{padding:7px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;}
.btn-outline{border:1px solid #334155;color:#f1f5f9;background:none;}.btn-primary{background:#2563eb;color:#fff;border:none;}
.burger{background:none;border:none;cursor:pointer;width:40px;height:40px;display:none;}
.page{max-width:760px;margin:0 auto;padding:36px 20px 60px;}
.post-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.04);}
.post-hero{background:#0f172a;padding:28px 32px 24px;}
.post-breadcrumb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.post-breadcrumb a{font-size:12px;font-weight:600;color:#60a5fa;}.post-breadcrumb a:hover{color:#93c5fd;}
.post-breadcrumb-sep{font-size:12px;color:#475569;}.post-breadcrumb-cur{font-size:12px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;}
.post-hero-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;}
.post-date{font-size:12px;font-weight:600;color:#94a3b8;font-family:'JetBrains Mono',monospace;}
.bias-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;}
.bias-bull{background:#d1fae5;color:#065f46;}.bias-bear{background:#fee2e2;color:#991b1b;}.bias-neut{background:#fef3c7;color:#92400e;}
.post-hero h1{font-size:26px;font-weight:800;line-height:1.3;color:#f1f5f9;margin-bottom:12px;}
.pairs-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:0;}
.pair-tag{background:rgba(255,255,255,.08);color:#cbd5e1;font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;font-family:'JetBrains Mono',monospace;}
.post-img{width:100%;max-height:400px;object-fit:cover;display:block;}
.post-body{padding:28px 32px 36px;}
.post-content{font-size:15px;color:#334155;line-height:1.85;white-space:pre-wrap;word-wrap:break-word;}
.post-footer{margin-top:28px;padding-top:18px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;}
.post-author{font-size:12px;color:#94a3b8;}
.back-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;border:1px solid #e2e8f0;background:#fff;color:#334155;}
.back-btn:hover{border-color:#93c5fd;color:#1d4ed8;}
footer{background:#0f172a;color:#64748b;padding:28px 0;margin-top:48px;text-align:center;font-size:13px;}
footer a{color:#94a3b8;margin:0 10px;}footer a:hover{color:#fff;}
@media(max-width:640px){.post-body,.post-hero{padding:20px;}.post-hero h1{font-size:20px;}}
</style>
</head>
<body>
<style>nav>ul{display:none}.burger{display:flex!important;align-items:center;justify-content:center}</style>
<header><div class="header-inner">
  <a href="/" class="logo"><img src="/logo-fxnb.png?v=2" alt="FX News Bias"></a>
  <nav><ul>
    <li><a href="/">Markets</a></li><li><a href="/currencies">Currencies</a></li>
    <li><a href="/pairs">Pairs</a></li><li><a href="/insight/">Insights</a></li>
    <li><a href="/forecast">Forecast</a></li>
  </ul></nav>
  <div class="nav-actions">
    <a href="/login" class="btn btn-outline">Login</a>
    <a href="/register" class="btn btn-primary">Register</a>
    <button class="burger">☰</button>
  </div>
</div></header>
<div class="page">
  <div class="post-card">
    <div class="post-hero">
      <div class="post-breadcrumb">
        <a href="/">Home</a>
        <span class="post-breadcrumb-sep">›</span>
        <a href="/forecast">Forecast</a>
        <span class="post-breadcrumb-sep">›</span>
        <span class="post-breadcrumb-cur">${esc(title)}</span>
      </div>
      <div class="post-hero-meta">
        <span class="post-date" id="post-ts" data-ts="${postedAt.toISOString()}">${fcFmtPosted(postedAt)}</span>
        ${f.bias ? `<span class="bias-pill ${fcBiasClass(f.bias)}">${fcBiasIcon(f.bias)} ${esc(f.bias)}</span>` : ''}
      </div>
      <h1>${esc(title)}</h1>
      ${pairsHtml}
    </div>
    ${f.imageUrl ? `<img class="post-img" src="${esc(f.imageUrl)}" alt="${esc(title)}">` : ''}
    <div class="post-body">
      <div class="post-content">${esc(f.content||'')}</div>
      <div class="post-footer">
        <span class="post-author">by FXNewsBias Team</span>
        <a href="/forecast" class="back-btn">← All Forecasts</a>
      </div>
    </div>
  </div>
</div>
<footer>
  <a href="/">Markets</a><a href="/currencies">Currencies</a><a href="/pairs">Pairs</a>
  <a href="/forecast">Forecast</a><a href="/news">News</a><br><br>
  © 2026 FXNewsBias · <a href="/disclaimer">Disclaimer</a> · Not financial advice
</footer>
<script src="/nav.js?v=2" defer></script>
<script src="/promo-popup.js?v=2" defer></script>
<script src="/cookie.js?v=2" defer></script>
<script src="/analytics.js?v=2" defer></script>
<script>(function(){var el=document.getElementById('post-ts');if(!el)return;var d=new Date(el.dataset.ts);var s=Math.floor((Date.now()-d)/1000);var rel=s<60?'just now':s<3600?Math.floor(s/60)+'m ago':s<86400?Math.floor(s/3600)+'h ago':Math.floor(s/86400)+'d ago';el.setAttribute('title',el.textContent);el.textContent='Posted '+rel+' · '+el.textContent;})()</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'public, max-age=300, stale-while-revalidate=60' }
  });
}

