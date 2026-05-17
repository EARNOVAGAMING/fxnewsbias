// Cloudflare Worker — serves static assets and injects SEO content into pair pages

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only intercept GET requests for pair pages
    const pairMatch = url.pathname.match(/^\/pairs\/([\w-]+)\/?$/);
    if (request.method === 'GET' && pairMatch) {
      const slug = pairMatch[1];
      return servePairPage(request, slug, env);
    }

    // All other requests: pass through to static assets
    return env.ASSETS.fetch(request);
  },
};

async function servePairPage(request, slug, env) {
  // Fetch static HTML asset and SEO cache in parallel
  const assetUrl = new URL(request.url);
  assetUrl.pathname = `/pairs/${slug}/index.html`;

  const [assetResp, seoHtml] = await Promise.all([
    env.ASSETS.fetch(new Request(assetUrl.toString(), request)),
    fetchSEOCache(slug, env),
  ]);

  if (!assetResp.ok) return assetResp;

  const html = await assetResp.text();

  // Inject SEO content at placeholder; fall through to plain asset if missing
  const placeholder = '<!-- seo_inject -->';
  if (!seoHtml || !html.includes(placeholder)) {
    return new Response(html, {
      status: assetResp.status,
      headers: buildHeaders(assetResp),
    });
  }

  const injected = html.replace(
    placeholder,
    `<div class="seo-live-block">${seoHtml}</div>`
  );

  return new Response(injected, {
    status: 200,
    headers: buildHeaders(assetResp),
  });
}

async function fetchSEOCache(slug, env) {
  try {
    const resp = await fetch(
      `${env.SUPABASE_URL}/rest/v1/seo_cache?select=html&slug=eq.${encodeURIComponent(slug)}&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        },
      }
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
  // Cache for 3 minutes so Cloudflare edge serves fresh content after each cron cycle
  headers.set('Cache-Control', 'public, max-age=180, stale-while-revalidate=60');
  return headers;
}
