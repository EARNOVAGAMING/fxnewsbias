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
  assetUrl.pathname = `/pairs/${slug}/index.html`;

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
  assetUrl.pathname = `/currencies/${code}/index.html`;

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
