// Cloudflare Worker — serves static assets and injects SEO content into pair + currency pages

const CURRENCY_CODES = new Set(['usd','eur','gbp','jpy','aud','cad','chf','nzd']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Enforce HTTPS
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    if (request.method !== 'GET') return env.ASSETS.fetch(request);

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
    };
    const cleanPath = HTML_REDIRECTS[url.pathname];
    if (cleanPath) {
      url.pathname = cleanPath;
      return Response.redirect(url.toString(), 301);
    }

    const pairMatch = url.pathname.match(/^\/pairs\/([\w-]+)\/?$/);
    if (pairMatch) return servePairPage(request, pairMatch[1], env);

    const ccyMatch = url.pathname.match(/^\/currencies\/([\w]+)\/?$/);
    if (ccyMatch && CURRENCY_CODES.has(ccyMatch[1].toLowerCase())) {
      return serveCurrencyPage(request, ccyMatch[1].toLowerCase(), env);
    }

    return env.ASSETS.fetch(request);
  },
};

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

