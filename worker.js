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

    if (request.method === 'POST' && url.pathname === '/send-welcome-email') {
      return handleWelcomeEmail(request, env);
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

// ── Welcome email ─────────────────────────────────────────────────────────────
async function handleWelcomeEmail(request, env) {
  const internalKey = request.headers.get('X-Internal-Key');
  if (!env.CRON_TRIGGER_KEY || internalKey !== env.CRON_TRIGGER_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!env.RESEND_API_KEY) {
    console.log('send-welcome-email: RESEND_API_KEY not set on main worker');
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  let email, name;
  try {
    const body = await request.json();
    email = String(body.email || '').trim();
    name  = String(body.name  || '').trim();
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (!email || !email.includes('@')) {
    return new Response('Bad request', { status: 400 });
  }

  const firstName = (name.split(' ')[0] || 'there');
  const from = env.ALERT_EMAIL_FROM || 'hello@fxnewsbias.com';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to FXNewsBias</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <!-- Header -->
  <tr><td style="background:#1e40af;padding:32px 40px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#93c5fd;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">FXNewsBias</p>
    <h1 style="margin:12px 0 0;color:#ffffff;font-size:26px;font-weight:800;line-height:1.25;">Your Forex Sentiment Edge<br>Starts Now 🚀</h1>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 20px;font-size:16px;color:#0f172a;line-height:1.6;">Hi <strong>${firstName}</strong>,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.7;">Welcome to FXNewsBias — you've just unlocked <strong>real-time forex news sentiment analysis</strong> across all major pairs and currencies.</p>
    <!-- Feature list -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;margin-bottom:8px;display:block;">
        <p style="margin:0;font-size:14px;color:#0f172a;">📰 &nbsp;<strong>Sentiment tracking</strong> across major currency pairs</p>
      </td></tr>
      <tr><td style="padding:8px 0;font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#0f172a;">📊 &nbsp;<strong>Live bias scores</strong> updated every 3 hours from 16 news sources</p>
      </td></tr>
      <tr><td style="padding:8px 0;font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#0f172a;">📅 &nbsp;<strong>Economic calendar</strong> — know what moves the market before it moves</p>
      </td></tr>
      <tr><td style="padding:8px 0;font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#0f172a;">💬 &nbsp;<strong>Community</strong> — share your analysis with other traders</p>
      </td></tr>
    </table>
    <!-- Pro CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1e40af,#7c3aed);border-radius:10px;margin-bottom:28px;">
      <tr><td style="padding:28px 32px;text-align:center;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#c4b5fd;letter-spacing:0.1em;text-transform:uppercase;">Ready to go Pro?</p>
        <h2 style="margin:0 0 12px;color:#ffffff;font-size:20px;font-weight:800;">Unlock the Full Edge</h2>
        <p style="margin:0 0 20px;font-size:13px;color:#c4b5fd;line-height:1.6;">Full sentiment history · Advanced filters · Weekly AI intelligence brief · Priority updates</p>
        <a href="https://fxnewsbias.com/report" style="display:inline-block;background:#f59e0b;color:#1a1a1a;font-size:15px;font-weight:800;padding:14px 32px;border-radius:8px;text-decoration:none;">⭐ Upgrade to Pro — $9.99/mo</a>
      </td></tr>
    </table>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.7;">If you have any questions, reply to this email or visit <a href="https://fxnewsbias.com/contact" style="color:#1e40af;text-decoration:none;font-weight:600;">fxnewsbias.com/contact</a> — we read every message.</p>
    <p style="margin:0;font-size:15px;color:#0f172a;line-height:1.8;">Happy trading,<br><strong>The FXNewsBias Team</strong></p>
  </td></tr>
  <!-- Footer -->
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
    <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.8;"><a href="https://fxnewsbias.com" style="color:#1e40af;text-decoration:none;font-weight:600;">fxnewsbias.com</a> &nbsp;·&nbsp; Not financial advice &nbsp;·&nbsp; <a href="https://fxnewsbias.com/disclaimer" style="color:#94a3b8;">Disclaimer</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = `Hi ${firstName},

Welcome to FXNewsBias — you've just unlocked real-time forex news sentiment analysis.

Here's what you can do right now:
📰 Track sentiment across major currency pairs
📊 View live bias scores updated every 3 hours
📅 Check the economic calendar
💬 Join the community — share your analysis

Ready to go Pro?
Upgrade to FXNewsBias Pro for $9.99/month and unlock full history, advanced filters and priority updates.
→ Upgrade to Pro: https://fxnewsbias.com/report

Questions? Reply to this email or visit https://fxnewsbias.com/contact

Happy trading,
The FXNewsBias Team
https://fxnewsbias.com`;

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `FXNewsBias <${from}>`,
        to: [email],
        subject: 'Welcome to FXNewsBias — Your Forex Sentiment Edge Starts Now 🚀',
        html,
        text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      console.log(`Welcome email sent: ${email}`);
    } else {
      const err = await resp.text();
      console.log(`Welcome email Resend error for ${email}: ${resp.status} ${err.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`Welcome email fetch error for ${email}:`, e.message);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
