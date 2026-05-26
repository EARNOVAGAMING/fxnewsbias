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

    // Allow HEAD through to dynamic routing so Googlebot HEAD crawls return
    // 200 (not 404) for dynamically-generated pages like /forecast/:id/.
    // All other non-GET/HEAD methods (POST, PUT …) go straight to ASSETS.
    if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request);

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
    if (pairMatch) return servePairPage(request, pairMatch[1], env);

    const ccyMatch = url.pathname.match(/^\/currencies\/([\w]+)\/?$/);
    if (ccyMatch && CURRENCY_CODES.has(ccyMatch[1].toLowerCase())) {
      return serveCurrencyPage(request, ccyMatch[1].toLowerCase(), env);
    }

    // Forecast post pages — /forecast/DOCID/ (Firestore doc IDs are 20-char alphanumeric)
    const fcMatch = url.pathname.match(/^\/forecast\/([A-Za-z0-9]{10,})\/?$/);
    if (fcMatch) {
      const res = await serveForecastPost(fcMatch[1]);
      if (res) return res;
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
  const postUrl    = `https://fxnewsbias.com/forecast/${postId}/`;
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
      {'@type':'ListItem','position':2,'name':'Forecast','item':'https://fxnewsbias.com/forecast/'},
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
    <li><a href="/forecast/">Forecast</a></li>
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
        <a href="/forecast/">Forecast</a>
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
        <a href="/forecast/" class="back-btn">← All Forecasts</a>
      </div>
    </div>
  </div>
</div>
<footer>
  <a href="/">Markets</a><a href="/currencies">Currencies</a><a href="/pairs">Pairs</a>
  <a href="/forecast/">Forecast</a><a href="/news">News</a><br><br>
  © 2026 FXNewsBias · <a href="/disclaimer">Disclaimer</a> · Not financial advice
</footer>
<script src="/nav.js" defer></script>
<script src="/cookie.js" defer></script>
<script src="/analytics.js" defer></script>
<script>(function(){var el=document.getElementById('post-ts');if(!el)return;var d=new Date(el.dataset.ts);var s=Math.floor((Date.now()-d)/1000);var rel=s<60?'just now':s<3600?Math.floor(s/60)+'m ago':s<86400?Math.floor(s/3600)+'h ago':Math.floor(s/86400)+'d ago';el.setAttribute('title',el.textContent);el.textContent='Posted '+rel+' · '+el.textContent;})()</script>
</body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'public, max-age=300, stale-while-revalidate=60' }
  });
}

