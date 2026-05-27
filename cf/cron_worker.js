// FXNewsBias Sentiment Worker
// Handles: sentiment analysis, prices, Telegram alerts, Stripe webhooks, Firebase Pro updates

import { Resvg, initWasm } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';

// Init WASM once at module load; all requests await this promise before rendering
const _resvgReady = initWasm(resvgWasm);

// Noto Sans variable TTF — fetched once per worker instance and cached in memory.
// ~2 MB from Google Fonts GitHub; CF edge keeps the connection warm so subsequent
// articles in the same invocation chain reuse the cached bytes.
let _fontBytes = null;
async function _getFont() {
  if (_fontBytes) return _fontBytes;
  const resp = await fetch(
    'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf',
    { headers: { 'User-Agent': 'fxnewsbias-cron' }, signal: AbortSignal.timeout(25000) }
  );
  if (!resp.ok) throw new Error(`Font fetch failed: ${resp.status}`);
  _fontBytes = new Uint8Array(await resp.arrayBuffer());
  return _fontBytes;
}

// Convert Uint8Array → base64 string for the GitHub blobs API
function _uint8ToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Render an SVG string to a PNG Uint8Array using resvg-wasm + Noto Sans
async function _svgToPng(svgString) {
  await _resvgReady;
  const font = await _getFont();
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontBuffers: [font], loadSystemFonts: false }
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

export default {
async fetch(request, env, ctx) {
const url = new URL(request.url);

if (url.pathname === '/webhook' && request.method === 'POST') {
return handleStripeWebhook(request, env);
}
if (url.pathname === '/contact-submit') {
return handleContactSubmit(request, env);
}
const _authed = () => url.searchParams.get('key') === env.CRON_TRIGGER_KEY;
if (url.pathname === '/run') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
await runSentimentAnalysis(env, { sendTelegram: false });
return new Response('Sentiment analysis complete!', { status: 200 });
}
if (url.pathname === '/prices') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
await updatePrices(env);
return new Response('Prices updated!', { status: 200 });
}
if (url.pathname === '/test-telegram') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
await sendTelegramAlert(env, null);
return new Response('Telegram test sent!', { status: 200 });
}
// Dry-run sentiment analysis: fetches news, calls Anthropic, returns parsed
// JSON. Does NOT save to Supabase. Does NOT fire Telegram. Use this to verify
// max_tokens / parsing fixes without polluting the live data or alert stream.
if (url.pathname === '/run-sentiment-dry-run') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const startedAt = Date.now();
try {
const news = await fetchAllNews();
const sentiment = await analyzeSentiment(news, env);
const REQUIRED = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD'];
const present = REQUIRED.filter(c => sentiment[c]);
return new Response(JSON.stringify({
ok: true,
duration_ms: Date.now() - startedAt,
news_count: news.length,
currencies_returned: present.length,
currencies_expected: REQUIRED.length,
all_present: present.length === REQUIRED.length,
missing: REQUIRED.filter(c => !sentiment[c]),
sample: { USD: sentiment.USD, NZD: sentiment.NZD, CHF: sentiment.CHF },
sentiment
}, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
} catch (e) {
return new Response(JSON.stringify({
ok: false,
duration_ms: Date.now() - startedAt,
error: e.message
}, null, 2), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
}
if (url.pathname === '/test-staleness-alert') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const sentAt = new Date().toISOString();
const text = `🧪 *FXNewsBias staleness alert — TEST*\n\n`
+ `This is a test message sent from \`/test-staleness-alert\` at \`${sentAt}\`.\n`
+ `No action is required. If you received this, the channel is wired up correctly.`;
const result = await sendStalenessNotification(env, text);
const status = result.sent > 0 && result.failed === 0
? 200
: (result.sent > 0 ? 207 : (result.results.length === 0 ? 503 : 502));
return new Response(JSON.stringify({
test: true,
sent_at: sentAt,
configured_channels: result.results.length,
delivered: result.sent,
failed: result.failed,
results: result.results
}, null, 2), {
status, headers: { 'Content-Type': 'application/json' }
});
}
if (url.pathname === '/check-staleness') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await checkSentimentFreshness(env);
return new Response(JSON.stringify(result, null, 2), {
status: 200, headers: { 'Content-Type': 'application/json' }
});
}
if (url.pathname === '/run-seo') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
// Synchronous — keeps the HTTP connection open until the job completes (~55s per step).
// ?step=pairs   → pairSEO only   (call this first)
// ?step=currencies → currencySEO only (call after pairs responds)
// no step param → both sequentially (for cron-like full refresh, ~110s)
// Running synchronously avoids ctx.waitUntil being killed by CF, and avoids the
// 422 git-ref race that happens when both steps compete for HEAD simultaneously.
const step = url.searchParams.get('step');
try {
  if (step === 'pairs') {
    await generateAllPairSEO(env);
    return new Response(JSON.stringify({ ok: true, msg: 'pairSEO complete' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (step === 'currencies') {
    await generateAllCurrencySEO(env);
    return new Response(JSON.stringify({ ok: true, msg: 'currencySEO complete' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // No step: run both sequentially
  await generateAllPairSEO(env);
  await generateAllCurrencySEO(env);
  return new Response(JSON.stringify({ ok: true, msg: 'pairSEO + currencySEO complete' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
} catch(e) {
  return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
}
if (url.pathname === '/run-insight') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await generateDailyInsight(env, url.searchParams.get('session') || undefined);
return new Response(JSON.stringify(result, null, 2), {
status: result.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' }
});
}
if (url.pathname === '/step-runs') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
return handleStepRunsView(url, env);
}
if (url.pathname === '/send-welcome-email' && request.method === 'POST') {
return handleWelcomeEmail(request, env);
}
if (url.pathname === '/test-broadcast') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const testEmail = url.searchParams.get('email') || 'dineshsanther123gf@gmail.com';
const result = await sendTestBroadcast(env, testEmail);
return new Response(JSON.stringify(result, null, 2), {
  status: result.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' }
});
}
if (url.pathname === '/backfill-audience') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await backfillResendAudience(env);
return new Response(JSON.stringify(result, null, 2), {
  status: result.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' }
});
}
if (url.pathname === '/incidents') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
return handleIncidentsView(url, env);
}
if (url.pathname === '/cleanup-runs') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
return handleCleanupRunsView(url, env);
}
if (url.pathname === '/cleanup-system-state') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await cleanupSystemState(env);
return new Response(JSON.stringify(result, null, 2), {
status: 200, headers: { 'Content-Type': 'application/json' }
});
}
if (url.pathname === '/cleanup-cleanup-runs') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await cleanupCleanupRuns(env);
return new Response(JSON.stringify(result, null, 2), {
status: 200, headers: { 'Content-Type': 'application/json' }
});
}
if (url.pathname === '/cleanup-news') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await cleanupNews(env);
return new Response(JSON.stringify(result, null, 2), {
status: 200, headers: { 'Content-Type': 'application/json' }
});
}
if (url.pathname === '/cleanup-sentiment') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await cleanupSentiment(env);
return new Response(JSON.stringify(result, null, 2), {
status: 200, headers: { 'Content-Type': 'application/json' }
});
}
// Weekly Pro report endpoint — loads from Supabase, falls back to build
if (url.pathname === '/api/weekly-report') {
return handleWeeklyReport(request, env, ctx);
}
// Weekly reports archive list
if (url.pathname === '/api/weekly-reports') {
return handleWeeklyReportsList(request, env);
}
// Manual trigger — returns 202 immediately, runs generation in background
if (url.pathname === '/api/generate-weekly-report') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
ctx.waitUntil(buildAndSaveWeeklyReport(env).catch(e => console.log('manual weekly report error:', e.message)));
return new Response(JSON.stringify({ ok: true, message: 'Generating in background. Check /api/weekly-reports in ~40s.' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
}
// Admin panel data — gated by Firebase ID token + admin email allowlist.
// Read-only: lists Firebase Auth users + Firestore subscription tiers.
if (url.pathname === '/admin-data') {
return handleAdminData(request, env);
}
if (url.pathname === '/admin-create-post' && request.method === 'POST') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
try {
  const post = await request.json();
  const token = await getFirebaseToken(env);
  const PROJECT_ID = env.FIREBASE_PROJECT_ID || 'fxnewsbias';
  const fsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts`;
  const now = new Date().toISOString();
  const body = { fields: {
    title:       { stringValue: post.title || '' },
    content:     { stringValue: post.content || '' },
    authorName:  { stringValue: 'FXNewsBias Team' },
    authorEmail: { stringValue: 'admin@fxnewsbias.com' },
    authorPhoto: { nullValue: null },
    likes:       { integerValue: '5' },
    views:       { integerValue: '47' },
    comments:    { integerValue: '0' },
    createdAt:   { stringValue: now },
    tags:        { arrayValue: { values: (post.tags||[]).map(t=>({stringValue:t})) } },
  }};
  const res = await fetch(fsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const data = await res.json();
  if (!res.ok) return new Response(JSON.stringify({ error: data }), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  const id = data.name ? data.name.split('/').pop() : null;
  return new Response(JSON.stringify({ ok: true, id, name: data.name }), { status: 200, headers: { 'Content-Type': 'application/json' } });
} catch(e) {
  return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
}
if (url.pathname === '/admin-update-post' && request.method === 'PATCH') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
try {
  const { id, content, title } = await request.json();
  if (!id) return new Response(JSON.stringify({ error: 'missing id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const token = await getFirebaseToken(env);
  const PROJECT_ID = env.FIREBASE_PROJECT_ID || 'fxnewsbias';
  const fields = {};
  if (content !== undefined) fields.content = { stringValue: content };
  if (title !== undefined) fields.title = { stringValue: title };
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const fsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/${id}?${mask}`;
  const res = await fetch(fsUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ fields }), signal: AbortSignal.timeout(25000) });
  const data = await res.json();
  if (!res.ok) return new Response(JSON.stringify({ error: data }), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ ok: true, id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
} catch(e) {
  return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
}
if (url.pathname === '/admin-delete-post' && request.method === 'DELETE') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
try {
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'missing id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const token = await getFirebaseToken(env);
  const PROJECT_ID = env.FIREBASE_PROJECT_ID || 'fxnewsbias';
  const fsUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/posts/${id}`;
  const res = await fetch(fsUrl, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) { const data = await res.json(); return new Response(JSON.stringify({ error: data }), { status: res.status, headers: { 'Content-Type': 'application/json' } }); }
  return new Response(JSON.stringify({ ok: true, deleted: id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
} catch(e) {
  return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
}
return new Response('FXNewsBias Cron Worker Running', { status: 200 });
},

async scheduled(event, env, ctx) {
// Cron triggers:
//   '*/15 * * * *'  -> price updates only
//   '0 */3 * * *'   -> sentiment only (writes fresh data; SEO steps read from this)
//   '7 */3 * * *'   -> pairSEO only   (7 min after sentiment — no Anthropic clash)
//   '10 */3 * * *'  -> currencySEO only (10 min after sentiment)
//   '15 */3 * * *'  -> cleanup + IndexNow
//   '13 0 * * *'    -> ASEAN insight  (13 min after 00:00 sentiment — weekdays only)
//   '13 6 * * *'    -> London insight (13 min after 06:00 sentiment — weekdays only)
//   '13 12 * * *'   -> NY insight     (13 min after 12:00 sentiment — weekdays only)
//   Insight runs at :13 — after sentiment (:00, finishes by :07 even with withRetry outer retry),
//   after pairSEO (:07, 5 batches×26s finishes ~:09:10), after currencySEO (:10, 2 batches finishes ~:11).
//   Cleanup at :15 has zero Claude calls so no clash if insight is still running.
const _dow = new Date().getUTCDay();
const _isWeekend = _dow === 0 || _dow === 6;
const cycleTs = _cycleTimestamp(event.cron);

const SESSION_BY_CRON = { '13 0 * * *': 'asean', '13 6 * * *': 'london', '13 12 * * *': 'newyork' };

if (event.cron === '*/15 * * * *') {
  ctx.waitUntil(updatePrices(env));

} else if (event.cron === '0 */3 * * *') {
  ctx.waitUntil((async () => {
    await runSentimentAnalysis(env, { cycleTs });
    // Sunday 21:00 UTC — weekly pro report runs after sentiment in the same invocation
    if (_dow === 0 && new Date().getUTCHours() === 21) {
      await buildAndSaveWeeklyReport(env).catch(e => console.log('Weekly report error:', e.message));
    }
  })());

} else if (event.cron === '7 */3 * * *') {
  ctx.waitUntil(generateAllPairSEO(env, { cycleTs }));

} else if (event.cron === '10 */3 * * *') {
  ctx.waitUntil(generateAllCurrencySEO(env, { cycleTs }));

} else if (event.cron === '15 */3 * * *') {
  ctx.waitUntil(Promise.all([
    cleanupNews(env).catch(e => console.log('cleanupNews error:', e.message)),
    cleanupSentiment(env).catch(e => console.log('cleanupSentiment error:', e.message)),
    cleanupSystemState(env).catch(e => console.log('cleanupSystemState error:', e.message)),
    cleanupCleanupRuns(env).catch(e => console.log('cleanupCleanupRuns error:', e.message)),
    cleanupStepRuns(env).catch(e => console.log('cleanupStepRuns error:', e.message)),
    pingIndexNow(ALL_DATA_URLS).catch(e => console.log('IndexNow error:', e.message)),
  ]));

} else if (SESSION_BY_CRON[event.cron] && !_isWeekend) {
  const session = SESSION_BY_CRON[event.cron];
  ctx.waitUntil(Promise.all([
    generateDailyInsight(env, session).catch(e => console.log(`Daily insight (${session}) error:`, e.message)),
    pingIndexNow(ALL_DATA_URLS).catch(e => console.log('IndexNow (insight) error:', e.message)),
    // Midnight (00:05) run also syncs forecast posts into sitemap
    ...(event.cron === '5 0 * * *' ? [syncForecastSitemap(env).catch(e => console.log('syncForecastSitemap error:', e.message))] : []),
  ]));

} else if (event.cron === '30 6 * * *' && !_isWeekend) {
  // 06:30 UTC = 2:30pm MYT — send London insight as daily broadcast to all users
  ctx.waitUntil(sendDailyBroadcast(env).catch(e => console.log('sendDailyBroadcast error:', e.message)));
}
}
};

// Returns the floor of the current time to the nearest 3-hour UTC boundary,
// used as the cycle_timestamp field in step_runs so all 4 steps of the same
// cycle share an identical timestamp regardless of their individual start times.
function _cycleTimestamp(cron) {
  if (cron === '*/15 * * * *') return new Date().toISOString();
  const now = new Date();
  const h = Math.floor(now.getUTCHours() / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0, 0)).toISOString();
}

// ============================================
// RETRY + STEP LOGGING INFRASTRUCTURE
// ============================================

// Wraps an async fn with up to 3 attempts and a fixed 5s wait between retries.
// Returns the result on success, or null after all attempts fail (never throws).
// On failure, writes a step_runs row and updates the consecutive-failure counter
// in system_state — if 2+ consecutive cycles fail, fires a Telegram alert.
async function withRetry(label, fn, env, cycleTs) {
  const started = Date.now();
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await fn();
      const duration = Math.round((Date.now() - started) / 1000);
      await _writeStepRun(env, {
        step_name: label, started_at: new Date(started).toISOString(),
        ended_at: new Date().toISOString(), duration_seconds: duration,
        status: 'success', retry_attempt: attempt, cycle_timestamp: cycleTs || new Date().toISOString()
      });
      await _resetConsecutiveFailures(env, label);
      return result;
    } catch(e) {
      lastErr = e;
      console.log(`${label} attempt ${attempt}/3 failed: ${e.message}`);
      if (attempt < 3) {
        // Wait longer on Anthropic overload (529) to give servers time to recover
        const delay = /529|overload/i.test(e.message) ? 30000 : 5000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  // All 3 attempts exhausted
  const duration = Math.round((Date.now() - started) / 1000);
  const ct = cycleTs || new Date().toISOString();
  await _writeStepRun(env, {
    step_name: label, started_at: new Date(started).toISOString(),
    ended_at: new Date().toISOString(), duration_seconds: duration,
    status: 'failed', error_message: lastErr ? lastErr.message : 'unknown',
    retry_attempt: 3, cycle_timestamp: ct
  });
  await _checkAndAlertConsecutiveFailures(env, label, lastErr ? lastErr.message : 'unknown', ct);
  return null;
}

async function _writeStepRun(env, row) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/step_runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) console.log('_writeStepRun non-ok:', r.status, (await r.text()).slice(0, 200));
  } catch(e) {
    console.log('_writeStepRun error:', e.message);
  }
}

async function _resetConsecutiveFailures(env, label) {
  const key = `step_consecutive_fail:${label}`;
  await writeSystemState(env, key, { count: 0, last_cycle: new Date().toISOString() });
}

async function _checkAndAlertConsecutiveFailures(env, label, errMsg, cycleTs) {
  const key = `step_consecutive_fail:${label}`;
  const prev = await readSystemState(env, key);
  const count = (prev && typeof prev.count === 'number' ? prev.count : 0) + 1;
  await writeSystemState(env, key, { count, last_cycle: cycleTs, last_error: errMsg });
  if (count >= 2) {
    const text = `🚨 *FXNewsBias — step failure: ${label}*\n\n`
      + `This step has failed *${count} consecutive cycles*.\n`
      + `Last error: \`${errMsg.slice(0, 300)}\`\n`
      + `Cycle: \`${cycleTs}\`\n\n`
      + `Check Cloudflare worker logs for details.`;
    await sendStalenessNotification(env, text).catch(e => console.log('Alert send error:', e.message));
    console.log(`${label}: consecutive failure alert sent (count=${count})`);
  }
}

// ============================================
// INDEXNOW (Bing / Yandex / DuckDuckGo)
// ============================================
// IndexNow lets us tell search engines a URL has changed, so they recrawl
// within minutes instead of waiting for their normal sitemap sweep. The
// key file is hosted at https://fxnewsbias.com/<KEY>.txt and Bing reads
// it once to verify ownership, then trusts subsequent pings.
const INDEXNOW_KEY = 'd5871002582b47b993a5f4841d714dea';
const INDEXNOW_KEY_LOCATION = 'https://fxnewsbias.com/d5871002582b47b993a5f4841d714dea.txt';

const ALL_DATA_URLS = [
  'https://fxnewsbias.com/',
  'https://fxnewsbias.com/currencies',
  'https://fxnewsbias.com/pairs',
  'https://fxnewsbias.com/news',
  'https://fxnewsbias.com/calendar',
  'https://fxnewsbias.com/community',
  'https://fxnewsbias.com/insight/',
  'https://fxnewsbias.com/currencies/usd/',
  'https://fxnewsbias.com/currencies/eur/',
  'https://fxnewsbias.com/currencies/gbp/',
  'https://fxnewsbias.com/currencies/jpy/',
  'https://fxnewsbias.com/currencies/aud/',
  'https://fxnewsbias.com/currencies/cad/',
  'https://fxnewsbias.com/currencies/chf/',
  'https://fxnewsbias.com/currencies/nzd/',
  'https://fxnewsbias.com/pairs/eur-usd/',
  'https://fxnewsbias.com/pairs/gbp-usd/',
  'https://fxnewsbias.com/pairs/usd-jpy/',
  'https://fxnewsbias.com/pairs/usd-chf/',
  'https://fxnewsbias.com/pairs/aud-usd/',
  'https://fxnewsbias.com/pairs/usd-cad/',
  'https://fxnewsbias.com/pairs/nzd-usd/',
  'https://fxnewsbias.com/pairs/eur-gbp/',
  'https://fxnewsbias.com/pairs/eur-jpy/',
  'https://fxnewsbias.com/pairs/eur-chf/',
  'https://fxnewsbias.com/pairs/gbp-jpy/',
  'https://fxnewsbias.com/pairs/aud-jpy/',
  'https://fxnewsbias.com/pairs/chf-jpy/',
  'https://fxnewsbias.com/pairs/cad-jpy/',
  'https://fxnewsbias.com/pairs/aud-nzd/',
];

async function syncForecastSitemap(env) {
  const API_KEY = 'AIzaSyD88nfD-GSk2icxgPMqOHOuLjCM19Zzso4';
  const PROJECT = 'fxnewsbias';
  const SITE = 'https://fxnewsbias.com';
  const today = new Date().toISOString().slice(0, 10);

  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/forecasts?pageSize=100&key=${API_KEY}`);
  if (!res.ok) throw new Error(`Firestore REST ${res.status}`);
  const data = await res.json();
  if (!data.documents || !data.documents.length) { console.log('syncForecastSitemap: no forecasts'); return; }

  const docIds = data.documents.map(d => d.name.split('/').pop());
  const oldSitemap = (await _insGetFile(env, 'sitemap.xml')) || '';
  let newSitemap = oldSitemap;
  const newUrls = [];

  for (const id of docIds) {
    if (!newSitemap.includes(id)) {
      const entry = `  <url><loc>${SITE}/forecast/${id}/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
      newSitemap = newSitemap.replace('</urlset>', entry + '\n</urlset>');
      newUrls.push(`${SITE}/forecast/${id}/`);
    }
  }

  if (!newUrls.length) { console.log('syncForecastSitemap: already up to date'); return; }

  await _insCommitFiles(env, [{ path: 'sitemap.xml', content: newSitemap }], `chore(sitemap): add ${newUrls.length} forecast post URL(s)`);
  await pingIndexNow(newUrls).catch(e => console.log('IndexNow forecast:', e.message));
  console.log(`syncForecastSitemap: added ${newUrls.length} URLs`);
}

async function pingIndexNow(urlList) {
  if (!urlList || urlList.length === 0) return;
  try {
    const res = await fetch('https://api.indexnow.org/IndexNow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: 'fxnewsbias.com', key: INDEXNOW_KEY, keyLocation: INDEXNOW_KEY_LOCATION, urlList }),
      signal: AbortSignal.timeout(25000),
    });
    console.log(`IndexNow: ${urlList.length} URLs -> HTTP ${res.status}`);
  } catch (e) {
    console.log('IndexNow ping error:', e.message);
  }
}

// ============================================
// STRIPE WEBHOOK HANDLER
// ============================================
async function handleStripeWebhook(request, env) {
try {
const body = await request.text();
const signature = request.headers.get('stripe-signature');

const isValid = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
if (!isValid) {
console.log('Invalid stripe signature');
return new Response('Invalid signature', { status: 400 });
}

const event = JSON.parse(body);
console.log('Stripe event:', event.type);

switch (event.type) {
case 'checkout.session.completed': {
const session = event.data.object;
const customerEmail = session.customer_details?.email;
const customerId = session.customer;
// checkout.session does not carry current_period_end; subscription.created
// will fire right after with the real period end. Pass null for now.
if (customerEmail) {
await updateUserProStatus(customerEmail, customerId, true, env, null);
console.log('Pro activated for:', customerEmail);
}
break;
}
case 'customer.subscription.created':
case 'customer.subscription.updated': {
const subscription = event.data.object;
const customerId = subscription.customer;
const isActive = subscription.status === 'active';
const periodEndIso = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
const customerEmail = await getStripeCustomerEmail(customerId, env);
if (customerEmail) {
await updateUserProStatus(customerEmail, customerId, isActive, env, periodEndIso, cancelAtPeriodEnd);
console.log('Subscription', subscription.status, 'for:', customerEmail, 'periodEnd:', periodEndIso, 'cancelAtPeriodEnd:', cancelAtPeriodEnd);
}
break;
}
case 'customer.subscription.deleted': {
const subscription = event.data.object;
const customerId = subscription.customer;
const customerEmail = await getStripeCustomerEmail(customerId, env);
if (customerEmail) {
// Subscription fully ended -- clear period end (no renewal coming).
await updateUserProStatus(customerEmail, customerId, false, env, null, false);
console.log('Pro cancelled for:', customerEmail);
}
break;
}
}

return new Response('OK', { status: 200 });

} catch (error) {
console.error('Webhook error:', error);
return new Response('Webhook error', { status: 500 });
}
}

async function verifyStripeSignature(body, signature, secret) {
try {
const parts = signature.split(',');
const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
const sigHash = parts.find(p => p.startsWith('v1=')).split('=')[1];
const payload = `${timestamp}.${body}`;
const encoder = new TextEncoder();
const key = await crypto.subtle.importKey(
'raw', encoder.encode(secret),
{ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
);
const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
const expected = Array.from(new Uint8Array(sig))
.map(b => b.toString(16).padStart(2, '0')).join('');
return expected === sigHash;
} catch(e) {
console.log('Signature error:', e.message);
return false;
}
}

async function getStripeCustomerEmail(customerId, env) {
try {
const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` }
});
const customer = await res.json();
return customer.email || null;
} catch(e) {
console.log('Error getting customer:', e.message);
return null;
}
}

// ============================================
// UPDATE USER PRO STATUS IN FIRESTORE
// Uses email as document ID — no Firebase Auth lookup needed!
// ============================================
async function updateUserProStatus(email, stripeCustomerId, isPro, env, currentPeriodEndIso, cancelAtPeriodEnd) {
try {
const token = await getFirebaseToken(env);
if (!token) {
console.log('Failed to get Firebase token');
return;
}

// Use email as document ID (replace special chars)
const docId = email.replace(/[.#$[\]@]/g, '_');
const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/subscriptions/${docId}`;

const res = await fetch(firestoreUrl, {
method: 'PATCH',
headers: {
'Content-Type': 'application/json',
'Authorization': `Bearer ${token}`
},
body: JSON.stringify({
fields: {
isPro: { booleanValue: isPro },
email: { stringValue: email },
stripeCustomerId: { stringValue: stripeCustomerId || '' },
updatedAt: { stringValue: new Date().toISOString() },
plan: { stringValue: isPro ? 'pro' : 'free' },
currentPeriodEnd: { stringValue: currentPeriodEndIso || '' },
cancelAtPeriodEnd: { booleanValue: cancelAtPeriodEnd === true }
}
})
});

const result = await res.json();
console.log('Firestore updated:', email, 'isPro:', isPro, 'status:', res.status);

} catch(e) {
console.log('Firestore update error:', e.message);
}
}

// ============================================
// GET FIREBASE ADMIN TOKEN
// ============================================
async function getFirebaseToken(env) {
try {
const now = Math.floor(Date.now() / 1000);
const payload = {
iss: env.FIREBASE_CLIENT_EMAIL,
sub: env.FIREBASE_CLIENT_EMAIL,
aud: 'https://oauth2.googleapis.com/token',
iat: now,
exp: now + 3600,
scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore'
};

const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const body = btoa(JSON.stringify(payload))
.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const signingInput = `${header}.${body}`;

const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
const keyData = privateKey
.replace('-----BEGIN PRIVATE KEY-----', '')
.replace('-----END PRIVATE KEY-----', '')
.replace(/\s/g, '');

const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
const cryptoKey = await crypto.subtle.importKey(
'pkcs8', binaryKey,
{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
false, ['sign']
);

const encoder = new TextEncoder();
const signature = await crypto.subtle.sign(
'RSASSA-PKCS1-v1_5', cryptoKey, encoder.encode(signingInput)
);

const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = `${signingInput}.${sigBase64}`;

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
method: 'POST',
headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
signal: AbortSignal.timeout(25000)
});

const tokenData = await tokenRes.json();
if (!tokenData.access_token) {
console.log('Token error:', JSON.stringify(tokenData));
}
return tokenData.access_token || null;

} catch(e) {
console.log('Firebase token error:', e.message);
return null;
}
}

// ============================================
// SENTIMENT ANALYSIS
// ============================================
// Called exclusively from the '0 */3 * * *' scheduled cron.
// withRetry handles up to 3 attempts (5s gap) and writes to step_runs.
// Telegram fires once per successful cycle from the scheduled cron.
async function runSentimentAnalysis(env, opts = {}) {
const { cycleTs } = opts;
const ct = cycleTs || new Date().toISOString();
console.log('Starting sentiment analysis...');

await withRetry('sentiment', async () => {
  const news = await fetchAllNews();
  console.log(`Fetched ${news.length} news items from 17 sources`);

  // Save news first — independent of sentiment API success
  try { await saveNews(news, env); console.log('News saved'); }
  catch(e) { console.log('saveNews failed:', e.message); }

  const sentiment = await analyzeSentiment(news, env);
  console.log('Sentiment analysis complete');

  try { await sendTelegramAlert(env, sentiment); console.log('Telegram alert sent'); }
  catch(e) { console.log('Telegram step failed:', e.message); }

  try { await saveSentiment(sentiment, env); console.log('Sentiment saved'); }
  catch(e) { console.log('saveSentiment failed:', e.message); }
}, env, ct);
}

// ============================================
// SENTIMENT FRESHNESS CHECK (read-only diagnostic)
// ============================================
// Self-heal logic removed — failures are retried naturally at the next
// scheduled 3-hour cycle. Consecutive-cycle failures trigger Telegram
// via the withRetry / _checkAndAlertConsecutiveFailures path.
// This function is retained only for the /check-staleness HTTP endpoint.
async function checkSentimentFreshness(env) {
const DEFAULT_CADENCE_MS = 3 * 60 * 60 * 1000;
const multiplier = parseFloat(env.STALENESS_MULTIPLIER) || 1.5;

const resp = await fetch(
`${env.SUPABASE_URL}/rest/v1/sentiment?select=id,currency,created_at&order=created_at.desc&limit=20`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(25000) }
);
if (!resp.ok) {
console.log('Staleness: failed to read sentiment table:', resp.status);
return { ok: false, reason: 'sentiment-read-failed' };
}
const rows = await resp.json();
if (!Array.isArray(rows) || rows.length === 0) {
console.log('Staleness: no sentiment rows yet, skipping check.');
return { ok: true, status: 'no-data' };
}

const latest = rows[0];
const latestTs = Date.parse(latest.created_at);
const now = Date.now();
const ageMs = now - latestTs;

// Each scheduled run inserts one row per currency at (almost) the same
// timestamp, so use distinct timestamps for cadence estimation.
const distinctTimes = [];
for (const r of rows) {
const t = Date.parse(r.created_at);
if (!distinctTimes.length || Math.abs(distinctTimes[distinctTimes.length - 1] - t) > 60_000) {
distinctTimes.push(t);
}
if (distinctTimes.length >= 5) break;
}
let cadenceMs = parseInt(env.SENTIMENT_CADENCE_MS, 10);
if (!cadenceMs || isNaN(cadenceMs)) {
if (distinctTimes.length >= 2) {
const gaps = [];
for (let i = 1; i < distinctTimes.length; i++) gaps.push(distinctTimes[i - 1] - distinctTimes[i]);
gaps.sort((a, b) => a - b);
cadenceMs = gaps[Math.floor(gaps.length / 2)];
}
if (!cadenceMs || cadenceMs <= 0) cadenceMs = DEFAULT_CADENCE_MS;
}

const thresholdMs = Math.round(cadenceMs * multiplier);
const isStale = ageMs > thresholdMs;

return {
ok: true,
latest_id: latest.id,
latest_at: latest.created_at,
age_minutes: Math.round(ageMs / 60000),
cadence_minutes: Math.round(cadenceMs / 60000),
threshold_minutes: Math.round(thresholdMs / 60000),
stale: isStale,
action: isStale ? 'stale' : 'fresh'
};
}

async function sendStalenessNotification(env, text) {
// Fan out to every configured channel. Each channel is wrapped so a single
// failure (HTTP error, timeout, missing config) doesn't prevent the others
// from receiving the alert. Per-channel success/failure is logged.
const channels = [];

if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID) {
channels.push({
name: 'telegram',
send: () => fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ chat_id: env.TELEGRAM_CHANNEL_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
signal: AbortSignal.timeout(25000)
})
});
}

if (env.STALENESS_WEBHOOK_URL) {
channels.push({
name: 'webhook',
send: () => fetch(env.STALENESS_WEBHOOK_URL, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ text }),
signal: AbortSignal.timeout(25000)
})
});
}

if (env.SLACK_WEBHOOK_URL) {
channels.push({
name: 'slack',
send: () => fetch(env.SLACK_WEBHOOK_URL, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ text, mrkdwn: true }),
signal: AbortSignal.timeout(25000)
})
});
}

if (env.ALERT_EMAIL_TO && env.RESEND_API_KEY) {
const recipients = String(env.ALERT_EMAIL_TO).split(',').map(s => s.trim()).filter(Boolean);
if (recipients.length) {
const fromEmail = env.ALERT_EMAIL_FROM || env.CONTACT_FROM_EMAIL || 'noreply@fxnewsbias.com';
const subject = /\bTEST\b/.test(text)
? 'FXNewsBias: test staleness alert'
: (/recovered/i.test(text) ? 'FXNewsBias: sentiment feed recovered' : 'FXNewsBias: step failure alert');
const htmlBody = `<pre style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;white-space:pre-wrap;">${escapeHtml(text)}</pre>`;
channels.push({
name: 'email',
send: () => fetch('https://api.resend.com/emails', {
method: 'POST',
headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
body: JSON.stringify({ from: `FXNewsBias Alerts <${fromEmail}>`, to: recipients, subject, text, html: htmlBody }),
signal: AbortSignal.timeout(25000)
})
});
}
} else if (env.ALERT_EMAIL_TO && !env.RESEND_API_KEY) {
console.log('Staleness email: ALERT_EMAIL_TO is set but RESEND_API_KEY is missing; skipping email channel.');
}

if (!channels.length) {
console.log('Staleness: no notification channel configured (TELEGRAM_*, STALENESS_WEBHOOK_URL, SLACK_WEBHOOK_URL, or ALERT_EMAIL_TO+RESEND_API_KEY).');
return { sent: 0, failed: 0, results: [] };
}

const settled = await Promise.all(channels.map(async (ch) => {
try {
const resp = await ch.send();
if (resp && typeof resp.ok === 'boolean' && !resp.ok) {
let detail = '';
try { detail = (await resp.text()).slice(0, 200); } catch (_) {}
console.log(`Staleness ${ch.name}: failed HTTP ${resp.status} ${detail}`);
return { channel: ch.name, ok: false, status: resp.status };
}
console.log(`Staleness ${ch.name}: delivered`);
return { channel: ch.name, ok: true, status: resp && resp.status };
} catch (e) {
console.log(`Staleness ${ch.name}: error ${e.message}`);
return { channel: ch.name, ok: false, error: e.message };
}
}));

const sent = settled.filter(r => r.ok).length;
const failed = settled.length - sent;
console.log(`Staleness notification fan-out: ${sent}/${settled.length} channels delivered (${failed} failed).`);
return { sent, failed, results: settled };
}

async function readSystemState(env, key) {
try {
const r = await fetch(
`${env.SUPABASE_URL}/rest/v1/system_state?key=eq.${encodeURIComponent(key)}&select=value`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }, signal: AbortSignal.timeout(25000) }
);
if (!r.ok) return null;
const rows = await r.json();
return rows && rows[0] ? rows[0].value : null;
} catch (e) {
console.log('readSystemState error:', e.message);
return null;
}
}

// ============================================
// STALENESS INCIDENT HISTORY
// ============================================
// Append-only log of incidents in the `staleness_incidents` table. Helpers
// here are best-effort: a failure to write history must NEVER prevent the
// alert / state machine in checkSentimentFreshness from making progress.
// See cf/staleness_incidents.sql for the table DDL.

async function recordIncidentStart(env, key, startedAt, summary) {
try {
const r = await fetch(`${env.SUPABASE_URL}/rest/v1/staleness_incidents`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'return=minimal'
},
body: JSON.stringify({ key, started_at: startedAt, summary: summary || {} })
});
if (!r.ok) console.log('recordIncidentStart non-ok:', r.status, (await r.text()).slice(0, 200));
} catch (e) {
console.log('recordIncidentStart error:', e.message);
}
}

async function recordIncidentResolved(env, key, resolvedAt, extraSummary) {
// Find the most recent open incident for this key and close it.
try {
const findResp = await fetch(
`${env.SUPABASE_URL}/rest/v1/staleness_incidents`
+ `?key=eq.${encodeURIComponent(key)}`
+ `&resolved_at=is.null`
+ `&order=started_at.desc&limit=1&select=id,started_at,summary`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
);
if (!findResp.ok) {
console.log('recordIncidentResolved find non-ok:', findResp.status);
return;
}
const rows = await findResp.json();
const open = Array.isArray(rows) && rows[0];
if (!open) {
console.log('recordIncidentResolved: no open incident found for', key);
return;
}
const startedMs = Date.parse(open.started_at);
const resolvedMs = Date.parse(resolvedAt);
const durationMs = isFinite(startedMs) && isFinite(resolvedMs)
? Math.max(0, resolvedMs - startedMs) : null;
const mergedSummary = { ...(open.summary || {}), ...(extraSummary || {}) };
const r = await fetch(
`${env.SUPABASE_URL}/rest/v1/staleness_incidents?id=eq.${open.id}`,
{
method: 'PATCH',
headers: {
'Content-Type': 'application/json',
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'return=minimal'
},
body: JSON.stringify({
resolved_at: resolvedAt,
duration_ms: durationMs,
summary: mergedSummary
})
}
);
if (!r.ok) console.log('recordIncidentResolved patch non-ok:', r.status, (await r.text()).slice(0, 200));
} catch (e) {
console.log('recordIncidentResolved error:', e.message);
}
}

async function listRecentIncidents(env, key, limit) {
const params = new URLSearchParams();
params.set('select', 'id,key,started_at,resolved_at,duration_ms,summary');
params.set('order', 'started_at.desc');
params.set('limit', String(limit));
if (key) params.set('key', `eq.${key}`);
try {
const r = await fetch(
`${env.SUPABASE_URL}/rest/v1/staleness_incidents?${params.toString()}`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
);
if (!r.ok) {
console.log('listRecentIncidents non-ok:', r.status);
return [];
}
const rows = await r.json();
return Array.isArray(rows) ? rows : [];
} catch (e) {
console.log('listRecentIncidents error:', e.message);
return [];
}
}

// ============================================
// WELCOME EMAIL
// ============================================

async function handleWelcomeEmail(request, env) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Internal-Key' };
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const internalKey = request.headers.get('X-Internal-Key');
  if (!env.CRON_TRIGGER_KEY || internalKey !== env.CRON_TRIGGER_KEY) {
    return new Response('Unauthorized', { status: 401, headers: cors });
  }
  if (!env.RESEND_API_KEY) {
    console.log('send-welcome-email: RESEND_API_KEY not configured');
    return new Response(JSON.stringify({ ok: false }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
  }

  let email, name;
  try {
    const body = await request.json();
    email = String(body.email || '').trim();
    name  = String(body.name  || '').trim();
  } catch {
    return new Response('Bad request', { status: 400, headers: cors });
  }
  if (!email || !email.includes('@')) {
    return new Response('Bad request', { status: 400, headers: cors });
  }

  const firstName = name.split(' ')[0] || 'there';
  const from = env.ALERT_EMAIL_FROM || 'hello@fxnewsbias.com';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to FXNewsBias</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;width:100%;">
  <tr><td style="background:#1e40af;padding:32px 40px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#93c5fd;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;">FXNewsBias</p>
    <h1 style="margin:12px 0 0;color:#ffffff;font-size:26px;font-weight:800;line-height:1.25;">Your Forex Sentiment Edge<br>Starts Now 🚀</h1>
  </td></tr>
  <tr><td style="padding:36px 40px;">
    <p style="margin:0 0 20px;font-size:16px;color:#0f172a;line-height:1.6;">Hi <strong>${firstName}</strong>,</p>
    <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.7;">Welcome to FXNewsBias — you've just unlocked <strong>real-time forex news sentiment analysis</strong> across all major pairs and currencies.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#0f172a;">📰 &nbsp;<strong>Sentiment tracking</strong> across major currency pairs</p>
      </td></tr>
      <tr><td style="padding:6px 0;font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#0f172a;">📊 &nbsp;<strong>Live bias scores</strong> updated every 3 hours from 16 news sources</p>
      </td></tr>
      <tr><td style="padding:6px 0;font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#0f172a;">📅 &nbsp;<strong>Economic calendar</strong> — know what moves the market before it moves</p>
      </td></tr>
      <tr><td style="padding:6px 0;font-size:1px;">&nbsp;</td></tr>
      <tr><td style="padding:10px 14px;background:#f8fafc;border-radius:8px;">
        <p style="margin:0;font-size:14px;color:#0f172a;">💬 &nbsp;<strong>Community</strong> — share your analysis with other traders</p>
      </td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1e40af,#7c3aed);border-radius:10px;margin-bottom:28px;">
      <tr><td style="padding:28px 32px;text-align:center;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#c4b5fd;letter-spacing:0.1em;text-transform:uppercase;">Ready to go Pro?</p>
        <h2 style="margin:0 0 12px;color:#ffffff;font-size:20px;font-weight:800;">Unlock the Full Edge</h2>
        <p style="margin:0 0 20px;font-size:13px;color:#c4b5fd;line-height:1.6;">Full sentiment history · Advanced filters · Weekly AI intelligence brief · Priority updates</p>
        <a href="https://fxnewsbias.com/report" style="display:inline-block;background:#f59e0b;color:#1a1a1a;font-size:15px;font-weight:800;padding:14px 32px;border-radius:8px;text-decoration:none;">⭐ Upgrade to Pro — $9.99/mo</a>
      </td></tr>
    </table>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.7;">Questions? Reply to this email or visit <a href="https://fxnewsbias.com/contact" style="color:#1e40af;text-decoration:none;font-weight:600;">fxnewsbias.com/contact</a></p>
    <p style="margin:0;font-size:15px;color:#0f172a;line-height:1.8;">Happy trading,<br><strong>The FXNewsBias Team</strong></p>
  </td></tr>
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
→ https://fxnewsbias.com/report

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

  // Add user to Resend audience so they receive future broadcasts
  if (env.RESEND_API_KEY && email) {
    const firstName = name.split(' ')[0] || '';
    const lastName  = name.split(' ').slice(1).join(' ') || '';
    fetch('https://api.resend.com/audiences/7b690548-4533-43f5-a22f-bf862d1366ff/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, first_name: firstName, last_name: lastName, unsubscribed: false }),
    }).catch(e => console.log('Resend audience sync error:', e.message));
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
}

// ============================================
// DAILY BROADCAST EMAIL (London insight → all users, 06:30 UTC = 2:30pm MYT)
// ============================================

async function backfillResendAudience(env) {
  const AUDIENCE_ID = '7b690548-4533-43f5-a22f-bf862d1366ff';
  const FS_KEY      = 'AIzaSyD88nfD-GSk2icxgPMqOHOuLjCM19Zzso4';
  const FS_BASE     = 'https://firestore.googleapis.com/v1/projects/fxnewsbias/databases/(default)/documents';

  // 1. Fetch all users from Firestore
  const results = { added: [], skipped: [], errors: [] };
  let pageToken = null;
  let allUsers  = [];

  do {
    const qs  = pageToken ? `?pageSize=100&pageToken=${pageToken}&key=${FS_KEY}` : `?pageSize=100&key=${FS_KEY}`;
    const res = await fetch(`${FS_BASE}/users${qs}`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const docs = data.documents || [];
    for (const doc of docs) {
      const f = doc.fields || {};
      const email    = f.email?.stringValue    || '';
      const username = f.username?.stringValue || '';
      if (email && email.includes('@')) allUsers.push({ email, username });
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  console.log(`backfillResendAudience: found ${allUsers.length} users in Firestore`);

  // 2. Add each to Resend audience
  for (const { email, username } of allUsers) {
    const firstName = username.split(' ')[0] || '';
    const lastName  = username.split(' ').slice(1).join(' ') || '';
    try {
      const resp = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, first_name: firstName, last_name: lastName, unsubscribed: false }),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        results.added.push(email);
        console.log(`backfill: added ${email}`);
      } else {
        const err = await resp.text();
        // 409 = already exists — not an error
        if (resp.status === 409) {
          results.skipped.push(email);
        } else {
          results.errors.push({ email, error: `${resp.status} ${err.slice(0,100)}` });
          console.log(`backfill: error for ${email}: ${resp.status}`);
        }
      }
    } catch (e) {
      results.errors.push({ email, error: e.message });
    }
  }

  return {
    ok: true,
    total: allUsers.length,
    added: results.added.length,
    skipped: results.skipped.length,
    errors: results.errors.length,
    detail: results,
  };
}

async function sendTestBroadcast(env, testEmail) {
  try {
    const html = await _buildBroadcastHtml(env, testEmail.split('@')[0]);
    if (!html) throw new Error('Could not build broadcast HTML');
    const { headline } = await _getLatestLondonInsight(env);
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `FXNewsBias <${env.ALERT_EMAIL_FROM || 'hello@fxnewsbias.com'}>`,
        to: [testEmail],
        subject: `[TEST] 📊 ${headline}`,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) { const e = await resp.text(); throw new Error(`Resend error: ${resp.status} ${e.slice(0,200)}`); }
    const data = await resp.json();
    console.log(`sendTestBroadcast: sent to ${testEmail} — id ${data.id}`);
    return { ok: true, id: data.id, to: testEmail };
  } catch (e) {
    console.error('sendTestBroadcast error:', e.message);
    return { ok: false, error: e.message };
  }
}

async function _getLatestLondonInsight(env) {
  const manifestRaw = await _insGetFile(env, 'insight/articles.json');
  if (!manifestRaw) throw new Error('Could not load articles.json');
  const articles = JSON.parse(manifestRaw);
  const london = articles.find(a => a.slug && a.slug.includes('-london-'));
  if (!london) throw new Error('No London insight found');
  return london;
}

async function _buildBroadcastHtml(env, firstName = 'Trader') {
  const london = await _getLatestLondonInsight(env);
  const { slug, headline, summary, dateLabel, category } = london;
  const articleUrl = `https://fxnewsbias.com/insight/${slug}`;
  const ogImage    = `https://fxnewsbias.com/og/insight/${slug}.png`;
  const sessionTag = category || 'London Session';

  const articleHtml = await _insGetFile(env, `insight/${slug}.html`);
  let sections = [summary, 'Check the live sentiment dashboard for the latest bias scores across all major pairs.', 'The NY session insight drops at 8pm Malaysia time — watch the insights page for the latest.'];
  if (articleHtml) {
    const paras = [];
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = pRe.exec(articleHtml)) !== null) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&ldquo;/g,'"').replace(/&rdquo;/g,'"').replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&nbsp;/g,' ').trim();
      if (text.length > 100) paras.push(text);
      if (paras.length === 3) break;
    }
    if (paras[0]) sections[0] = paras[0];
    if (paras[1]) sections[1] = paras[1];
    if (paras[2]) sections[2] = paras[2];
  }

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FXNewsBias</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);max-width:600px;width:100%;">
  <tr><td style="background:#0f172a;padding:30px 40px;text-align:center;">
    <p style="margin:0 0 8px;font-size:11px;color:#475569;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">FXNewsBias · London Session Insight</p>
    <h1 style="margin:0 0 8px;color:#fff;font-size:22px;font-weight:800;line-height:1.3;">${esc(headline)}</h1>
    <p style="margin:0;font-size:13px;color:#64748b;">${esc(sessionTag)} · ${today} · 2:30pm 🇲🇾</p>
  </td></tr>
  <tr><td style="background:linear-gradient(90deg,#1e3a8a,#1d4ed8);padding:13px 40px;text-align:center;">
    <p style="margin:0;font-size:13px;color:#bfdbfe;font-weight:500;">London is open — here is today's forex sentiment picture 📊</p>
  </td></tr>
  <tr><td style="padding:0;"><img src="${esc(ogImage)}" width="600" style="display:block;width:100%;max-width:600px;" alt="${esc(headline)}"></td></tr>
  <tr><td style="padding:36px 40px 20px;">
    <p style="margin:0 0 20px;font-size:16px;color:#0f172a;line-height:1.6;">Hi ${firstName.startsWith('{{') ? firstName : esc(firstName)},</p>
    <p style="margin:0 0 28px;font-size:15px;color:#334155;line-height:1.75;">${esc(summary)}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr><td style="padding:18px 20px;background:#f8fafc;border-left:4px solid #1d4ed8;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 5px;font-size:11px;font-weight:700;color:#1d4ed8;letter-spacing:.08em;text-transform:uppercase;">What Happened</p>
      <p style="margin:0;font-size:14px;color:#475569;line-height:1.7;">${esc(sections[0])}</p>
    </td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr><td style="padding:18px 20px;background:#f8fafc;border-left:4px solid #7c3aed;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 5px;font-size:11px;font-weight:700;color:#7c3aed;letter-spacing:.08em;text-transform:uppercase;">Key Driver</p>
      <p style="margin:0;font-size:14px;color:#475569;line-height:1.7;">${esc(sections[1])}</p>
    </td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td style="padding:18px 20px;background:#f8fafc;border-left:4px solid #0891b2;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 5px;font-size:11px;font-weight:700;color:#0891b2;letter-spacing:.08em;text-transform:uppercase;">What to Watch</p>
      <p style="margin:0;font-size:14px;color:#475569;line-height:1.7;">${esc(sections[2])}</p>
    </td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr><td align="center">
      <a href="${articleUrl}" style="display:inline-block;background:#1e40af;color:#fff;font-size:15px;font-weight:700;padding:15px 40px;border-radius:8px;text-decoration:none;">Read Full London Insight →</a>
    </td></tr></table>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0 28px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;background:#fefce8;border:1px solid #fde68a;border-radius:10px;"><tr><td style="padding:18px 22px;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#92400e;letter-spacing:.07em;text-transform:uppercase;">☀️ Also Out Today</p>
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a;">Asia Session Insight is live</p>
      <p style="margin:0 0 12px;font-size:14px;color:#78350f;line-height:1.6;">Missed the Asian open? Today's Asia insight is already published — covering the overnight sentiment picture from Tokyo, Singapore and Sydney.</p>
      <a href="https://fxnewsbias.com/insight" style="display:inline-block;background:#f59e0b;color:#1a1a1a;font-size:13px;font-weight:700;padding:10px 22px;border-radius:7px;text-decoration:none;">View Asia Insight →</a>
    </td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;"><tr><td style="padding:18px 22px;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#166534;letter-spacing:.07em;text-transform:uppercase;">🕗 Coming Up at 8:00pm 🇲🇾</p>
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0f172a;">New York Session Insight</p>
      <p style="margin:0;font-size:14px;color:#15803d;line-height:1.6;">The NY session insight drops at 8pm Malaysia time — covering the US open sentiment picture and what to watch heading into the American session.</p>
    </td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;background:linear-gradient(135deg,#1e40af,#7c3aed);border-radius:10px;"><tr><td style="padding:24px 28px;text-align:center;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#c4b5fd;letter-spacing:.1em;text-transform:uppercase;">Want More?</p>
      <h3 style="margin:0 0 8px;color:#fff;font-size:18px;font-weight:800;">Get the Full Sentiment History</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#c4b5fd;line-height:1.6;">Upgrade to Pro for full history, advanced filters and the weekly AI intelligence brief.</p>
      <a href="https://fxnewsbias.com/report" style="display:inline-block;background:#f59e0b;color:#1a1a1a;font-size:14px;font-weight:800;padding:12px 28px;border-radius:7px;text-decoration:none;">⭐ Upgrade to Pro — $9.99/mo</a>
    </td></tr></table>
    <p style="margin:0 0 4px;font-size:15px;color:#0f172a;">Happy trading,</p>
    <p style="margin:0 0 28px;font-size:15px;font-weight:700;color:#0f172a;">The FXNewsBias Team</p>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:22px 40px;text-align:center;">
    <p style="margin:0 0 8px;"><a href="https://fxnewsbias.com" style="color:#1e40af;text-decoration:none;font-weight:700;font-size:13px;">fxnewsbias.com</a></p>
    <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;">Not financial advice &nbsp;·&nbsp; <a href="https://fxnewsbias.com/disclaimer" style="color:#94a3b8;text-decoration:none;">Disclaimer</a> &nbsp;·&nbsp; <a href="https://fxnewsbias.com/contact" style="color:#94a3b8;text-decoration:none;">Contact</a></p>
    <p style="margin:0;font-size:11px;color:#cbd5e1;line-height:1.7;">You're receiving this because you signed up at fxnewsbias.com<br><a href="{{unsubscribe_url}}" style="color:#94a3b8;text-decoration:none;">Unsubscribe</a></p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

async function sendDailyBroadcast(env) {
  if (!env.RESEND_API_KEY) { console.log('sendDailyBroadcast: RESEND_API_KEY missing'); return; }

  const london = await _getLatestLondonInsight(env);
  const { headline, dateLabel } = london;
  const html = await _buildBroadcastHtml(env, '{{first_name | fallback: "Trader"}}');
  if (!html) throw new Error('Could not build broadcast HTML');

  const subject = `📊 ${headline}`;
  const today   = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });

  // Create broadcast in Resend
  const createRes = await fetch('https://api.resend.com/broadcasts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audience_id: '7b690548-4533-43f5-a22f-bf862d1366ff',
      from: `FXNewsBias <${env.ALERT_EMAIL_FROM || 'hello@fxnewsbias.com'}>`,
      subject,
      html,
      name: `London Insight — ${dateLabel || today}`,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Resend create broadcast failed: ${createRes.status} ${err.slice(0, 200)}`);
  }
  const { id: broadcastId } = await createRes.json();
  console.log(`sendDailyBroadcast: created broadcast ${broadcastId}`);

  // 5. Send it
  const sendRes = await fetch(`https://api.resend.com/broadcasts/${broadcastId}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10000),
  });

  if (!sendRes.ok) {
    const err = await sendRes.text();
    throw new Error(`Resend send broadcast failed: ${sendRes.status} ${err.slice(0, 200)}`);
  }
  console.log(`sendDailyBroadcast: sent broadcast ${broadcastId} — "${subject}"`);
}

// ============================================
// STEP RUNS DASHBOARD
// ============================================

async function handleStepRunsView(url, env) {
  const step = url.searchParams.get('step') || '';
  const limitRaw = parseInt(url.searchParams.get('limit'), 10);
  const limit = Math.min(Math.max(isFinite(limitRaw) ? limitRaw : 40, 1), 200);
  const format = (url.searchParams.get('format') || 'html').toLowerCase();

  const params = new URLSearchParams();
  params.set('select', 'id,step_name,started_at,ended_at,duration_seconds,status,error_message,retry_attempt,cycle_timestamp');
  params.set('order', 'started_at.desc');
  params.set('limit', String(limit));
  if (step) params.set('step_name', `eq.${step}`);

  let rows = [];
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/step_runs?${params.toString()}`, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(25000)
    });
    if (r.ok) rows = await r.json();
  } catch(e) {
    console.log('handleStepRunsView fetch error:', e.message);
  }

  if (format === 'json') {
    return new Response(JSON.stringify({ step: step || null, limit, count: rows.length, rows }, null, 2), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }
  const key = url.searchParams.get('key') || '';
  return new Response(renderStepRunsHtml(rows, step, limit, key), {
    status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function renderStepRunsHtml(rows, step, limit, key) {
  const STEP_NAMES = ['sentiment', 'pairSEO', 'currencySEO'];
  const statusColor = { success: '#15803d', failed: '#b91c1c', partial: '#b45309' };
  const statusBg    = { success: '#f0fdf4', failed: '#fef2f2', partial: '#fffbeb' };

  // Build per-step summary cards from the rows
  const cards = STEP_NAMES.map(name => {
    const stepRows = rows.filter(r => r.step_name === name);
    if (!stepRows.length) return { name, last: null, successRate: null, avgDuration: null };
    const last = stepRows[0];
    const total = stepRows.length;
    const successes = stepRows.filter(r => r.status === 'success').length;
    const durations = stepRows.filter(r => r.duration_seconds != null).map(r => r.duration_seconds);
    const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    return { name, last, successRate: Math.round(100 * successes / total), avgDuration, total };
  });

  const cardsHtml = cards.map(c => `
    <div class="card">
      <div class="card-title">${escapeHtml(c.name)}</div>
      ${c.last ? `
        <div class="card-status" style="color:${statusColor[c.last.status] || '#64748b'}">
          ${escapeHtml(c.last.status.toUpperCase())}
        </div>
        <div class="card-meta">Last run: ${escapeHtml(c.last.started_at ? c.last.started_at.replace('T',' ').slice(0,19)+' UTC' : '—')}</div>
        <div class="card-meta">Success rate: <strong>${c.successRate}%</strong> (${c.total} runs shown)</div>
        <div class="card-meta">Avg duration: <strong>${c.avgDuration != null ? c.avgDuration + 's' : '—'}</strong></div>
        ${c.last.retry_attempt > 1 ? `<div class="card-meta warn">Last run needed ${c.last.retry_attempt} attempt(s)</div>` : ''}
        ${c.last.status === 'failed' ? `<div class="card-meta err">Error: ${escapeHtml((c.last.error_message || '').slice(0, 120))}</div>` : ''}
      ` : '<div class="card-meta">No data yet</div>'}
    </div>`).join('');

  const tableRows = rows.map(r => {
    const bg = statusBg[r.status] || '';
    const ago = r.started_at ? Math.round((Date.now() - Date.parse(r.started_at)) / 60000) : null;
    const agoStr = ago != null ? (ago < 60 ? `${ago}m ago` : `${Math.round(ago/60)}h ago`) : '';
    return `<tr style="background:${bg}">
      <td><code>${escapeHtml(r.step_name)}</code></td>
      <td style="color:${statusColor[r.status]||'#64748b'};font-weight:600">${escapeHtml(r.status)}</td>
      <td>${escapeHtml(r.started_at ? r.started_at.replace('T',' ').slice(0,19)+' UTC' : '—')}<br><small style="color:#94a3b8">${escapeHtml(agoStr)}</small></td>
      <td>${r.duration_seconds != null ? escapeHtml(String(r.duration_seconds)) + 's' : '—'}</td>
      <td style="color:${r.retry_attempt > 1 ? '#b45309' : '#64748b'}">${escapeHtml(String(r.retry_attempt))}</td>
      <td><code style="font-size:11px;color:#64748b">${escapeHtml((r.cycle_timestamp || '').slice(0,16).replace('T',' '))}</code></td>
      <td style="color:#b91c1c;font-size:12px">${escapeHtml((r.error_message || '').slice(0, 200))}</td>
    </tr>`;
  }).join('');

  const filterLinks = ['', ...STEP_NAMES].map(s =>
    `<a href="?key=${encodeURIComponent(key)}&step=${encodeURIComponent(s)}&limit=${limit}" style="${s === step ? 'font-weight:700;text-decoration:none;color:#0f172a' : ''}">${s || 'All steps'}</a>`
  ).join(' &nbsp;|&nbsp; ');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>FXNewsBias — Step Run Dashboard</title>
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="refresh" content="180">
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:20px 24px;color:#0f172a;background:#f1f5f9;font-size:14px}
h1{font-size:17px;margin:0 0 4px;font-weight:700}
.sub{color:#64748b;font-size:12px;margin:0 0 18px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;min-width:180px;flex:1}
.card-title{font-weight:700;font-size:13px;color:#1e293b;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px}
.card-status{font-size:20px;font-weight:800;margin-bottom:4px}
.card-meta{font-size:12px;color:#475569;margin-top:2px}
.card-meta.warn{color:#b45309}
.card-meta.err{color:#b91c1c;word-break:break-word}
.filters{margin-bottom:12px;font-size:13px}
.filters a{color:#3b82f6}
table{border-collapse:collapse;width:100%;background:#fff;font-size:13px;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
th,td{border-bottom:1px solid #e5e7eb;padding:8px 10px;vertical-align:top;text-align:left}
th{background:#f8fafc;font-size:12px;color:#475569;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
tr:last-child td{border-bottom:none}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.meta{color:#64748b;font-size:12px;margin:10px 0 14px}
</style>
</head><body>
<h1>FXNewsBias — Cron Step Dashboard</h1>
<p class="sub">Auto-refreshes every 3 min &nbsp;·&nbsp; Append <code>&format=json</code> for raw JSON &nbsp;·&nbsp; <a href="?key=${encodeURIComponent(key)}&step=&limit=${limit}&format=json">JSON export</a></p>

<div class="cards">${cardsHtml}</div>

<div class="filters">Filter: ${filterLinks}</div>

<p class="meta">Showing last ${limit} rows${step ? ` for step <strong>${escapeHtml(step)}</strong>` : ''}.</p>

<table>
<thead><tr>
  <th>Step</th><th>Status</th><th>Started</th><th>Duration</th><th>Attempts</th><th>Cycle</th><th>Error</th>
</tr></thead>
<tbody>
${tableRows || '<tr><td colspan="7" style="color:#64748b;text-align:center;padding:20px">No step_runs rows yet — waiting for next 0 */3 cron tick.</td></tr>'}
</tbody>
</table>
</body></html>`;
}


async function handleIncidentsView(url, env) {
const key = url.searchParams.get('incident_key') || '';
const limitRaw = parseInt(url.searchParams.get('limit'), 10);
const limit = Math.min(Math.max(isFinite(limitRaw) ? limitRaw : 50, 1), 200);
const format = (url.searchParams.get('format') || 'html').toLowerCase();

let rows;
if (key) {
rows = await listRecentIncidents(env, key, limit);
} else {
// "Last N per key": pull a generous window then group/cap per key in JS
// so we don't need a window function or a SQL view.
const all = await listRecentIncidents(env, null, Math.max(limit * 4, 200));
const perKey = new Map();
for (const r of all) {
const arr = perKey.get(r.key) || [];
if (arr.length < limit) arr.push(r);
perKey.set(r.key, arr);
}
rows = [];
for (const arr of perKey.values()) rows.push(...arr);
rows.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

if (format === 'json') {
return new Response(JSON.stringify({ key: key || null, limit, count: rows.length, incidents: rows }, null, 2), {
status: 200, headers: { 'Content-Type': 'application/json' }
});
}

return new Response(renderIncidentsHtml(rows, key, limit), {
status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
});
}

function formatDurationMs(ms) {
if (ms == null || !isFinite(ms)) return '—';
const totalSec = Math.round(ms / 1000);
const h = Math.floor(totalSec / 3600);
const m = Math.floor((totalSec % 3600) / 60);
const s = totalSec % 60;
if (h > 0) return `${h}h ${m}m`;
if (m > 0) return `${m}m ${s}s`;
return `${s}s`;
}

function renderIncidentsHtml(rows, key, limit) {
const heading = key
? `Last ${limit} staleness incidents for <code>${escapeHtml(key)}</code>`
: `Last ${limit} staleness incidents per key`;
const body = rows.length === 0
? `<p class="empty">No incidents recorded yet.</p>`
: `<table>
<thead><tr>
<th>Key</th><th>Started</th><th>Resolved</th><th>Duration</th><th>Summary</th>
</tr></thead>
<tbody>
${rows.map(r => `<tr>
<td><code>${escapeHtml(r.key)}</code></td>
<td>${escapeHtml(r.started_at || '')}</td>
<td>${r.resolved_at ? escapeHtml(r.resolved_at) : '<span class="open">ongoing</span>'}</td>
<td>${escapeHtml(formatDurationMs(r.duration_ms))}</td>
<td><pre>${escapeHtml(JSON.stringify(r.summary || {}, null, 2))}</pre></td>
</tr>`).join('')}
</tbody>
</table>`;
return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Staleness Incidents</title>
<meta name="robots" content="noindex,nofollow">
<style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#0f172a;background:#f8fafc;}
h1{font-size:18px;margin:0 0 16px;}
table{border-collapse:collapse;width:100%;background:#fff;font-size:13px;}
th,td{border:1px solid #e5e7eb;padding:8px 10px;vertical-align:top;text-align:left;}
th{background:#f1f5f9;}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
pre{margin:0;font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:480px;}
.open{color:#b45309;font-weight:600;}
.empty{color:#64748b;}
.meta{color:#64748b;font-size:12px;margin-bottom:12px;}
</style></head>
<body>
<h1>${heading}</h1>
<p class="meta">${rows.length} row(s). Append <code>&amp;format=json</code> for JSON, <code>&amp;incident_key=sentiment_alert</code> to filter.</p>
${body}
</body></html>`;
}

// ============================================
// CLEANUP RUN HISTORY
// ============================================
// Append-only log of retention sweeps in the `cleanup_runs` table. Each
// cleanup function writes one row per invocation (success or failure)
// so the team can confirm via /cleanup-runs that the 3-hourly sweeps
// are happening and roughly how many rows they're reclaiming. Helpers
// here are best-effort: a failure to write history must NEVER prevent
// the sweep itself from making progress. See cf/cleanup_runs.sql for
// the table DDL.

async function recordCleanupRun(env, run) {
try {
const body = {
table_name: run.table_name,
ran_at: new Date().toISOString(),
deleted_count: run.deleted_count != null ? run.deleted_count : null,
cutoff: run.cutoff || null,
retention_days: run.retention_days != null ? run.retention_days : null,
ok: run.ok !== false,
error: run.error || null,
extra: run.extra || {}
};
const r = await fetch(`${env.SUPABASE_URL}/rest/v1/cleanup_runs`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'return=minimal'
},
body: JSON.stringify(body)
});
if (!r.ok) console.log('recordCleanupRun non-ok:', r.status, (await r.text()).slice(0, 200));
} catch (e) {
console.log('recordCleanupRun error:', e.message);
}
}

async function listRecentCleanupRuns(env, tableName, limit) {
const params = new URLSearchParams();
params.set('select', 'id,table_name,ran_at,deleted_count,cutoff,retention_days,ok,error,extra');
params.set('order', 'ran_at.desc');
params.set('limit', String(limit));
if (tableName) params.set('table_name', `eq.${tableName}`);
try {
const r = await fetch(
`${env.SUPABASE_URL}/rest/v1/cleanup_runs?${params.toString()}`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
);
if (!r.ok) {
console.log('listRecentCleanupRuns non-ok:', r.status);
return [];
}
const rows = await r.json();
return Array.isArray(rows) ? rows : [];
} catch (e) {
console.log('listRecentCleanupRuns error:', e.message);
return [];
}
}

async function handleCleanupRunsView(url, env) {
const tableName = url.searchParams.get('table') || '';
const limitRaw = parseInt(url.searchParams.get('limit'), 10);
const limit = Math.min(Math.max(isFinite(limitRaw) ? limitRaw : 20, 1), 200);
const format = (url.searchParams.get('format') || 'html').toLowerCase();

let rows;
if (tableName) {
rows = await listRecentCleanupRuns(env, tableName, limit);
} else {
// "Last N per table": pull a generous window then group/cap per table
// in JS so we don't need a window function or a SQL view.
const all = await listRecentCleanupRuns(env, null, Math.max(limit * 4, 200));
const perTable = new Map();
for (const r of all) {
const arr = perTable.get(r.table_name) || [];
if (arr.length < limit) arr.push(r);
perTable.set(r.table_name, arr);
}
rows = [];
for (const arr of perTable.values()) rows.push(...arr);
rows.sort((a, b) => Date.parse(b.ran_at) - Date.parse(a.ran_at));
}

if (format === 'json') {
return new Response(JSON.stringify({ table: tableName || null, limit, count: rows.length, runs: rows }, null, 2), {
status: 200, headers: { 'Content-Type': 'application/json' }
});
}

return new Response(renderCleanupRunsHtml(rows, tableName, limit), {
status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
});
}

function renderCleanupRunsHtml(rows, tableName, limit) {
const heading = tableName
? `Last ${limit} cleanup runs for <code>${escapeHtml(tableName)}</code>`
: `Last ${limit} cleanup runs per table`;
const body = rows.length === 0
? `<p class="empty">No cleanup runs recorded yet.</p>`
: `<table>
<thead><tr>
<th>Table</th><th>Ran at</th><th>Deleted</th><th>Retention</th><th>Cutoff</th><th>Status</th><th>Extra</th>
</tr></thead>
<tbody>
${rows.map(r => `<tr class="${r.ok ? '' : 'failed'}">
<td><code>${escapeHtml(r.table_name || '')}</code></td>
<td>${escapeHtml(r.ran_at || '')}</td>
<td>${r.deleted_count == null ? '—' : escapeHtml(String(r.deleted_count))}</td>
<td>${r.retention_days == null ? '—' : escapeHtml(String(r.retention_days)) + 'd'}</td>
<td>${escapeHtml(r.cutoff || '')}</td>
<td>${r.ok ? '<span class="ok">ok</span>' : `<span class="bad">failed</span><br><small>${escapeHtml((r.error || '').slice(0, 200))}</small>`}</td>
<td><pre>${escapeHtml(JSON.stringify(r.extra || {}, null, 2))}</pre></td>
</tr>`).join('')}
</tbody>
</table>`;
return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Cleanup Runs</title>
<meta name="robots" content="noindex,nofollow">
<style>
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#0f172a;background:#f8fafc;}
h1{font-size:18px;margin:0 0 16px;}
table{border-collapse:collapse;width:100%;background:#fff;font-size:13px;}
th,td{border:1px solid #e5e7eb;padding:8px 10px;vertical-align:top;text-align:left;}
th{background:#f1f5f9;}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
pre{margin:0;font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:360px;}
.ok{color:#15803d;font-weight:600;}
.bad{color:#b91c1c;font-weight:600;}
.failed{background:#fef2f2;}
.empty{color:#64748b;}
.meta{color:#64748b;font-size:12px;margin-bottom:12px;}
</style></head>
<body>
<h1>${heading}</h1>
<p class="meta">${rows.length} row(s). Append <code>&amp;format=json</code> for JSON, <code>&amp;table=news</code> to filter (also <code>sentiment</code>, <code>system_state</code>, <code>cleanup_runs</code>).</p>
${body}
</body></html>`;
}

// ============================================
// SYSTEM_STATE RETENTION / CLEANUP
// ============================================
// `system_state` is upserted on every cron tick (one row per monitored
// `key`, e.g. `sentiment_alert`). Over months a key that is no longer
// monitored leaves a stale row behind, cluttering the Supabase table
// view. This sweep deletes rows whose `updated_at` is older than the
// retention window AND whose alert is NOT currently active (i.e.
// `value->>active_for_id` IS NULL — see checkSentimentFreshness for
// the schema). Active-alert rows are always preserved so we never
// resurrect an already-fired alert by losing its dedupe state.
//
// Retention window: SYSTEM_STATE_RETENTION_DAYS env var, default 30 days.
// Triggered by the 3-hourly cron tick and exposed manually at
// /cleanup-system-state?key=... for ops.
const DEFAULT_SYSTEM_STATE_RETENTION_DAYS = 30;

// Parse the row count from a PostgREST DELETE response that used
// `Prefer: count=exact`. The header looks like "Content-Range: 0-41/42"
// or "*/0" when nothing matched. Returns null if the count cannot be
// determined so callers can distinguish "0 deleted" from "unknown".
function parseDeletedCount(resp) {
const cr = resp.headers && resp.headers.get && resp.headers.get('Content-Range');
if (!cr) return null;
const slash = cr.lastIndexOf('/');
if (slash < 0) return null;
const n = parseInt(cr.slice(slash + 1), 10);
return isNaN(n) ? null : n;
}

async function cleanupSystemState(env) {
const days = parseInt(env.SYSTEM_STATE_RETENTION_DAYS, 10) || DEFAULT_SYSTEM_STATE_RETENTION_DAYS;
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
try {
const url = `${env.SUPABASE_URL}/rest/v1/system_state`
+ `?updated_at=lt.${encodeURIComponent(cutoff)}`
+ `&value->>active_for_id=is.null`;
const r = await fetch(url, {
method: 'DELETE',
headers: {
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'return=minimal,count=exact'
},
signal: AbortSignal.timeout(25000)
});
if (!r.ok) {
const errText = await r.text();
console.log('cleanupSystemState non-ok:', r.status, errText);
await recordCleanupRun(env, {
table_name: 'system_state', ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 500)}`, cutoff, retention_days: days
});
return { ok: false, status: r.status, error: errText, cutoff, retention_days: days };
}
const count = parseDeletedCount(r);
console.log(`cleanupSystemState: deleted ${count} row(s) older than ${cutoff} (retention=${days}d)`);
await recordCleanupRun(env, {
table_name: 'system_state', ok: true, deleted_count: count, cutoff, retention_days: days
});
return { ok: true, deleted: count, cutoff, retention_days: days };
} catch (e) {
console.log('cleanupSystemState error:', e.message);
await recordCleanupRun(env, {
table_name: 'system_state', ok: false, error: e.message, cutoff, retention_days: days
});
return { ok: false, error: e.message, cutoff, retention_days: days };
}
}

// ============================================
// NEWS / SENTIMENT RETENTION SWEEP
// ============================================
// `news` and `sentiment` are append-only tables that grow with every
// 3-hourly cron tick (~8x/day). Without a sweep they accumulate
// indefinitely and become the dominant cost/clutter in Supabase
// (system_state is tiny by comparison — see cleanupSystemState above).
//
// These sweeps run alongside cleanupSystemState on the 3-hourly tick
// and are also exposed at /cleanup-news and /cleanup-sentiment for
// manual ops.
//
// Retention windows (env-configurable):
//   NEWS_RETENTION_DAYS       default 30  — last ~30d of headlines
//   SENTIMENT_RETENTION_DAYS  default 90  — last ~90d of scores
// Defaults are intentionally conservative: the dashboard only renders
// the most recent rows, but staleness incidents (see
// staleness_incidents.summary.sentiment_id) reference sentiment ids
// that may be days old. Anything currently referenced by an *active*
// staleness incident is preserved regardless of age.
const DEFAULT_NEWS_RETENTION_DAYS = 30;
const DEFAULT_SENTIMENT_RETENTION_DAYS = 90;

// Returns the set of sentiment row ids that an active staleness
// incident currently depends on. The source of truth is
// `system_state.value.active_for_id` (the dedupe key written by
// checkSentimentFreshness), NOT the append-only `staleness_incidents`
// history table — system_state is what would resurrect a fired alert
// if the referenced sentiment row were deleted.
async function getActiveIncidentSentimentIds(env) {
try {
const r = await fetch(
`${env.SUPABASE_URL}/rest/v1/system_state`
+ `?select=value&value->>active_for_id=not.is.null`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
);
if (!r.ok) {
console.log('getActiveIncidentSentimentIds non-ok:', r.status);
return [];
}
const rows = await r.json();
const ids = [];
for (const row of (Array.isArray(rows) ? rows : [])) {
const id = row && row.value && row.value.active_for_id;
if (id !== null && id !== undefined && id !== '') ids.push(id);
}
return ids;
} catch (e) {
console.log('getActiveIncidentSentimentIds error:', e.message);
return [];
}
}

async function cleanupNews(env) {
const days = parseInt(env.NEWS_RETENTION_DAYS, 10) || DEFAULT_NEWS_RETENTION_DAYS;
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
try {
// `news` rows are not referenced by any incident today, but if that
// ever changes the same active-id guard used for sentiment should be
// added here. For now: pure time-based sweep on created_at.
const url = `${env.SUPABASE_URL}/rest/v1/news`
+ `?created_at=lt.${encodeURIComponent(cutoff)}`;
// Use return=minimal so a large sweep doesn't ship every deleted
// row back to the worker; PostgREST still reports the row count
// in the Content-Range header (e.g. "0-41/42").
const r = await fetch(url, {
method: 'DELETE',
headers: {
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'return=minimal,count=exact'
},
signal: AbortSignal.timeout(25000)
});
if (!r.ok) {
const errText = await r.text();
console.log('cleanupNews non-ok:', r.status, errText);
await recordCleanupRun(env, {
table_name: 'news', ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 500)}`, cutoff, retention_days: days
});
return { ok: false, status: r.status, error: errText, cutoff, retention_days: days };
}
const count = parseDeletedCount(r);
console.log(`cleanupNews: deleted ${count} row(s) older than ${cutoff} (retention=${days}d)`);
await recordCleanupRun(env, {
table_name: 'news', ok: true, deleted_count: count, cutoff, retention_days: days
});
return { ok: true, deleted: count, cutoff, retention_days: days };
} catch (e) {
console.log('cleanupNews error:', e.message);
await recordCleanupRun(env, {
table_name: 'news', ok: false, error: e.message, cutoff, retention_days: days
});
return { ok: false, error: e.message, cutoff, retention_days: days };
}
}

// ============================================
// CLEANUP_RUNS SELF-RETENTION
// ============================================
// `cleanup_runs` is the append-only history written by recordCleanupRun
// — every sweep above writes one row, so it grows ~24 rows/day forever
// (3 tables x 8 sweeps/day = ~9k rows/year). Small, but unbounded, and
// the same anti-pattern that originally motivated the other sweeps.
// This function prunes the history itself on the same 3-hourly tick
// and records its own run row (no special-casing — it shows up in
// /cleanup-runs alongside the others).
//
// Retention window: CLEANUP_RUNS_RETENTION_DAYS env var, default 90 days.
// 90d is plenty to debug whether sweeps are actually running and to
// eyeball trends; nothing else references these rows.
const DEFAULT_CLEANUP_RUNS_RETENTION_DAYS = 90;

async function cleanupCleanupRuns(env) {
const days = parseInt(env.CLEANUP_RUNS_RETENTION_DAYS, 10) || DEFAULT_CLEANUP_RUNS_RETENTION_DAYS;
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
try {
const url = `${env.SUPABASE_URL}/rest/v1/cleanup_runs`
+ `?ran_at=lt.${encodeURIComponent(cutoff)}`;
const r = await fetch(url, {
method: 'DELETE',
headers: {
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'return=minimal,count=exact'
},
signal: AbortSignal.timeout(25000)
});
if (!r.ok) {
const errText = await r.text();
console.log('cleanupCleanupRuns non-ok:', r.status, errText);
await recordCleanupRun(env, {
table_name: 'cleanup_runs', ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 500)}`, cutoff, retention_days: days
});
return { ok: false, status: r.status, error: errText, cutoff, retention_days: days };
}
const count = parseDeletedCount(r);
console.log(`cleanupCleanupRuns: deleted ${count} row(s) older than ${cutoff} (retention=${days}d)`);
await recordCleanupRun(env, {
table_name: 'cleanup_runs', ok: true, deleted_count: count, cutoff, retention_days: days
});
return { ok: true, deleted: count, cutoff, retention_days: days };
} catch (e) {
console.log('cleanupCleanupRuns error:', e.message);
await recordCleanupRun(env, {
table_name: 'cleanup_runs', ok: false, error: e.message, cutoff, retention_days: days
});
return { ok: false, error: e.message, cutoff, retention_days: days };
}
}

async function cleanupSentiment(env) {
const days = parseInt(env.SENTIMENT_RETENTION_DAYS, 10) || DEFAULT_SENTIMENT_RETENTION_DAYS;
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
try {
const protectedIds = await getActiveIncidentSentimentIds(env);
let url = `${env.SUPABASE_URL}/rest/v1/sentiment`
+ `?created_at=lt.${encodeURIComponent(cutoff)}`;
if (protectedIds.length) {
// PostgREST `not.in.(...)` filter — quote each id defensively in
// case ids are ever non-numeric.
const list = protectedIds.map(id => `"${String(id).replace(/"/g, '\\"')}"`).join(',');
url += `&id=not.in.(${encodeURIComponent(list)})`;
}
const r = await fetch(url, {
method: 'DELETE',
headers: {
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'return=minimal,count=exact'
},
signal: AbortSignal.timeout(25000)
});
if (!r.ok) {
const errText = await r.text();
console.log('cleanupSentiment non-ok:', r.status, errText);
await recordCleanupRun(env, {
table_name: 'sentiment', ok: false, error: `HTTP ${r.status}: ${errText.slice(0, 500)}`,
cutoff, retention_days: days, extra: { protected_count: protectedIds.length }
});
return { ok: false, status: r.status, error: errText, cutoff, retention_days: days, protected_ids: protectedIds };
}
const count = parseDeletedCount(r);
console.log(`cleanupSentiment: deleted ${count} row(s) older than ${cutoff} (retention=${days}d, protected=${protectedIds.length})`);
await recordCleanupRun(env, {
table_name: 'sentiment', ok: true, deleted_count: count, cutoff, retention_days: days,
extra: { protected_count: protectedIds.length }
});
return { ok: true, deleted: count, cutoff, retention_days: days, protected_ids: protectedIds };
} catch (e) {
console.log('cleanupSentiment error:', e.message);
await recordCleanupRun(env, {
table_name: 'sentiment', ok: false, error: e.message, cutoff, retention_days: days
});
return { ok: false, error: e.message, cutoff, retention_days: days };
}
}

async function cleanupStepRuns(env) {
const days = parseInt(env.STEP_RUNS_RETENTION_DAYS, 10) || 30;
const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
try {
const r = await fetch(`${env.SUPABASE_URL}/rest/v1/step_runs?created_at=lt.${encodeURIComponent(cutoff)}`, {
method: 'DELETE',
headers: {
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'return=minimal,count=exact'
},
signal: AbortSignal.timeout(25000)
});
if (!r.ok) { console.log('cleanupStepRuns non-ok:', r.status); return; }
const count = parseDeletedCount(r);
console.log(`cleanupStepRuns: deleted ${count} row(s) older than ${cutoff}`);
} catch(e) {
console.log('cleanupStepRuns error:', e.message);
}
}

async function writeSystemState(env, key, value) {
try {
const r = await fetch(`${env.SUPABASE_URL}/rest/v1/system_state?on_conflict=key`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
apikey: env.SUPABASE_SERVICE_KEY,
Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
Prefer: 'resolution=merge-duplicates,return=minimal'
},
body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
signal: AbortSignal.timeout(25000)
});
if (!r.ok) console.log('writeSystemState non-ok:', r.status, await r.text());
} catch (e) {
console.log('writeSystemState error:', e.message);
}
}

// ============================================
// FETCH ALL NEWS — 12 SOURCES, PARALLEL FETCH
// ============================================
// =====================================================================
// WEEKLY PRO REPORT — published every Sunday 22:00 UTC, stored in Supabase
// =====================================================================
async function handleWeeklyReportsList(request, env) {
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
try {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/weekly_reports?select=week_end,week_start,generated_at&order=week_end.desc&limit=26`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  const rows = res.ok ? await res.json() : [];
  return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json', ...cors } });
} catch (e) {
  return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
}
}

async function handleWeeklyReport(request, env, ctx) {
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
const url = new URL(request.url);
const weekParam = url.searchParams.get('week'); // YYYY-MM-DD (the Sunday date)
try {
  // Load from Supabase — persistent, survives worker restarts
  let query = `${env.SUPABASE_URL}/rest/v1/weekly_reports?select=week_end,week_start,generated_at,report_json&order=week_end.desc&limit=1`;
  if (weekParam) query = `${env.SUPABASE_URL}/rest/v1/weekly_reports?select=week_end,week_start,generated_at,report_json&week_end=eq.${weekParam}&limit=1`;
  const res = await fetch(query, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  const rows = res.ok ? await res.json() : [];
  if (rows.length && rows[0].report_json && Object.keys(rows[0].report_json).length > 0) {
    const row = rows[0];
    const payload = { ...row.report_json, week_end: row.week_end, week_start: row.week_start, generated_at: row.generated_at };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...cors } });
  }
  // Fallback: build on demand (e.g. first ever load before Sunday cron runs)
  if (!weekParam) {
    const report = await buildWeeklyReport(env);
    if (ctx && ctx.waitUntil) ctx.waitUntil(saveWeeklyReport(report, env));
    return new Response(JSON.stringify(report), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', ...cors } });
  }
  return new Response(JSON.stringify({ error: 'Report not found for that week.' }), { status: 404, headers: { 'Content-Type': 'application/json', ...cors } });
} catch (e) {
  console.log('handleWeeklyReport error:', e.message);
  return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...cors } });
}
}

async function buildAndSaveWeeklyReport(env) {
  const report = await buildWeeklyReport(env);
  await saveWeeklyReport(report, env);
  console.log(`Weekly report saved: week_end=${report.week_end}`);
}

async function saveWeeklyReport(report, env) {
  const row = { week_end: report.week_end, week_start: report.week_start, report_json: report, generated_at: report.generated_at };
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/weekly_reports`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(row),
  });
  if (!r.ok) { const t = await r.text(); console.log('saveWeeklyReport error:', r.status, t.slice(0,200)); }
}

async function buildWeeklyReport(env) {
// When called from Sunday cron, "now" is Sunday night — report covers Mon-Sun.
// When called on-demand (fallback), covers the rolling last 7 days.
const now = new Date();
// Find the most recent Sunday as week_end
const dow = now.getUTCDay(); // 0=Sun
const daysToSunday = dow === 0 ? 0 : 7 - dow; // 0 if today is Sunday
const weekEnd = new Date(now); weekEnd.setUTCDate(now.getUTCDate() + daysToSunday); weekEnd.setUTCHours(22,0,0,0);
if (daysToSunday > 0) { weekEnd.setUTCDate(weekEnd.getUTCDate() - 7); } // use last Sunday if mid-week
const weekStart = new Date(weekEnd); weekStart.setUTCDate(weekEnd.getUTCDate() - 6); weekStart.setUTCHours(0,0,0,0);
const lastWeekStart = new Date(weekStart); lastWeekStart.setUTCDate(weekStart.getUTCDate() - 7);

// Pull 14 days of sentiment for delta + this-week trend
const sentRes = await fetch(
`${env.SUPABASE_URL}/rest/v1/sentiment?select=created_at,currency,score,bias,drivers&created_at=gte.${lastWeekStart.toISOString()}&order=created_at.asc&limit=4000`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
);
const sentData = await sentRes.json();

const newsRes = await fetch(
`${env.SUPABASE_URL}/rest/v1/news?select=title,source,created_at,impact&created_at=gte.${weekStart.toISOString()}&order=id.desc&limit=80`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
);
const newsData = await newsRes.json();

const currencies = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD'];
const weekStartTs = weekStart.getTime();
const perCurrency = {};
const flipsTimeline = [];

for (const ccy of currencies) {
const rows = (sentData || []).filter(r => r.currency === ccy);
const thisWeek = rows.filter(r => new Date(r.created_at).getTime() >= weekStartTs);
const lastWeek = rows.filter(r => new Date(r.created_at).getTime() < weekStartTs);

// Daily averages for sparkline (7 days Mon-Sun)
const days = [];
for (let d = 6; d >= 0; d--) {
const dayStart = new Date(weekEnd); dayStart.setUTCDate(weekEnd.getUTCDate() - d); dayStart.setUTCHours(0,0,0,0);
const dayEnd = new Date(dayStart); dayEnd.setUTCDate(dayStart.getUTCDate() + 1);
const dayRows = thisWeek.filter(r => {
const t = new Date(r.created_at).getTime();
return t >= dayStart.getTime() && t < dayEnd.getTime();
});
days.push(dayRows.length ? Math.round(dayRows.reduce((s,r)=>s+r.score,0)/dayRows.length) : null);
}

const thisAvg = thisWeek.length ? Math.round(thisWeek.reduce((s,r)=>s+r.score,0)/thisWeek.length) : 50;
const lastAvg = lastWeek.length ? Math.round(lastWeek.reduce((s,r)=>s+r.score,0)/lastWeek.length) : null;
const current = thisWeek.length ? thisWeek[thisWeek.length-1] : null;
const weekOpen = thisWeek.length ? thisWeek[0].score : null;

let flips = 0; let lastBias = null;
for (const r of thisWeek) {
if (lastBias && lastBias !== r.bias) {
flips++;
flipsTimeline.push({ ts: r.created_at, currency: ccy, from: lastBias, to: r.bias });
}
lastBias = r.bias;
}

const biasCounts = { Bullish: 0, Bearish: 0, Neutral: 0 };
for (const r of thisWeek) biasCounts[r.bias] = (biasCounts[r.bias] || 0) + 1;
const total = Math.max(thisWeek.length, 1);

// Last-week's final bias (for change-state column)
const lastWeekFinalBias = lastWeek.length ? lastWeek[lastWeek.length-1].bias : null;

perCurrency[ccy] = {
this_week_avg: thisAvg,
last_week_avg: lastAvg,
delta: lastAvg !== null ? thisAvg - lastAvg : null,
week_open_score: weekOpen,
week_change: weekOpen !== null && current ? current.score - weekOpen : 0,
current_score: current ? current.score : null,
current_bias: current ? current.bias : 'Neutral',
last_week_final_bias: lastWeekFinalBias,
current_drivers: current ? (current.drivers || []) : [],
sparkline: days,
bias_flips: flips,
pct_bullish: Math.round(100 * biasCounts.Bullish / total),
pct_bearish: Math.round(100 * biasCounts.Bearish / total),
pct_neutral: Math.round(100 * biasCounts.Neutral / total),
samples: thisWeek.length
};
}

const topGainer = currencies.map(c => ({ currency: c, change: perCurrency[c].week_change }))
.sort((a,b) => b.change - a.change)[0];
const topLoser = currencies.map(c => ({ currency: c, change: perCurrency[c].week_change }))
.sort((a,b) => a.change - b.change)[0];
const mostVolatile = currencies.map(c => ({ currency: c, flips: perCurrency[c].bias_flips }))
.sort((a,b) => b.flips - a.flips)[0];
const ranked = currencies.map(c => ({ currency: c, score: perCurrency[c].current_score ?? 50 }))
.sort((a,b) => b.score - a.score);
const strongest = ranked[0];
const weakest = ranked[ranked.length - 1];

// 8x8 cross-pair heatmap (B/Q score = 50 + (B-Q)/2)
const heatmap = {};
for (const B of currencies) for (const Q of currencies) {
if (B === Q) continue;
const bScore = perCurrency[B].current_score ?? 50;
const qScore = perCurrency[Q].current_score ?? 50;
heatmap[B+Q] = Math.max(0, Math.min(100, Math.round(50 + (bScore - qScore) / 2)));
}

// Trade setups from "interesting" pairs sorted by conviction
const interesting = ['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD','EURJPY','GBPJPY','EURGBP','AUDJPY','CADJPY','AUDNZD','EURCHF'];
const setups = interesting.map(p => {
const B = p.slice(0,3), Q = p.slice(3);
const score = heatmap[p];
return {
pair: p, B, Q, score,
conviction: Math.abs((score ?? 50) - 50),
direction: score > 55 ? 'Long' : score < 45 ? 'Short' : 'Neutral',
B_bias: perCurrency[B].current_bias,
Q_bias: perCurrency[Q].current_bias,
B_score: perCurrency[B].current_score,
Q_score: perCurrency[Q].current_score
};
}).filter(s => s.direction !== 'Neutral')
.sort((a,b) => b.conviction - a.conviction)
.slice(0, 5);

const sampleNews = (newsData || []).slice(0, 40).map(n => `- [${n.impact||''}][${n.source}] ${n.title}`).join('\n');

const ctxBlock = currencies.map(c => {
const p = perCurrency[c];
const arrow = p.delta === null ? '~' : p.delta > 2 ? '▲' : p.delta < -2 ? '▼' : '→';
const drivers = (p.current_drivers || []).slice(0,2).join('; ') || 'no data';
return `${c}: score=${p.current_score??'n/a'} bias=${p.current_bias} | wk avg=${p.this_week_avg} ${arrow} from ${p.last_week_avg??'n/a'} (delta ${p.delta??'n/a'}) | bull/neut/bear time: ${p.pct_bullish}%/${p.pct_neutral}%/${p.pct_bearish}% | ${p.bias_flips} flips | drivers: ${drivers}`;
}).join('\n');

const setupsBlock = setups.map(s => `${s.pair}: ${s.direction} (conviction ${s.conviction}/50) — ${s.B} score ${s.B_score} vs ${s.Q} score ${s.Q_score}`).join('\n');

const claudePrompt = `You are a senior FX strategist at a prime brokerage writing the FXNewsBias Pro Weekly Intelligence Brief for the week of ${weekStart.toISOString().slice(0,10)} to ${weekEnd.toISOString().slice(0,10)}.

SENTIMENT DATA (scores 0=extreme bearish, 50=neutral, 100=extreme bullish):
${ctxBlock}

WEEK MOVERS:
- Strongest: ${strongest.currency} (score ${strongest.score})
- Weakest: ${weakest.currency} (score ${weakest.score})
- Top gainer: ${topGainer.currency} (${topGainer.change >= 0 ? '+' : ''}${topGainer.change} pts vs week open)
- Top loser: ${topLoser.currency} (${topLoser.change} pts)
- Most volatile: ${mostVolatile.currency} (${mostVolatile.flips} bias flips)

HIGH-CONVICTION TRADE SETUPS:
${setupsBlock || 'No high-conviction setups this week.'}

THIS WEEK'S NEWS HEADLINES (impact tagged, newest first):
${sampleNews}

Write a professional JSON response. Be specific — reference actual scores, currencies, news items. No generic phrases. No "in conclusion". No "overall".

{
  "executive_summary": ["<bullet 1, max 28 words>", "<bullet 2, max 28 words>", "<bullet 3, max 28 words>"],

  "market_theme": {
    "title": "<4-7 word headline capturing the dominant theme e.g. 'Dollar Dominates on Fed Hawkishness' or 'Risk-Off Grips G10 as JPY Rallies'>",
    "description": "<2-3 sentences expanding on the theme. What drove it? What does it mean for traders?>"
  },

  "narrative": "<4 paragraphs separated by \\n\\n. Para 1: What happened — tie sentiment moves to specific headlines. Para 2: Deep dive — 2-3 most important currency moves and why. Para 3: Market structure now — what regime, what the heatmap implies, divergence vs convergence. Para 4: Setup for next week — what changes the picture, key risks, scenarios. Total 320-420 words. Trader-language, not academic.>",

  "top_stories": [
    {"headline": "<max 12 words>", "currency": "<3-letter>", "direction": "bullish|bearish|neutral", "analysis": "<max 28 words explaining market impact>"},
    {"headline": "...", "currency": "...", "direction": "...", "analysis": "..."},
    {"headline": "...", "currency": "...", "direction": "...", "analysis": "..."},
    {"headline": "...", "currency": "...", "direction": "...", "analysis": "..."},
    {"headline": "...", "currency": "...", "direction": "...", "analysis": "..."}
  ],

  "pair_analysis": [
    {"pair": "EUR/USD", "slug": "EURUSD", "direction": "Long|Short", "conviction": <1-5>, "reasoning": "<2 sentences specific to score data and news>"},
    {"pair": "...", "slug": "...", "direction": "...", "conviction": <1-5>, "reasoning": "..."},
    {"pair": "...", "slug": "...", "direction": "...", "conviction": <1-5>, "reasoning": "..."},
    {"pair": "...", "slug": "...", "direction": "...", "conviction": <1-5>, "reasoning": "..."},
    {"pair": "...", "slug": "...", "direction": "...", "conviction": <1-5>, "reasoning": "..."}
  ],

  "what_to_watch": "<Single paragraph 90-130 words. Forward-looking: specific events, sentiment levels to watch, scenarios that would change the picture. Be a strategist, not a reporter.>",

  "risk_radar": [
    {"risk": "<4-6 word label>", "severity": "High|Medium", "detail": "<one sentence specific to current market context>"},
    {"risk": "...", "severity": "...", "detail": "..."},
    {"risk": "...", "severity": "...", "detail": "..."}
  ],

  "key_events": [
    {"event": "<short name>", "currency": "<3-letter>", "day": "Mon|Tue|Wed|Thu|Fri", "impact": "High|Medium", "why": "<one sentence trader takeaway>"},
    ... (5-7 events total)
  ],

  "regime_warning": "<One sentence max 40 words — the single most important risk or watch-point for traders going into next week.>"
}

Return ONLY strict JSON. No markdown fences. No preamble.`;

let claudeOut = { executive_summary: [], market_theme: {}, narrative: '', top_stories: [], pair_analysis: [], what_to_watch: '', risk_radar: [], key_events: [], regime_warning: '' };
try {
const cRes = await fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, messages: [{ role: 'user', content: claudePrompt }] }),
signal: AbortSignal.timeout(25000)
});
const cData = await cRes.json();
const text = cData.content?.[0]?.text || '';
const m = text.match(/\{[\s\S]*\}/);
if (m) claudeOut = { ...claudeOut, ...JSON.parse(m[0]) };
} catch (e) {
console.log('Sonnet weekly narrative failed:', e.message);
claudeOut.narrative = 'The weekly narrative is being generated. Please check back shortly.';
}

return {
week_start: weekStart.toISOString().slice(0,10),
week_end: weekEnd.toISOString().slice(0,10),
generated_at: now.toISOString(),
per_currency: perCurrency,
movers: { strongest, weakest, top_gainer: topGainer, top_loser: topLoser, most_volatile: mostVolatile },
bias_flips_timeline: flipsTimeline.slice(-20).reverse(),
pair_heatmap: heatmap,
trade_setups: setups,
executive_summary: claudeOut.executive_summary || [],
market_theme: claudeOut.market_theme || {},
narrative: claudeOut.narrative || '',
top_stories: claudeOut.top_stories || [],
pair_analysis: claudeOut.pair_analysis || [],
what_to_watch: claudeOut.what_to_watch || '',
risk_radar: claudeOut.risk_radar || [],
key_events: claudeOut.key_events || [],
regime_warning: claudeOut.regime_warning || ''
};
}

async function fetchAllNews() {
// 16 feeds — full set restored on paid plan (1000 subrequests/invocation, no trimming needed).
// Sentiment now runs in its own isolated invocation (0 */3) with a fresh 1000-subrequest budget.
const PER_SOURCE_CAP = 15;
const TOTAL_CAP = 100;
const feeds = [
// Forex / FX-specific
{ url: 'https://www.fxstreet.com/rss/news', source: 'FXStreet' },
{ url: 'https://www.forexlive.com/feed/', source: 'ForexLive' },
{ url: 'https://www.actionforex.com/feed/', source: 'Action Forex' },
{ url: 'https://www.forexcrunch.com/feed/', source: 'Forex Crunch' },
{ url: 'https://www.fxdailyreport.com/feed/', source: 'FX Daily Report' },
{ url: 'https://www.financemagnates.com/feed/', source: 'Finance Magnates' },
{ url: 'https://www.leaprate.com/feed/', source: 'LeapRate' },
{ url: 'https://www.investing.com/rss/news_285.rss', source: 'Investing.com FX' },
{ url: 'https://www.nasdaq.com/feed/rssoutbound?category=currencies', source: 'Nasdaq Currencies' },
// Macro / financial press
{ url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC News' },
{ url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC' },
{ url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', source: 'CNBC Currencies' },
{ url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', source: 'CNBC Markets' },
{ url: 'https://www.marketwatch.com/rss/topstories', source: 'MarketWatch' },
{ url: 'https://feeds.a.dj.com/rss/RSSWSJD.xml', source: 'WSJ' },
{ url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance' },
];

// Fetch all feeds in parallel for speed
const results = await Promise.allSettled(
feeds.map(async (feed) => {
try {
const response = await fetch(feed.url, {
headers: { 'User-Agent': 'Mozilla/5.0 FXNewsBias/1.0' },
redirect: 'follow',
signal: AbortSignal.timeout(7000)
});
if (!response.ok) {
console.log(`Skipped ${feed.source}: HTTP ${response.status}`);
return [];
}
const text = await response.text();
const items = parseRSS(text, feed.source);
console.log(`${feed.source}: fetched ${items.length} items`);
return items.slice(0, PER_SOURCE_CAP);
} catch (error) {
console.log(`Failed ${feed.source}:`, error.message);
return [];
}
})
);

// Combine all successful results
const allNews = [];
results.forEach(r => {
if (r.status === 'fulfilled' && r.value.length > 0) {
allNews.push(...r.value);
}
});

// Within-batch dedupe by title to keep Claude's input clean
const seen = new Set();
const unique = [];
for (const n of allNews) {
const k = (n.title || '').toLowerCase().replace(/\s+/g,' ').trim();
if (k && !seen.has(k)) { seen.add(k); unique.push(n); }
}

console.log(`Total news collected: ${allNews.length} (unique: ${unique.length})`);
return unique.slice(0, TOTAL_CAP);
}

function parseRSS(xml, feedSource) {
const items = [];
const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
for (const match of itemMatches) {
const item = match[1];
const title = extractTag(item, 'title');
const link = extractTag(item, 'link');
if (title) {
items.push({ title: cleanText(title), url: link, source: feedSource });
}
}
return items;
}

function extractTag(xml, tag) {
const match = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'));
return match ? match[1].trim() : '';
}

function cleanText(text) {
return text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

async function analyzeSentiment(news, env) {
const headlines = news.map(n => `- ${n.title}`).join('\n');
const prompt = `You are a professional forex fundamental analyst. Analyze these forex news headlines and provide sentiment scores for each major currency.

NEWS HEADLINES:
${headlines}

Analyze the impact on these 8 currencies: USD, EUR, GBP, JPY, AUD, CAD, CHF, NZD

For each currency provide:
1. Score: 0-100 (0=extremely bearish, 50=neutral, 100=extremely bullish)
2. Bias: "Bullish", "Bearish", or "Neutral"
3. Top 3 key drivers from the news

Scoring guide:
- 0-20: extremely bearish | 21-40: bearish | 41-59: neutral | 60-79: bullish | 80-100: extremely bullish
- Score each currency independently based ONLY on what the headlines say. Do not anchor to the example values below — they are for FORMAT ONLY.
- If a currency is barely mentioned in the news, score it 50 (neutral) with drivers like "No fresh catalysts in current headlines".
- Drivers must be SPECIFIC to the headlines provided, not generic statements.

Respond ONLY in this exact JSON format (values shown are placeholders, replace with your actual analysis):
{
"USD": {"score": 50, "bias": "Neutral", "drivers": ["<driver from headlines>", "<driver from headlines>", "<driver from headlines>"]},
"EUR": {"score": 50, "bias": "Neutral", "drivers": ["<driver from headlines>", "<driver from headlines>", "<driver from headlines>"]},
"GBP": {"score": 50, "bias": "Neutral", "drivers": ["<driver from headlines>", "<driver from headlines>", "<driver from headlines>"]},
"JPY": {"score": 50, "bias": "Neutral", "drivers": ["<driver from headlines>", "<driver from headlines>", "<driver from headlines>"]},
"AUD": {"score": 50, "bias": "Neutral", "drivers": ["<driver from headlines>", "<driver from headlines>", "<driver from headlines>"]},
"CAD": {"score": 50, "bias": "Neutral", "drivers": ["<driver from headlines>", "<driver from headlines>", "<driver from headlines>"]},
"CHF": {"score": 50, "bias": "Neutral", "drivers": ["<driver from headlines>", "<driver from headlines>", "<driver from headlines>"]},
"NZD": {"score": 50, "bias": "Neutral", "drivers": ["<driver from headlines>", "<driver from headlines>", "<driver from headlines>"]}
}`;

// Inner retry loop — 3 attempts, 5s fixed wait. Outer withRetry in
// runSentimentAnalysis adds another 3-attempt layer at the cycle level.
let lastErr = null;
for (let attempt = 1; attempt <= 3; attempt++) {
if (attempt > 1) await new Promise(r => setTimeout(r, 5000));
try {
const response = await fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'x-api-key': env.CLAUDE_API_KEY,
'anthropic-version': '2023-06-01'
},
body: JSON.stringify({
model: 'claude-haiku-4-5-20251001',
max_tokens: 2500,
messages: [{ role: 'user', content: prompt }]
}),
signal: AbortSignal.timeout(25000)
});
if (!response.ok) {
const body = await response.text().catch(() => '');
throw new Error(`Anthropic HTTP ${response.status}: ${body.slice(0, 200)}`);
}
const data = await response.json();
if (!data || !Array.isArray(data.content) || !data.content[0] || typeof data.content[0].text !== 'string') {
throw new Error(`Anthropic malformed response: ${JSON.stringify(data).slice(0, 200)}`);
}
// Anthropic surfaces token-limit truncation explicitly; bail early so the
// retry loop kicks in instead of us trying to parse a half-written JSON.
if (data.stop_reason && data.stop_reason !== 'end_turn') {
throw new Error(`Anthropic stop_reason=${data.stop_reason} (response truncated; likely max_tokens too low)`);
}
const text = data.content[0].text;
const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) throw new Error('No JSON in Claude response');
const parsed = JSON.parse(jsonMatch[0]);
// Validate all 8 currencies present with score/bias/drivers. Without this
// guard, partial responses (3-6 of 8) silently persisted to Supabase, leaving
// NZD/CHF stale for hours and tripping the staleness self-heal repeatedly.
const REQUIRED = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD'];
const missing = REQUIRED.filter(c => {
const v = parsed[c];
return !v || typeof v.score !== 'number' || !v.bias || !Array.isArray(v.drivers) || v.drivers.length < 1;
});
if (missing.length) {
throw new Error(`Sentiment response missing/malformed currencies: ${missing.join(',')} (got keys: ${Object.keys(parsed).join(',')})`);
}
return parsed;
} catch (e) {
lastErr = e;
console.log(`analyzeSentiment attempt ${attempt}/3 failed: ${e.message}`);
}
}
throw new Error(`analyzeSentiment failed after 3 attempts: ${lastErr && lastErr.message}`);
}

async function saveSentiment(sentiment, env) {
// Batched insert: one POST with an array body instead of N POSTs in a loop.
// Cloudflare Workers cap at ~50 subrequests per scheduled invocation; the
// 3-hourly tick was burning that budget on RSS+prices+8 sentiment writes,
// then hitting "Too many subrequests" on currencies #5-8 and silently
// dropping CHF/NZD/AUD/CAD. One POST = one subrequest, no risk of partial
// writes, and PostgREST inserts the whole array atomically.
const rows = Object.entries(sentiment).map(([currency, data]) => ({
currency,
score: data.score,
bias: data.bias,
drivers: data.drivers
}));
const r = await fetch(`${env.SUPABASE_URL}/rest/v1/sentiment`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'apikey': env.SUPABASE_SERVICE_KEY,
'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
'Prefer': 'return=minimal'
},
body: JSON.stringify(rows),
signal: AbortSignal.timeout(15000)
});
if (!r.ok) {
const body = await r.text().catch(() => '');
throw new Error(`saveSentiment HTTP ${r.status}: ${body.slice(0, 300)}`);
}
}

async function scoreForexRelevance(items, env) {
if (!items.length || !env.CLAUDE_API_KEY) return items;
const titles = items.map((item, i) => `${i}. ${item.title}`).join('\n');
const prompt = `Classify each headline as forex-relevant or not. Mark relevant=true ONLY if the headline directly affects currency/forex markets: central bank decisions, macro data (CPI/NFP/GDP/PMI/PCE), geopolitical events with safe-haven FX impact, or explicit currency/exchange rate moves. Mark relevant=false for general stocks, company earnings, tech, sports, real estate, or business news without a clear FX angle.\n\nHeadlines:\n${titles}\n\nRespond ONLY with a compact JSON array, no explanation: [{"i":0,"r":true},{"i":1,"r":false},...]`;
try {
const res = await fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
signal: AbortSignal.timeout(15000)
});
const data = await res.json();
const text = data?.content?.[0]?.text || '';
const match = text.match(/\[[\s\S]*?\]/);
if (!match) { console.log('scoreForexRelevance: no JSON in response, falling back to keyword filter'); return items; }
const scores = JSON.parse(match[0]);
const keep = new Set(scores.filter(s => s.r).map(s => Number(s.i)));
const out = items.filter((_, i) => keep.has(i));
console.log(`Claude relevance: ${out.length}/${items.length} kept`);
return out;
} catch(e) {
console.log('scoreForexRelevance failed, fallback to keyword filter:', e.message);
return items;
}
}

async function saveNews(news, env) {
const forexKeywords = [
// central banks + policy
'fed','federal reserve','fomc','powell','rate cut','rate hike','rate','interest','ecb','lagarde','boe','bailey','boj','ueda','snb','rba','boc','rbnz','pboc','central bank','jackson hole','beige book','dot plot','quantitative','qt','balance sheet','hawkish','dovish',
// macro data
'nfp','non-farm','payroll','inflation','cpi','ppi','pce','gdp','recession','jobless','unemployment','employment','pmi','retail sales','trade balance','consumer confidence','ism','adp',
// fiscal / geopolitics that drive risk
'tariff','trade war','sanctions','geopolitical','war','conflict','iran','israel','russia','ukraine','china','japan','germany','trump','biden','election','debt ceiling','government shutdown','budget',
// energy + commodities
'opec','oil','crude','wti','brent','natural gas','gold','bullion','silver',
// FX-direct vocabulary
'dollar','dxy','euro','sterling','pound','yen','yuan','renminbi','franc','aussie','kiwi','loonie','currency','currencies','forex','fx','exchange rate','intervention','carry trade',
// rates / bonds
'treasury','bond yield','yields','spread','jgb','bund','gilt',
// risk regime
'risk-on','risk-off','safe haven','flight to quality',
// 3-letter codes + gold ticker
'xau','usd','eur','gbp','jpy','chf','aud','cad','nzd','cny'
];
const forexRegex = new RegExp('\\b(' + forexKeywords.join('|') + ')\\b', 'i');
const currencyMap = [
['USD',['usd','dollar','fed','federal reserve','nfp','non-farm','treasury','jobless','ppi','cpi','powell','fomc']],
['EUR',['eur','euro','ecb','lagarde','eurozone']],
['GBP',['gbp','pound','sterling','boe','bank of england']],
['JPY',['jpy','yen','boj','bank of japan']],
['CHF',['chf','franc','snb']],
['AUD',['aud','aussie','rba','australia']],
['CAD',['cad','loonie','boc','canada']],
['NZD',['nzd','kiwi','rbnz','new zealand']],
['XAU',['xau','gold','bullion']]
];
const ccyRegexes = currencyMap.map(([code, kws]) => [code, new RegExp('\\b(' + kws.join('|') + ')\\b','i')]);
const filteredNews = news.filter(item => forexRegex.test(item.title || ''));
console.log(`Keyword pre-filter: ${filteredNews.length}/${news.length}`);
const claudeFiltered = await scoreForexRelevance(filteredNews, env);

// Subrequest budget fix: drop the dedup fetch and the per-item POST loop.
// Previously this was 1 GET + up to 20 POSTs = up to 21 subrequests, which
// (combined with prices, RSS, and sentiment writes) blew Cloudflare's
// ~50/invocation cap and caused saveSentiment/saveNews to error out
// mid-loop. We now do dedup at the database via on_conflict + ignore
// duplicates, and insert all rows in a single batched POST.
const highKeywords = [
'fed', 'federal reserve', 'rate hike', 'rate cut', 'interest rate',
'ecb', 'boe', 'boj', 'central bank', 'nfp', 'non-farm payroll',
'inflation', 'cpi', 'gdp', 'recession', 'war', 'invasion',
'sanctions', 'opec', 'oil surge', 'oil crash', 'crisis',
'emergency', 'collapse', 'default', 'tariff', 'trade war'
];
const medKeywords = [
'pmi', 'unemployment', 'jobs', 'retail sales', 'trade balance',
'oil', 'gold', 'dollar', 'euro', 'sterling', 'yen',
'yuan', 'currency', 'forex', 'stocks', 'market', 'economy',
'economic', 'growth', 'manufacturing', 'housing', 'consumer',
'bank', 'policy', 'minister', 'government', 'budget', 'debt'
];
const rows = claudeFiltered.slice(0, 30).filter(item => item.url).map(item => {
const title = (item.title || '').toLowerCase();
let impact = 'Low';
if (highKeywords.some(kw => title.includes(kw))) impact = 'High';
else if (medKeywords.some(kw => title.includes(kw))) impact = 'Medium';
return {
title: item.title,
source: item.source,
url: item.url,
impact,
currencies_affected: ccyRegexes.filter(([,r]) => r.test(item.title)).map(([c]) => c)
};
});
if (!rows.length) { console.log('saveNews: nothing to insert'); return; }
// news_url_key unique constraint was added via RUN_THESE_3_MIGRATIONS.sql.
// Use on_conflict=url + ignore-duplicates so dedup is handled at DB level —
// no extra GET subrequest needed, and batch never fails on a duplicate URL.
console.log(`saveNews: inserting ${rows.length} rows (DB dedup via on_conflict)`);
const r = await fetch(`${env.SUPABASE_URL}/rest/v1/news?on_conflict=url`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'apikey': env.SUPABASE_SERVICE_KEY,
'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
'Prefer': 'resolution=ignore-duplicates,return=minimal'
},
body: JSON.stringify(rows),
signal: AbortSignal.timeout(15000)
});
if (!r.ok) {
const body = await r.text().catch(() => '');
console.log(`saveNews HTTP ${r.status}: ${body.slice(0, 300)}`);
}
}

async function sendTelegramAlert(env, sentiment) {
// HTML parse mode is far more forgiving than Markdown - only &, <, > need
// escaping inside text, and unbalanced tags don't blow up the whole message.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
try {
if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHANNEL_ID) {
console.log('Telegram: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID');
return { ok: false, reason: 'missing-credentials' };
}
let msg = '';
if (!sentiment) {
msg = '🚀 <b>FXNewsBias Alert System</b>\n\nAlert system is working correctly!\n\n🔗 <a href="https://fxnewsbias.com">View Dashboard</a>';
} else {
const currencies = Object.entries(sentiment);
msg = '📊 <b>FXNewsBias Sentiment Update</b>\n\n';
currencies.forEach(([currency, data]) => {
const emoji = data.bias === 'Bullish' ? '🟢' : data.bias === 'Bearish' ? '🔴' : '🟡';
msg += `${emoji} <b>${esc(currency)}</b> — ${esc(data.bias)} ${esc(data.score)}/100\n`;
});
const bullish = currencies.filter(([, d]) => d.bias === 'Bullish').length;
const bearish = currencies.filter(([, d]) => d.bias === 'Bearish').length;
msg += '\n';
if (bullish > bearish) msg += '🌍 <b>Market Mood: Risk-On</b> 🟢\n';
else if (bearish > bullish) msg += '🌍 <b>Market Mood: Risk-Off</b> 🔴\n';
else msg += '🌍 <b>Market Mood: Mixed</b> 🟡\n';
msg += '\n🔗 <a href="https://fxnewsbias.com">View Full Analysis</a>';
msg += '\n<i>Updated every 3 hours • FXNewsBias</i>';
}

const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
chat_id: env.TELEGRAM_CHANNEL_ID,
text: msg,
parse_mode: 'HTML',
disable_web_page_preview: false
}),
signal: AbortSignal.timeout(25000)
});
const body = await r.text();
if (!r.ok) {
console.log('Telegram API error:', r.status, body.slice(0, 500));
return { ok: false, status: r.status, body: body.slice(0, 500) };
}
console.log('Telegram alert sent OK');
return { ok: true, status: r.status };
} catch(e) {
console.log('Telegram error:', e.message);
return { ok: false, reason: 'exception', message: e.message };
}
}

async function updatePrices(env) {
const pairs = [
'EUR/USD', 'GBP/USD', 'USD/JPY',
'USD/CHF', 'AUD/USD', 'USD/CAD',
'NZD/USD', 'XAU/USD'
];

// TwelveData free tier = 8 credits/min. 7500ms gap (52.5s total) was
// safe vs the per-minute cap but exceeded Cloudflare's scheduled-event
// wall-clock budget — the worker was killed before reaching the batched
// UPSERT below, so prices stopped updating after 2026-05-14T06:15 UTC.
// 1500ms × 7 = ~10.5s total: still well under 8 calls / 60s, and
// comfortably inside the scheduled-event wall-clock window.
const THROTTLE_MS = 1500;
const collected = [];
for (let i = 0; i < pairs.length; i++) {
const pair = pairs[i];
try {
const response = await fetch(
`https://api.twelvedata.com/quote?symbol=${pair}&apikey=${env.TWELVE_DATA_KEY}`,
{ signal: AbortSignal.timeout(5000) }
);
const data = await response.json();
if (!data || !data.close) {
console.log(`No quote for ${pair}:`, JSON.stringify(data).slice(0,200));
} else {
collected.push({
pair,
price: parseFloat(data.close),
change_pct: data.percent_change != null ? parseFloat(data.percent_change) : 0,
updated_at: new Date().toISOString()
});
}
} catch (error) {
console.log(`Failed to update ${pair}:`, error.message);
}
if (i < pairs.length - 1) await new Promise(r => setTimeout(r, THROTTLE_MS));
}

// prices.pair has a UNIQUE constraint (added in RUN_THESE_3_MIGRATIONS.sql),
// so a single UPSERT (merge-duplicates) is all we need — 1 subrequest,
// no gap window, no duplicate rows.
if (!collected.length) { console.log('updatePrices: no quotes collected'); return; }
const upsertResp = await fetch(`${env.SUPABASE_URL}/rest/v1/prices?on_conflict=pair`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'apikey': env.SUPABASE_SERVICE_KEY,
'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
'Prefer': 'resolution=merge-duplicates,return=minimal'
},
body: JSON.stringify(collected),
signal: AbortSignal.timeout(10000)
});
if (!upsertResp.ok) {
const body = await upsertResp.text().catch(() => '');
console.log(`updatePrices UPSERT HTTP ${upsertResp.status}: ${body.slice(0, 300)}`);
return;
}
console.log(`updatePrices: upserted ${collected.length}/${pairs.length} pairs`);
}
// ============================================
// CONTACT FORM HANDLER
// ============================================
const CONTACT_CORS = {
'Access-Control-Allow-Origin': 'https://fxnewsbias.com',
'Access-Control-Allow-Methods': 'POST, OPTIONS',
'Access-Control-Allow-Headers': 'Content-Type',
'Access-Control-Max-Age': '86400'
};

function contactJson(obj, status) {
return new Response(JSON.stringify(obj), {
status: status || 200,
headers: { 'Content-Type': 'application/json', ...CONTACT_CORS }
});
}

function escapeHtml(s) {
return String(s || '').replace(/[&<>"']/g, c => ({
'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
}

// Strip CR/LF and other control chars from header-bound fields (subject, name)
// to prevent header injection into the outbound email envelope.
function stripCtrl(s) {
return String(s || '').replace(/[\r\n\t\f\v\u0000-\u001F\u007F]/g, ' ').trim();
}

async function handleContactSubmit(request, env) {
if (request.method === 'OPTIONS') {
return new Response(null, { status: 204, headers: CONTACT_CORS });
}
if (request.method !== 'POST') {
return contactJson({ error: 'Method not allowed' }, 405);
}

let data;
try { data = await request.json(); }
catch (e) { return contactJson({ error: 'Invalid request body' }, 400); }

const name = stripCtrl(data.name).slice(0, 100);
const email = stripCtrl(data.email).slice(0, 200);
const subject = stripCtrl(data.subject || 'General Question').slice(0, 100);
const message = String(data.message || '').trim().slice(0, 5000);
const honeypot = String(data.website || '').trim();
const turnstileToken = String(data.turnstileToken || '').trim();

// Honeypot: real users leave this blank; bots fill it. Pretend success so bots don't retry.
if (honeypot) {
console.log('Contact form: honeypot triggered, silently dropping');
return contactJson({ success: true });
}

if (!name || !email || !message) {
return contactJson({ error: 'Name, email and message are required' }, 400);
}
if (message.length < 10) {
return contactJson({ error: 'Message must be at least 10 characters' }, 400);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
return contactJson({ error: 'Invalid email address' }, 400);
}

// Cloudflare Turnstile verification - blocks bots and abuse.
if (!env.TURNSTILE_SECRET) {
console.log('Contact form: TURNSTILE_SECRET not configured');
return contactJson({ error: 'Security check not configured' }, 500);
}
if (!turnstileToken) {
return contactJson({ error: 'Security check failed. Please refresh and try again.' }, 400);
}
try {
const tsForm = new FormData();
tsForm.append('secret', env.TURNSTILE_SECRET);
tsForm.append('response', turnstileToken);
const ip = request.headers.get('CF-Connecting-IP');
if (ip) tsForm.append('remoteip', ip);
const tsResp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
method: 'POST', body: tsForm
});
const tsJson = await tsResp.json();
if (!tsJson.success) {
console.log('Turnstile rejected:', JSON.stringify(tsJson['error-codes'] || []));
return contactJson({ error: 'Security check failed. Please refresh and try again.' }, 403);
}
} catch (e) {
console.log('Turnstile verify error:', e.message);
return contactJson({ error: 'Security check unavailable. Please try again later.' }, 502);
}

// Subject allowlist (must match the <select> in contact.html). Anything else falls back.
const ALLOWED_SUBJECTS = new Set([
'General Question', 'Bug Report', 'Feature Request',
'Partnership Inquiry', 'Advertising Inquiry', 'Data or API Access',
'Community / Moderation', 'Privacy or Legal', 'Other'
]);
const safeSubject = ALLOWED_SUBJECTS.has(subject) ? subject : 'General Question';

if (!env.RESEND_API_KEY) {
console.log('Contact form: RESEND_API_KEY not configured');
return contactJson({ error: 'Email service not configured' }, 500);
}

const toEmail = env.CONTACT_TO_EMAIL || 'dineshsanther123gf@gmail.com';
const fromEmail = env.CONTACT_FROM_EMAIL || 'noreply@fxnewsbias.com';
const fromName = 'FXNewsBias Contact';

const html = `
<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#0f172a;border-bottom:2px solid #2563eb;padding-bottom:10px;">New contact form submission</h2>
<table style="width:100%;border-collapse:collapse;margin:20px 0;">
<tr><td style="padding:8px 0;color:#6b7280;width:120px;">Category:</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(safeSubject)}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280;">Name:</td><td style="padding:8px 0;">${escapeHtml(name)}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280;">Email:</td><td style="padding:8px 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
</table>
<div style="background:#f8f9fa;border-left:4px solid #2563eb;padding:16px;border-radius:4px;white-space:pre-wrap;">${escapeHtml(message)}</div>
<p style="color:#9ca3af;font-size:12px;margin-top:24px;">Sent via fxnewsbias.com/contact - Reply directly to this email to respond to the sender.</p>
</div>
`;

const text = `New contact form submission

Category: ${safeSubject}
Name: ${name}
Email: ${email}

Message:
${message}

---
Sent via fxnewsbias.com/contact
Reply directly to this email to respond to the sender.`;

try {
const resp = await fetch('https://api.resend.com/emails', {
method: 'POST',
headers: {
'Authorization': `Bearer ${env.RESEND_API_KEY}`,
'Content-Type': 'application/json'
},
body: JSON.stringify({
from: `${fromName} <${fromEmail}>`,
to: [toEmail],
reply_to: email,
subject: `[${safeSubject}] ${name}`,
html,
text
})
});

if (!resp.ok) {
const errText = await resp.text();
console.log('Resend API error:', resp.status, errText);
return contactJson({ error: 'Failed to send message. Please try again later.' }, 502);
}

console.log(`Contact form: sent ${safeSubject} from ${email}`);
return contactJson({ success: true });
} catch (e) {
console.log('Contact form error:', e.message);
return contactJson({ error: 'Failed to send message. Please try again later.' }, 500);
}
}

// ============================================================
// DAILY INSIGHT GENERATOR
// ============================================================
// Runs daily at 06:00 UTC (cron '0 6 * * *') — before London open.
// Pulls sentiment + news from Supabase, generates an SEO-friendly
// ~600-word HTML article, commits it to GitHub via Tree API. Cloudflare
// Pages auto-deploys within ~60s.
//
// Required env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  (already set)
//   GITHUB_TOKEN                         (PAT with repo:contents write)
//   GITHUB_OWNER  (default 'EARNOVAGAMING')
//   GITHUB_REPO   (default 'fxnewsbias')
//   GITHUB_BRANCH (default 'main')
//   INSIGHT_ALERT_EMAIL_TO  (failure alerts, falls back to ALERT_EMAIL_TO)
//   RESEND_API_KEY  (already set)
// ============================================================

const _INS_SITE = 'https://fxnewsbias.com';
const _INS_CCY_NAMES = {
  USD: 'US Dollar', EUR: 'Euro', GBP: 'British Pound', JPY: 'Japanese Yen',
  AUD: 'Australian Dollar', CAD: 'Canadian Dollar', CHF: 'Swiss Franc', NZD: 'New Zealand Dollar'
};
const _INS_CCY_ORDER = ['USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD'];

function _insSafeUrl(u) {
  const s = String(u||'').trim();
  return /^https?:\/\//i.test(s) ? s : '#';
}
function _insEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function _insSbFetch(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }
  });
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status}`);
  return r.json();
}

async function _insGh(env, method, path, body) {
  const owner = env.GITHUB_OWNER || 'EARNOVAGAMING';
  const repo = env.GITHUB_REPO || 'fxnewsbias';
  const url = `https://api.github.com${path.replace('{owner}', owner).replace('{repo}', repo)}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'fxnb-insight-cron',
      Accept: 'application/vnd.github+json'
    }
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GitHub ${method} ${path}: ${r.status} ${txt.slice(0, 300)}`);
  }
  return r.json();
}

function _insBiasColor(b) { return b === 'Bullish' ? '#10b981' : b === 'Bearish' ? '#ef4444' : '#94a3b8'; }
function _insBiasArrow(b) { return b === 'Bullish' ? '▲' : b === 'Bearish' ? '▼' : '—'; }

// Session metadata used to label each daily insight (3x/day publishing cadence).
// Keys match SESSION_BY_CRON values in the scheduled() handler.
const _INS_SESSIONS = {
  asean:   { label: 'Asia Session',     short: 'asia',    intro: 'Asia session is opening — here is the overnight forex sentiment picture as Tokyo, Singapore and Sydney desks come online.' },
  london:  { label: 'London Session',   short: 'london',  intro: 'London is opening — here is the forex sentiment setup heading into the European session.' },
  newyork: { label: 'New York Session', short: 'ny',      intro: 'New York is opening — here is the forex sentiment setup heading into the US session.' }
};

// Detect session from current UTC hour for on-demand runs (manual /api/run-insight calls).
function _insDetectSessionFromHour() {
  const h = new Date().getUTCHours();
  if (h < 6) return 'asean';
  if (h < 12) return 'london';
  return 'newyork';
}

function _insDetectAngle(sentiment) {
  const arr = Object.values(sentiment);
  arr.sort((a,b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
  const top = arr[0];
  const neutralCount = arr.filter(s => s.bias === 'Neutral').length;
  const isRiskOn = ['AUD','NZD'].some(c => sentiment[c]?.bias === 'Bullish') && ['JPY','CHF'].some(c => sentiment[c]?.bias === 'Bearish');
  const isRiskOff = ['JPY','CHF'].some(c => sentiment[c]?.bias === 'Bullish') && ['AUD','NZD'].some(c => sentiment[c]?.bias === 'Bearish');
  const dateLabel = new Date().toUTCString().split(' ').slice(0,4).join(' ');
  let category='Market Wrap';
  let headline, slug, summary;
  if (neutralCount >= 6) {
    headline = `Quiet Forex Session as Markets Await Fresh Catalysts — ${dateLabel}`;
    slug = `quiet-forex-session-markets-await-catalysts`;
    category='Market Wrap';
    summary = `Forex markets traded in tight ranges with most major currencies showing neutral bias as traders await fresh data and central bank guidance.`;
  } else if (top.score >= 65) {
    headline = `${_INS_CCY_NAMES[top.currency]} Strengthens as Bullish News Flow Builds — ${dateLabel}`;
    slug = `${top.currency.toLowerCase()}-strengthens-bullish-sentiment`;
    category=`${top.currency} Analysis`;
    summary = `${_INS_CCY_NAMES[top.currency]} (${top.currency}) leads forex sentiment today with a strong bullish reading. Here is what drove the move and what to watch next.`;
  } else if (top.score <= 35) {
    headline = `${_INS_CCY_NAMES[top.currency]} Slides as Bearish News Pressure Builds — ${dateLabel}`;
    slug = `${top.currency.toLowerCase()}-weakens-bearish-pressure`;
    category=`${top.currency} Analysis`;
    summary = `${_INS_CCY_NAMES[top.currency]} (${top.currency}) faces the strongest bearish news pressure across the majors today. Here is what triggered the move and where it goes from here.`;
  } else if (isRiskOn) {
    headline = `Risk-On Mood Lifts Commodity Currencies as Safe Havens Slip — ${dateLabel}`;
    slug = `risk-on-commodity-currencies-rise`;
    category='Risk Sentiment';
    summary = `Risk-on sentiment lifted commodity-linked currencies (AUD, NZD, CAD) while traditional safe havens (JPY, CHF) lost ground in today's forex session.`;
  } else if (isRiskOff) {
    headline = `Risk-Off Sweeps Forex as Safe Havens Strengthen — ${dateLabel}`;
    slug = `risk-off-safe-havens-strengthen`;
    category='Risk Sentiment';
    summary = `Risk-off flows dominated forex today as the Japanese Yen and Swiss Franc strengthened while higher-beta currencies came under pressure.`;
  } else {
    const movers = arr.slice(0,3).map(s => s.currency).join(', ');
    headline = `Mixed Forex Bias as ${movers} Lead Today's Sentiment Shifts — ${dateLabel}`;
    slug = `mixed-forex-bias-${movers.replace(/, /g,'-').toLowerCase()}-lead`;
    summary = `Mixed sentiment across the majors today with ${movers} showing the most pronounced bias shifts driven by overnight news flow.`;
  }
  return { headline, slug, summary, biggestMover: top, category };
}

const _INS_PAIR_MAP = {'USD-EUR':'EUR/USD','USD-GBP':'GBP/USD','USD-AUD':'AUD/USD','USD-NZD':'NZD/USD','USD-JPY':'USD/JPY','USD-CAD':'USD/CAD','USD-CHF':'USD/CHF','EUR-GBP':'EUR/GBP','EUR-JPY':'EUR/JPY','EUR-CHF':'EUR/CHF','EUR-AUD':'EUR/AUD','EUR-CAD':'EUR/CAD','EUR-NZD':'EUR/NZD','GBP-JPY':'GBP/JPY','GBP-CHF':'GBP/CHF','GBP-AUD':'GBP/AUD','GBP-CAD':'GBP/CAD','GBP-NZD':'GBP/NZD','AUD-JPY':'AUD/JPY','AUD-CHF':'AUD/CHF','AUD-CAD':'AUD/CAD','AUD-NZD':'AUD/NZD','CAD-JPY':'CAD/JPY','CAD-CHF':'CAD/CHF','NZD-JPY':'NZD/JPY','NZD-CHF':'NZD/CHF','NZD-CAD':'NZD/CAD','CHF-JPY':'CHF/JPY'};

function _insPairFor(a,b){if(a===b)return null;return _INS_PAIR_MAP[`${a}-${b}`]||_INS_PAIR_MAP[`${b}-${a}`]||`${a}/${b}`;}
function _insPairDir(strong,weak,pair){const base=pair.slice(0,3);if(base===strong)return 'higher';if(base===weak)return 'lower';return 'higher';}
function _insFmtTime(iso){try{const d=new Date(iso);return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} UTC`;}catch{return '';}}

// AI-powered narrative builder. Calls Claude Haiku to write each article section
// as genuine prose, then wraps the result in the same HTML structures used by
// the template fallback so _insRenderArticle stays unchanged.
async function _insBuildNarrativeAI(env, {sentiment, news, biggestMover, sessMeta, angle}) {
  const arr = Object.values(sentiment).sort((a,b)=>Math.abs(b.score-50)-Math.abs(a.score-50));
  const bulls = arr.filter(s=>s.bias==='Bullish').sort((a,b)=>b.score-a.score);
  const bears = arr.filter(s=>s.bias==='Bearish').sort((a,b)=>a.score-b.score);
  const strongest = bulls[0]; const weakest = bears[0];
  const watchPair = strongest && weakest && strongest.currency !== weakest.currency ? _insPairFor(strongest.currency, weakest.currency) : null;
  const moverName = _INS_CCY_NAMES[biggestMover.currency];
  const biasWord = biggestMover.bias.toLowerCase();
  const biasColorVal = _insBiasColor(biggestMover.bias);
  const nicknames = {USD:'the dollar or greenback',EUR:'the euro',GBP:'the pound or sterling',JPY:'the yen',AUD:'the Aussie',CAD:'the loonie',CHF:'the franc',NZD:'the kiwi'};
  const nick = nicknames[biggestMover.currency] || moverName;

  const sentSummary = arr.map(s=>`  ${s.currency} (${_INS_CCY_NAMES[s.currency]}): ${s.score}/100 — ${s.bias}${s.drivers&&s.drivers.length?' | drivers: '+s.drivers.slice(0,2).join('; '):''}`).join('\n');
  const topNews = news.slice(0,20).map((n,i)=>`  ${i+1}. [${n.impact||'Med'}] "${n.title}" — ${n.source} (affects: ${(n.currencies_affected||[]).join(',')||'general'})`).join('\n');
  const dateLabel = new Date().toUTCString().split(' ').slice(0,4).join(' ');

  const prompt = `You are a senior FX market analyst writing a session briefing for FXNewsBias.com, a real-time forex sentiment intelligence platform trusted by retail forex traders.

SESSION: ${sessMeta.label} | DATE: ${dateLabel}
HEADLINE: ${angle.headline}
BIGGEST MOVER: ${moverName} (${biggestMover.currency}) — ${biggestMover.score}/100 — ${biggestMover.bias}
${watchPair?`KEY PAIR TO WATCH: ${watchPair}`:''}

SENTIMENT SCORES (all 8 majors):
${sentSummary}

TOP NEWS HEADLINES (last 24 hours, use these as your factual basis):
${topNews}

Write a professional, SEO-optimised forex market briefing. Return ONLY valid JSON — no markdown, no commentary outside the JSON.

{
  "lead": "One punchy hook sentence in plain text. Must name the currency in full, include its ${biggestMover.currency} code, score/100, and bias. Do not start with 'The'.",
  "standfirst": "One sentence telling the reader exactly what they will learn. Plain text.",
  "what_happened_intro": "2–3 paragraphs of flowing prose explaining what drove ${biggestMover.currency} sentiment. Reference specific headlines and sources by name. Naturally alternate between '${moverName}', '${biggestMover.currency}', and '${nick}'. Separate paragraphs with \\n\\n. Plain text only — no HTML tags.",
  "what_happened_quote": "A short verbatim extract from one headline above (max 12 words). Empty string if nothing fits neatly.",
  "what_happened_quote_source": "Source name and UTC time, e.g. 'Reuters · 14:30 UTC'. Empty string if no quote.",
  "reaction_prose": "1–2 paragraphs covering how the broader FX market reacted. Mention the widest sentiment gap and the ${watchPair||'most tradeable cross'} setup. Vary terminology: 'forex market', 'FX session', 'currency pairs', 'exchange rates'. Separate paragraphs with \\n\\n. Plain text only.",
  "drivers": [
    "First key driver — one specific sentence tied directly to a real headline above",
    "Second key driver — a distinct angle, not rephrasing the first",
    "Third key driver — a third distinct factor; omit if fewer than 3 genuine drivers exist"
  ],
  "bull_case": "2–3 sentences. What specific upcoming data release, central bank event, or technical confirmation would extend the ${biasWord} move? Name a real catalyst if one exists in the next 48 hours. Plain text.",
  "bear_case": "2–3 sentences. What specific COUNTER-catalyst — a different narrative entirely from the bull case — would reverse the view and snap ${biggestMover.currency} pairs back? Plain text.",
  "closing_note": "One forward-looking sentence mentioning the next session (Asia 00:13 UTC / London 06:13 UTC / New York 12:13 UTC). Plain text.",
  "page_title": "Unique SEO <title> tag, max 65 chars. MANDATORY: name the SPECIFIC real-world catalyst — the actual event, price level, data print, or central bank action from the headlines above. BANNED (any = failure): 'Strengthens as Bullish News Flow Builds', 'Slides as Bearish News Pressure Builds', 'Quiet Forex Session', 'Mixed Forex Bias', 'Risk-On Mood', 'Risk-Off Sweeps', any score notation like '72/100' or 'X/100'. BAD examples: 'USD Hits 72/100 on Fed Rate-Hike Signals', 'USD Strengthens as Bullish News Flow Builds'. GOOD examples: 'USD Rallies Above 99.40 on Fed Rate Bets & Yen Weakness', 'GBP Slides as UK Jobs Data Misses, BoE Rate Bets Pare', 'AUD Falls Below 0.7150 as RBA Pause Fears Weigh'. Do NOT include the date or score — the date is in the URL and byline already."
}

Hard rules — violating any of these will make the article unusable:
1. Each section must be self-contained. Zero repeated phrases across sections.
2. Bull case and bear case must describe genuinely different scenarios.
3. Drivers must not echo the reaction_prose or each other.
4. No generic filler like "markets await fresh catalysts" unless truly nothing happened.
5. Natural SEO — include these terms once each where they fit: 'forex market analysis', 'currency strength', 'central bank', '${watchPair||biggestMover.currency+' pairs'}', 'exchange rate', 'price action'. Never force them.
6. Tone: authoritative but readable — like FXStreet or Reuters FX desk, not academic.
7. Total prose word count (all sections combined): 500–700 words.
8. CRITICAL — "what_happened_intro" must ONLY reference headlines that directly affect ${biggestMover.currency}. Do NOT open a ${biggestMover.currency} article with a headline about a different currency (e.g. do not lead a USD article with a BoE/GBP headline). If a non-${biggestMover.currency} headline is contextually relevant (e.g. a risk-off event that drives safe-haven flows into USD), mention it briefly as a secondary factor only — never as the lead sentence.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'Content-Type':'application/json','x-api-key':env.CLAUDE_API_KEY,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({model:'claude-haiku-4-5-20251001', max_tokens:1500, messages:[{role:'user',content:prompt}]}),
    signal: AbortSignal.timeout(90000), // 90s — Haiku needs up to ~35s under peak API load; 90s = safe ceiling
  });
  if (!resp.ok) throw new Error(`Anthropic HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.stop_reason === 'max_tokens') throw new Error('AI narrative truncated — max_tokens too low');
  const raw = data.content?.[0]?.text || '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in AI narrative response');
  const ai = JSON.parse(jsonMatch[0]);

  // Glance widget is always data-driven
  const glance = _INS_CCY_ORDER.map(c=>{const x=sentiment[c];if(!x)return '';return `<div class="glance-cell" style="border-top-color:${_insBiasColor(x.bias)};"><div class="glance-ccy">${c}</div><div class="glance-score">${x.score}</div><div class="glance-arr" style="color:${_insBiasColor(x.bias)};">${_insBiasArrow(x.bias)} ${x.bias.slice(0,4)}</div></div>`;}).join('');

  // News timeline: currency-relevant items first, pad with others, then sort by time
  const _tlMover = news.filter(n=>n.title&&(n.currencies_affected||[]).includes(biggestMover.currency));
  const _tlOther = news.filter(n=>n.title&&!_tlMover.includes(n));
  const tl = [..._tlMover,..._tlOther].slice(0,4).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  let timelineHtml = '';
  if (tl.length >= 2) {
    timelineHtml = `<h3 style="font-size:15px;font-weight:700;margin:18px 0 6px;color:#1a1a1a;letter-spacing:0.2px;">Today's news timeline</h3><ul class="timeline">`;
    for (const n of tl) {
      const ccysText = (n.currencies_affected||[]).slice(0,4).join(', ') || 'cross-market';
      timelineHtml += `<li><span class="timeline-time">${_insFmtTime(n.created_at)}</span><div class="timeline-text"><span class="imp-pill imp-${_insEsc(n.impact||'Medium')}">${_insEsc(n.impact||'Med')}</span><a href="${_insEsc(_insSafeUrl(n.url))}" target="_blank" rel="noopener nofollow">${_insEsc(n.title)}</a><span class="timeline-meta">${_insEsc(n.source)} · affects ${_insEsc(ccysText)}</span></div></li>`;
    }
    timelineHtml += `</ul>`;
  }

  // Convert plain text paragraphs to HTML
  const prose2html = t => String(t||'').split('\n\n').filter(Boolean).map(p=>`<p>${_insEsc(p.trim())}</p>`).join('');

  // Lead: bold the currency name/code at the start
  const leadText = String(ai.lead||'').trim();
  const lead = leadText.startsWith(moverName)
    ? `<strong>${_insEsc(moverName)}</strong>${_insEsc(leadText.slice(moverName.length))}`
    : leadText.startsWith(biggestMover.currency)
    ? `<strong>${biggestMover.currency}</strong>${_insEsc(leadText.slice(biggestMover.currency.length))}`
    : _insEsc(leadText);

  const standfirst = _insEsc(String(ai.standfirst||'').trim());

  let whatHappened = prose2html(ai.what_happened_intro);
  if (ai.what_happened_quote) {
    whatHappened += `<blockquote>&ldquo;${_insEsc(ai.what_happened_quote)}&rdquo;${ai.what_happened_quote_source?`<cite>— ${_insEsc(ai.what_happened_quote_source)}</cite>`:''}</blockquote>`;
  }
  whatHappened += timelineHtml;

  const reaction = prose2html(ai.reaction_prose);

  const aiDrivers = (Array.isArray(ai.drivers)?ai.drivers:[]).filter(Boolean).slice(0,3);
  let driversSection = '';
  if (aiDrivers.length > 0) {
    const threadWord = aiDrivers.length===1?'One key thread runs':aiDrivers.length===2?'Two key threads run':'Three key threads run';
    driversSection = `<p>${threadWord} through the ${biasWord} ${_insEsc(moverName)} story:</p><ol style="margin:0 0 14px 22px;font-size:16px;line-height:1.75;color:#1a1a1a;">`;
    for (const d of aiDrivers) driversSection += `<li style="margin-bottom:8px;">${_insEsc(d)}</li>`;
    driversSection += `</ol>`;
    const moverNews = news.filter(n=>(n.currencies_affected||[]).includes(biggestMover.currency));
    if (moverNews.length > 1) {
      const supp = moverNews[1];
      driversSection += `<blockquote>&ldquo;${_insEsc(supp.title)}&rdquo;<cite>— ${_insEsc(supp.source)} · ${_insFmtTime(supp.created_at)}</cite></blockquote>`;
    }
  } else {
    driversSection = `<p>Underlying drivers remain mixed. Today's ${biasWord} ${_insEsc(moverName)} reading appears to be a positioning move rather than a single-catalyst reaction — typically a less durable signal.</p>`;
  }

  const bullCase = _insEsc(String(ai.bull_case||'').trim());
  const bearCase = _insEsc(String(ai.bear_case||'').trim());
  const scenarios = `<div class="scenario-box"><div class="scenario-title">📈 Bull case for the move</div><div class="scenario-text">${bullCase}</div></div><div class="scenario-box" style="border-left-color:#dc2626;"><div class="scenario-title" style="color:#dc2626;">📉 Risk to the view</div><div class="scenario-text">${bearCase}</div></div>`;
  const closing = `<p>${_insEsc(String(ai.closing_note||'The next session wrap lands within the day — Asia at 00:05 UTC, London at 06:05 UTC, New York at 12:05 UTC.').trim())}</p>`;

  return {lead, standfirst, whatHappened, reaction, driversSection, scenarios, closing, glance, pageTitle: String(ai.page_title||'').trim()};
}

function _insBuildNarrative({sentiment, news, biggestMover}){
  const arr = Object.values(sentiment).sort((a,b)=>Math.abs(b.score-50)-Math.abs(a.score-50));
  const bulls = arr.filter(s=>s.bias==='Bullish').sort((a,b)=>b.score-a.score);
  const bears = arr.filter(s=>s.bias==='Bearish').sort((a,b)=>a.score-b.score);
  const strongest = bulls[0]; const weakest = bears[0];
  const high = news.filter(n=>n.impact==='High');
  const moverNews = news.filter(n=>(n.currencies_affected||[]).includes(biggestMover.currency));
  // Prefer a high-impact headline that directly affects the featured currency; fall back to any mover news, then global high, then any news
  const top = moverNews.find(n=>n.impact==='High') || moverNews[0] || high[0] || news[0];
  const moverHighlights = moverNews.slice(0,3);
  // Supporting headlines: prefer currency-relevant ones, pad with other high-impact if needed
  const moverOther = moverNews.filter(n=>n!==top).slice(0,2);
  const otherHigh = moverOther.length >= 2 ? moverOther : [...moverOther, ...high.filter(n=>n!==top&&!moverOther.includes(n)).slice(0,2-moverOther.length)];
  // Timeline: show currency-relevant news first, fill with others up to 4 items
  const tlMover = moverNews.filter(n=>n.title);
  const tlOther = news.filter(n=>n.title&&!tlMover.includes(n));
  const tl = [...tlMover, ...tlOther].slice(0,4).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  const moverName = _INS_CCY_NAMES[biggestMover.currency];
  const biasWord = biggestMover.bias.toLowerCase();
  const biasColorVal = _insBiasColor(biggestMover.bias);
  const drivers = (biggestMover.drivers||[]).slice(0,3);
  const driverProse = drivers.length===0 ? 'a mix of macro and central-bank related headlines' : drivers.length===1 ? drivers[0] : drivers.length===2 ? `${drivers[0]}, alongside ${drivers[1].toLowerCase()}` : `${drivers[0]}, ${drivers[1].toLowerCase()}, and ${drivers[2].toLowerCase()}`;

  const lead = top
    ? `<strong>${_insEsc(moverName)} (${biggestMover.currency})</strong> printed the day's standout move in our news sentiment engine, swinging to a <strong style="color:${biasColorVal};">${biasWord}</strong> reading of <strong>${biggestMover.score}/100</strong> after the latest wires from ${_insEsc(top.source)} reshaped positioning across the major currencies.`
    : `<strong>${_insEsc(moverName)} (${biggestMover.currency})</strong> printed the day's standout move in our news sentiment engine, swinging to a <strong style="color:${biasColorVal};">${biasWord}</strong> reading of <strong>${biggestMover.score}/100</strong> against a quiet headline backdrop.`;
  const standfirst = `Below: a quick read of what happened, why the ${moverName} moved, and what traders should watch over the next 24 hours.`;

  let whatHappened = '';
  if(top){
    whatHappened = `<p>The pivotal headline crossed the wires from <strong>${_insEsc(top.source)}</strong>: &ldquo;<a href="${_insEsc(_insSafeUrl(top.url))}" target="_blank" rel="noopener nofollow">${_insEsc(top.title)}</a>&rdquo;${top.impact==='High'?' Marked as a <strong>high-impact</strong> event':''}, the news immediately reshaped positioning across the ${(top.currencies_affected||[biggestMover.currency]).slice(0,3).join(', ')} complex.</p>`;
    if(otherHigh.length){
      whatHappened += `<p>Two further developments backed up the move. ${otherHigh.map(n=>`${_insEsc(n.source)} reported &ldquo;<a href="${_insEsc(_insSafeUrl(n.url))}" target="_blank" rel="noopener nofollow">${_insEsc(n.title)}</a>&rdquo;`).join(', and ')}.</p>`;
    }
  } else {
    whatHappened = `<p>News flow was thin over the past 24 hours, with no high-impact catalyst dominating the tape. The ${moverName} still drifted to a ${biasWord} bias on the back of secondary headlines.</p>`;
  }
  if(tl.length>=2){
    whatHappened += `<h3 style="font-size:15px;font-weight:700;margin:18px 0 6px;color:#1a1a1a;letter-spacing:0.2px;">Today's news timeline</h3><ul class="timeline">`;
    for(const n of tl){
      const ccysText = (n.currencies_affected||[]).slice(0,4).join(', ') || 'cross-market';
      whatHappened += `<li><span class="timeline-time">${_insFmtTime(n.created_at)}</span><div class="timeline-text"><span class="imp-pill imp-${_insEsc(n.impact||'Medium')}">${_insEsc(n.impact||'Med')}</span><a href="${_insEsc(_insSafeUrl(n.url))}" target="_blank" rel="noopener nofollow">${_insEsc(n.title)}</a><span class="timeline-meta">${_insEsc(n.source)} · affects ${_insEsc(ccysText)}</span></div></li>`;
    }
    whatHappened += `</ul>`;
  }

  let reaction = `<p>Our sentiment engine registered the strongest reaction in the <strong>${_insEsc(moverName)} (${biggestMover.currency})</strong>, which moved to a <strong style="color:${biasColorVal};">${biasWord}</strong> reading of <strong>${biggestMover.score}/100</strong>. ${biggestMover.bias==='Bullish'?'Strength':biggestMover.bias==='Bearish'?'Weakness':'The shift'} was driven by ${_insEsc(driverProse)}.</p>`;
  if(strongest && weakest && strongest.currency !== weakest.currency){
    const pair = _insPairFor(strongest.currency, weakest.currency);
    const dir = _insPairDir(strongest.currency, weakest.currency, pair);
    reaction += `<p>Across the broader board, the widest sentiment gap sits between the <strong style="color:#10b981;">${_insEsc(_INS_CCY_NAMES[strongest.currency])}</strong> at ${strongest.score}/100 and the <strong style="color:#ef4444;">${_insEsc(_INS_CCY_NAMES[weakest.currency])}</strong> at ${weakest.score}/100. That setup typically favors <strong>${pair} ${dir}</strong> for traders following news flow, though execution still depends on the technical structure of the pair.</p>`;
  } else if(arr.filter(s=>s.bias==='Neutral').length>=6){
    reaction += `<p>The rest of the majors held neutral readings between 45 and 55, suggesting traders are waiting for the next clean catalyst before re-engaging.</p>`;
  }

  let driversSection;
  if(drivers.length>0){
    const threadWord = drivers.length===1?'One thread runs':drivers.length===2?'Two threads run':'Three threads run';
    driversSection = `<p>${threadWord} through the ${biasWord} ${moverName} story:</p><ol style="margin:0 0 14px 22px;font-size:16px;line-height:1.75;color:#1a1a1a;">`;
    for(const d of drivers){ driversSection += `<li style="margin-bottom:8px;">${_insEsc(d)}</li>`; }
    driversSection += `</ol>`;
    if(moverHighlights.length>1){
      const supp = moverHighlights[1];
      driversSection += `<blockquote>&ldquo;${_insEsc(supp.title)}&rdquo;<cite>— ${_insEsc(supp.source)} · ${_insFmtTime(supp.created_at)}</cite></blockquote>`;
    }
  } else {
    driversSection = `<p>Underlying drivers remain mixed. Today's ${biasWord} ${moverName} reading appears to be a positioning move rather than a single-headline reaction, which usually means a less durable signal.</p>`;
  }

  const watchPair = strongest && weakest && strongest.currency !== weakest.currency ? _insPairFor(strongest.currency, weakest.currency) : null;
  const bullTarget = biggestMover.bias==='Bullish'?'80/100':biggestMover.bias==='Bearish'?'20/100':'a clearer directional reading';
  const bullTopRef = top ? `the narrative around &ldquo;${_insEsc(top.title.length>70?top.title.slice(0,67)+'…':top.title)}&rdquo;` : 'the current macro backdrop';
  const bullCase = `The fundamental backing behind today's ${biasWord} ${_insEsc(moverName)} read looks well-grounded. If ${bullTopRef} holds through the next session, the bias could extend toward <strong>${bullTarget}</strong>${watchPair?`, making <strong>${watchPair}</strong> the cleanest risk/reward expression of the trade`:''}. A sustained reading above 50 on the sentiment score would confirm the move has legs.`;
  const bearTrigger = biggestMover.bias==='Bullish'
    ? `a dovish central-bank surprise or a weaker-than-expected macro print`
    : biggestMover.bias==='Bearish'
    ? `a hawkish policy shift or a stronger-than-expected data release`
    : `a sharp change in the headline flow`;
  const bearCase = `The main risk to this view is ${bearTrigger} — either could quickly unwind the ${biasWord} positioning and snap the ${_insEsc(moverName)} bias back toward 50/100. Watch ${biggestMover.currency} pairs for early signs of reversal if the next central-bank wire pushes against the current narrative.`;
  const scenarios = `<div class="scenario-box"><div class="scenario-title">📈 Bull case for the move</div><div class="scenario-text">${bullCase}</div></div><div class="scenario-box" style="border-left-color:#dc2626;"><div class="scenario-title" style="color:#dc2626;">📉 Risk to the view</div><div class="scenario-text">${bearCase}</div></div>`;
  const closing = `<p>The next session wrap lands within the day — Asia at <strong>00:05 UTC</strong>, London at <strong>06:05 UTC</strong>, New York at <strong>12:05 UTC</strong> — and will reset the picture against the latest overnight headlines. For live tracking through the day, the <a href="/">sentiment dashboard</a>, <a href="/currencies">currency strength meter</a>, and <a href="/calendar">economic calendar</a> all update in real time.</p>`;

  const glance = _INS_CCY_ORDER.map(c=>{const x=sentiment[c];if(!x)return '';return `<div class="glance-cell" style="border-top-color:${_insBiasColor(x.bias)};"><div class="glance-ccy">${c}</div><div class="glance-score">${x.score}</div><div class="glance-arr" style="color:${_insBiasColor(x.bias)};">${_insBiasArrow(x.bias)} ${x.bias.slice(0,4)}</div></div>`;}).join('');

  return { lead, standfirst, whatHappened, reaction, driversSection, scenarios, closing, glance };
}

// Wrap a headline string into N lines of ~maxChars each, ellipsizing the
// last line if the headline is longer than fits.
function _insWrapText(text, maxChars, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  let i = 0;
  for (; i < words.length; i++) {
    const w = words[i];
    const candidate = line ? line + ' ' + w : w;
    if (candidate.length > maxChars) {
      if (line) { lines.push(line); line = w; }
      else { lines.push(w); line = ''; }
      if (lines.length >= maxLines) { line = ''; break; }
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) { lines.push(line); i = words.length; }
  if (i < words.length && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    const room = Math.max(4, maxChars - 3);
    lines[maxLines - 1] = (last.length > room ? last.slice(0, room).trimEnd() : last) + '...';
  }
  return lines;
}

// Build a 1200x630 SVG og:image card for a daily insight. Three editorial
// templates (asia=sunrise, london=clock+fog, ny=skyline) with bias-tinted
// biggest mover row. SVG is committed alongside the article HTML.
function _insBuildOgSvg({ headline, sessionShort, dateLabel, biggestMover }) {
  const cleanHeadline = String(headline || '')
    .replace(/^[A-Z][a-z]+ Session:\s*/, '')
    .replace(/\s*[—–-]\s*[A-Z][a-z]+\s+[A-Z][a-z]+\s+\d+\s+\d{4}\s*$/, '')
    .trim();
  const lines = _insWrapText(cleanHeadline, 22, 3);

  const sess = (sessionShort === 'asia' || sessionShort === 'london' || sessionShort === 'ny') ? sessionShort : 'london';
  const sessTheme = {
    asia:   { label: 'ASIA SESSION',     accent: '#fb923c', accentSoft: '#fb923c', tagW: 200 },
    london: { label: 'LONDON SESSION',   accent: '#3b82f6', accentSoft: '#60a5fa', tagW: 230 },
    ny:     { label: 'NEW YORK SESSION', accent: '#dc2626', accentSoft: '#f87171', tagW: 250 }
  }[sess];

  const score = (biggestMover && Number.isFinite(biggestMover.score)) ? biggestMover.score : 50;
  const bias = (biggestMover && biggestMover.bias) || 'Neutral';
  const ccy = (biggestMover && biggestMover.currency) || 'USD';
  const biasColor = bias === 'Bullish' ? '#22c55e' : bias === 'Bearish' ? '#ef4444' : '#fb923c';
  const biasArrow = bias === 'Bullish' ? '\u25B2' : bias === 'Bearish' ? '\u25BC' : '\u25CF';
  const biasUpper = String(bias).toUpperCase();
  const dateUpper = String(dateLabel || '').toUpperCase();

  const escSvg = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const headlineTspans = lines.map((ln, idx) => `<tspan x="60" dy="${idx === 0 ? 0 : 56}">${escSvg(ln)}</tspan>`).join('');

  let art = '';
  let glowDef = '';
  if (sess === 'asia') {
    glowDef = '<radialGradient id="sessGlow" cx="50%" cy="100%" r="80%"><stop offset="0" stop-color="#fb923c" stop-opacity="0.85"/><stop offset="0.4" stop-color="#f97316" stop-opacity="0.5"/><stop offset="1" stop-color="#0a1226" stop-opacity="0"/></radialGradient>';
    art = '<g transform="translate(960,500)"><line x1="-260" y1="0" x2="260" y2="0" stroke="#475569" stroke-width="1.5" opacity="0.6"/><circle cx="0" cy="0" r="260" fill="url(#sessGlow)"/><path d="M -110 0 A 110 110 0 0 1 110 0 Z" fill="#fb923c" opacity="0.95"/><path d="M -150 0 A 150 150 0 0 1 150 0" fill="none" stroke="#fed7aa" stroke-width="1.2" opacity="0.4"/><path d="M -190 0 A 190 190 0 0 1 190 0" fill="none" stroke="#fed7aa" stroke-width="1" opacity="0.28"/><path d="M -230 0 A 230 230 0 0 1 230 0" fill="none" stroke="#fed7aa" stroke-width="0.8" opacity="0.18"/><circle cx="0" cy="-3" r="4" fill="#ffffff" opacity="0.95"/></g>';
  } else if (sess === 'london') {
    glowDef = '<radialGradient id="sessGlow" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#60a5fa" stop-opacity="0.25"/><stop offset="1" stop-color="#0a1226" stop-opacity="0"/></radialGradient>';
    art = '<g transform="translate(960,315)"><circle cx="0" cy="0" r="220" fill="url(#sessGlow)"/><line x1="-260" y1="-90" x2="260" y2="-90" stroke="#94a3b8" stroke-width="1" opacity="0.15"/><line x1="-260" y1="-40" x2="260" y2="-40" stroke="#94a3b8" stroke-width="1" opacity="0.22"/><line x1="-260" y1="40" x2="260" y2="40" stroke="#94a3b8" stroke-width="1" opacity="0.22"/><line x1="-260" y1="90" x2="260" y2="90" stroke="#94a3b8" stroke-width="1" opacity="0.15"/><circle cx="0" cy="0" r="170" fill="none" stroke="#475569" stroke-width="1.5"/><circle cx="0" cy="0" r="155" fill="none" stroke="#334155" stroke-width="0.8"/><g stroke="#cbd5e1" stroke-width="2.5"><line x1="0" y1="-170" x2="0" y2="-148"/><line x1="0" y1="170" x2="0" y2="148"/><line x1="-170" y1="0" x2="-148" y2="0"/><line x1="170" y1="0" x2="148" y2="0"/></g><g stroke="#64748b" stroke-width="1.5"><line x1="85" y1="-147" x2="74" y2="-128"/><line x1="147" y1="-85" x2="128" y2="-74"/><line x1="147" y1="85" x2="128" y2="74"/><line x1="85" y1="147" x2="74" y2="128"/><line x1="-85" y1="147" x2="-74" y2="128"/><line x1="-147" y1="85" x2="-128" y2="74"/><line x1="-147" y1="-85" x2="-128" y2="-74"/><line x1="-85" y1="-147" x2="-74" y2="-128"/></g><line x1="0" y1="0" x2="-65" y2="-65" stroke="#fb923c" stroke-width="4" stroke-linecap="round"/><line x1="0" y1="0" x2="0" y2="-110" stroke="#e2e8f0" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="0" r="6" fill="#fb923c"/><text x="0" y="200" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="14" font-weight="700" fill="#94a3b8" letter-spacing="6">LONDON</text></g>';
  } else {
    glowDef = '<linearGradient id="sessGlow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dc2626" stop-opacity="0.5"/><stop offset="0.6" stop-color="#dc2626" stop-opacity="0.1"/><stop offset="1" stop-color="#0a1226" stop-opacity="0"/></linearGradient>';
    art = '<g transform="translate(960,500)"><rect x="-260" y="-380" width="520" height="380" fill="url(#sessGlow)"/><circle cx="-150" cy="-340" r="3" fill="#f8fafc" opacity="0.9"/><circle cx="-90" cy="-360" r="2" fill="#f8fafc" opacity="0.7"/><circle cx="180" cy="-330" r="2.5" fill="#f8fafc" opacity="0.8"/><circle cx="80" cy="-380" r="2" fill="#f8fafc" opacity="0.6"/><line x1="-260" y1="0" x2="260" y2="0" stroke="#475569" stroke-width="1" opacity="0.6"/><g fill="#1e293b" stroke="#334155" stroke-width="1"><rect x="-240" y="-90" width="34" height="90"/><rect x="-200" y="-150" width="38" height="150"/><rect x="-156" y="-120" width="32" height="120"/><rect x="-118" y="-200" width="44" height="200"/><rect x="-68" y="-260" width="48" height="260"/><rect x="-14" y="-310" width="52" height="310"/><rect x="44" y="-220" width="40" height="220"/><rect x="90" y="-180" width="36" height="180"/><rect x="132" y="-240" width="42" height="240"/><rect x="180" y="-140" width="34" height="140"/><rect x="220" y="-100" width="30" height="100"/></g><g fill="#fbbf24" opacity="0.85"><rect x="-228" y="-70" width="3" height="3"/><rect x="-188" y="-130" width="3" height="3"/><rect x="-178" y="-100" width="3" height="3"/><rect x="-144" y="-100" width="3" height="3"/><rect x="-104" y="-180" width="3" height="3"/><rect x="-94" y="-150" width="3" height="3"/><rect x="-54" y="-240" width="3" height="3"/><rect x="-44" y="-210" width="3" height="3"/><rect x="0" y="-290" width="3" height="3"/><rect x="14" y="-260" width="3" height="3"/><rect x="0" y="-220" width="3" height="3"/><rect x="56" y="-200" width="3" height="3"/><rect x="100" y="-160" width="3" height="3"/><rect x="146" y="-220" width="3" height="3"/><rect x="156" y="-180" width="3" height="3"/><rect x="190" y="-110" width="3" height="3"/><rect x="228" y="-80" width="3" height="3"/></g><rect x="-14" y="-310" width="52" height="310" fill="none" stroke="#dc2626" stroke-width="1.5" opacity="0.9"/><text x="0" y="34" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="14" font-weight="700" fill="#94a3b8" letter-spacing="6">NEW YORK</text></g>';
  }

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">'
    + '<defs>'
    + '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e293b"/></linearGradient>'
    + '<linearGradient id="rightPane" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e2a4a"/><stop offset="1" stop-color="#0a1226"/></linearGradient>'
    + glowDef
    + '</defs>'
    + '<rect width="1200" height="630" fill="url(#bg)"/>'
    + '<rect x="720" y="0" width="480" height="630" fill="url(#rightPane)"/>'
    + art
    + '<g transform="translate(60,80)"><text x="0" y="0" font-family="Inter,system-ui,sans-serif" font-size="32" font-weight="900" fill="#ffffff" letter-spacing="-1">FX<tspan fill="#fb923c">NEWS</tspan>BIAS</text><text x="0" y="22" font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="500" fill="#64748b" letter-spacing="2">FOREX SENTIMENT INTELLIGENCE</text></g>'
    + `<g transform="translate(60,180)"><rect x="0" y="0" width="${sessTheme.tagW}" height="32" rx="4" fill="${sessTheme.accent}" opacity="0.18"/><rect x="0" y="0" width="3" height="32" fill="${sessTheme.accent}"/><text x="14" y="22" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="700" fill="${sessTheme.accentSoft}" letter-spacing="2">— ${sessTheme.label}</text></g>`
    + `<text font-family="Georgia,'Times New Roman',serif" font-size="46" font-weight="700" fill="#ffffff" letter-spacing="-1" y="290">${headlineTspans}</text>`
    + `<g transform="translate(60,500)"><text x="0" y="0" font-family="Inter,system-ui,sans-serif" font-size="13" fill="#94a3b8" letter-spacing="1">${escSvg(dateUpper)}</text><line x1="0" y1="20" x2="600" y2="20" stroke="#334155" stroke-width="1"/><text x="0" y="60" font-family="Inter,system-ui,sans-serif" font-size="11" fill="#64748b" letter-spacing="2">BIGGEST MOVER</text><text x="0" y="92" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="800" fill="#ffffff">${escSvg(ccy)}</text><text x="80" y="92" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="800" fill="${biasColor}">${biasArrow} ${score}/100</text><text x="280" y="92" font-family="Inter,system-ui,sans-serif" font-size="14" font-weight="700" fill="${biasColor}" letter-spacing="3">${escSvg(biasUpper)}</text></g>`
    + '<text x="1140" y="595" text-anchor="end" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600" fill="#64748b" letter-spacing="1">fxnewsbias.com</text>'
    + '</svg>';
}

function _insRenderArticle({headline, slug, summary, sentiment, news, biggestMover, dateISO, dateLabel, category, narrative, ogImageOverride}){
  const url = `${_INS_SITE}/insight/${slug}`;
  const shortHeadline = String(headline).split(" — ")[0]; const h = _insEsc(headline), hShort = _insEsc(shortHeadline), s = _insEsc(summary);
  const pageTitle = (narrative && narrative.pageTitle) ? _insEsc(narrative.pageTitle) : h;
  const N = narrative || _insBuildNarrative({sentiment, news, biggestMover});
  const sidebarCcys = _INS_CCY_ORDER.slice(0,5).map(c=>{const x=sentiment[c];if(!x)return '';return `<a class="side-link" href="/currencies"><span style="color:${_insBiasColor(x.bias)};font-weight:700;">${_insBiasArrow(x.bias)} ${c}</span> · <span style="color:#6b7280;font-weight:500;">${x.bias} ${x.score}/100</span></a>`;}).join('');
  // ogImageOverride = slug-specific PNG when SVG→PNG conversion succeeded.
  // Falls back to per-currency PNG which is always available.
  const ogImage = ogImageOverride || `${_INS_SITE}/og/insight/${biggestMover.currency}.png`;
  const schemaHeadline = (narrative && narrative.pageTitle) ? narrative.pageTitle : headline;
  const ld = JSON.stringify({"@context":"https://schema.org","@type":"NewsArticle","headline":schemaHeadline,"description":summary,"datePublished":dateISO,"dateModified":dateISO,"author":{"@type":"Organization","name":"FXNewsBias Team","url":_INS_SITE},"publisher":{"@type":"Organization","name":"FXNewsBias","logo":{"@type":"ImageObject","url":`${_INS_SITE}/logo-fxnb.png`}},"mainEntityOfPage":{"@type":"WebPage","@id":url},"image":ogImage,"articleSection":"Forex Analysis"});
  const breadcrumbLd = JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":`${_INS_SITE}/`},{"@type":"ListItem","position":2,"name":"Daily Insights","item":`${_INS_SITE}/insight/`},{"@type":"ListItem","position":3,"name":schemaHeadline,"item":url}]});
  const cat = _insEsc(category||'Market Wrap');
  const dateStr = new Date().toUTCString().split(' ').slice(0,4).join(' ');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<script>try{if(localStorage.getItem("fxnb_is_pro")==="true")document.documentElement.dataset.pro="1";}catch(e){}</script>
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"><link rel="icon" href="/favicon.ico"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="preconnect" href="https://vtbmtxtgtdprpbilragm.supabase.co" crossorigin><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#0f172a">
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"></noscript>
<title>${pageTitle} | FXNewsBias</title><meta name="description" content="${s}"><meta name="robots" content="index, follow"><meta name="author" content="FXNewsBias Team"><link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:title" content="${pageTitle}"><meta property="og:description" content="${s}"><meta property="og:url" content="${url}"><meta property="og:image" content="${ogImage}"><meta property="og:image:secure_url" content="${ogImage}"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${pageTitle} — FXNewsBias daily insight"><meta property="og:site_name" content="FXNewsBias">
<meta property="article:published_time" content="${dateISO}"><meta property="article:author" content="FXNewsBias Team"><meta property="article:section" content="Forex Analysis">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${pageTitle}"><meta name="twitter:description" content="${s}"><meta name="twitter:image" content="${ogImage}"><meta name="twitter:image:alt" content="${pageTitle} — FXNewsBias daily insight">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Inter',-apple-system,sans-serif;background:#fff;color:#1a1a1a;line-height:1.5;}:root{--bg:#fff;--bg-soft:#f8f9fa;--border:#e5e7eb;--text:#1a1a1a;--text-soft:#6b7280;--text-muted:#9ca3af;--accent:#2563eb;--bull:#10b981;--bear:#ef4444;--neutral:#f59e0b;}a{color:var(--accent);text-decoration:none;}a:hover{text-decoration:underline;}
.topbar{background:#0f172a;color:#fff;padding:6px 0;font-size:12px;}.topbar-inner{max-width:1280px;margin:0 auto;padding:0 20px;display:flex;justify-content:space-between;align-items:center;}.topbar-left,.topbar-right{display:flex;gap:14px;color:#94a3b8;}.topbar a{color:#94a3b8;text-decoration:none;}.topbar a:hover{color:#fff;}
.page-head{background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;padding:32px 0;}.page-head-inner{max-width:1280px;margin:0 auto;padding:0 20px;}.crumb{font-size:13px;color:#94a3b8;margin-bottom:10px;}.crumb a{color:#94a3b8;text-decoration:none;}
.cat-tag{display:inline-block;background:#2563eb;color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;padding:4px 10px;border-radius:4px;text-transform:uppercase;margin-bottom:12px;}
.page-title{font-size:clamp(22px,3.4vw,30px);font-weight:800;line-height:1.25;letter-spacing:-0.5px;margin-bottom:10px;color:#fff;}.page-sub{color:#94a3b8;font-size:14px;line-height:1.55;max-width:760px;}
.byline{margin-top:14px;color:#94a3b8;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}.byline-author{color:#fff;font-weight:600;}.byline-dot{color:#475569;}
.main{max-width:1280px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:1fr 320px;gap:24px;}@media(max-width:980px){.main{grid-template-columns:1fr;}}
.article-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:32px;}@media(max-width:600px){.article-card{padding:22px;}}
.lead{font-size:18px;line-height:1.7;color:#1a1a1a;margin-bottom:8px;font-weight:500;}.lead strong{font-weight:700;}
.standfirst{font-size:14px;color:var(--text-soft);margin-bottom:24px;border-bottom:1px solid var(--border);padding-bottom:18px;}
.h2{font-size:22px;font-weight:800;color:#1a1a1a;margin:32px 0 12px;letter-spacing:-0.3px;}
.prose p{font-size:16px;line-height:1.75;color:#1a1a1a;margin-bottom:14px;}.prose p strong{font-weight:700;}
.prose blockquote{border-left:4px solid var(--accent);background:#f8fafc;padding:14px 18px;margin:18px 0;font-size:15px;color:#374151;line-height:1.65;border-radius:0 8px 8px 0;font-style:italic;}.prose blockquote cite{display:block;font-size:12px;color:var(--text-soft);margin-top:6px;font-style:normal;}
.timeline{list-style:none;padding:0;margin:14px 0 8px;border-left:2px solid var(--border);}.timeline li{position:relative;padding:0 0 16px 22px;}.timeline li:before{content:'';position:absolute;left:-7px;top:6px;width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid #fff;box-shadow:0 0 0 1px var(--accent);}
.timeline-time{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--accent);font-weight:700;display:block;margin-bottom:3px;letter-spacing:0.5px;}.timeline-text{font-size:15px;line-height:1.6;color:#1a1a1a;}.timeline-text a{color:#1a1a1a;font-weight:600;border-bottom:1px dotted var(--text-muted);}.timeline-text a:hover{color:var(--accent);text-decoration:none;border-bottom-color:var(--accent);}.timeline-meta{display:block;font-size:12px;color:var(--text-soft);margin-top:3px;}
.imp-pill{display:inline-block;color:#fff;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:0.5px;margin-right:6px;text-transform:uppercase;vertical-align:middle;}.imp-High{background:#dc2626;}.imp-Medium{background:#f59e0b;}.imp-Low{background:#2563eb;}
.scenario-box{background:#f8fafc;border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:8px;padding:16px 18px;margin:14px 0;}.scenario-title{font-size:13px;font-weight:800;color:var(--accent);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;}.scenario-text{font-size:14.5px;line-height:1.65;color:#1a1a1a;}.scenario-text strong{font-weight:700;}
.glance{background:#f8fafc;border:1px solid var(--border);border-radius:10px;padding:18px;margin-top:24px;}.glance-h{font-size:13px;font-weight:800;color:var(--text-soft);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;}.glance-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;}@media(max-width:680px){.glance-grid{grid-template-columns:repeat(4,1fr);}}.glance-cell{background:#fff;border:1px solid var(--border);border-top:3px solid;border-radius:6px;padding:8px 4px;text-align:center;}.glance-ccy{font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:0.8px;}.glance-score{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:800;color:#1a1a1a;line-height:1;margin:3px 0;}.glance-arr{font-size:11px;font-weight:700;}
.cta{background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;border-radius:10px;padding:18px;margin-top:28px;color:#1e3a8a;font-size:14.5px;line-height:1.6;}.cta strong{color:#0f172a;}
.sidebar-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:14px;}.sidebar-h{font-size:13px;font-weight:800;color:#1a1a1a;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;}
.side-link{display:block;padding:10px 0;border-bottom:1px solid var(--border);color:#1a1a1a;font-size:14px;font-weight:600;line-height:1.4;}.side-link:last-child{border-bottom:none;}.side-link:hover{color:var(--accent);text-decoration:none;}
.share-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}.share-btn{flex:1;text-align:center;padding:8px;background:#f8f9fa;border:1px solid var(--border);border-radius:6px;color:#1a1a1a;font-size:12px;font-weight:600;}.share-btn:hover{background:var(--accent);color:#fff;text-decoration:none;border-color:var(--accent);}
footer{background:#0f172a;color:#94a3b8;padding:32px 20px 20px;margin-top:40px;}.footer-inner{max-width:1280px;margin:0 auto;}.footer-bottom{text-align:center;font-size:12px;padding-top:16px;border-top:1px solid #1e293b;color:#64748b;}.footer-bottom a{color:#94a3b8;}
.art-sky{float:right;margin:0 0 16px 24px;}.art-sky-b{text-align:center;margin:32px auto;}html[data-pro="1"] .art-sky,html[data-pro="1"] .art-sky-b{display:none!important;}@media(max-width:768px){.art-sky,.art-sky-b{display:none!important;}}</style>
<script type="application/ld+json">${ld}</script>
<script type="application/ld+json">${breadcrumbLd}</script>
<script src="/nav.js" defer></script><script src="/cookie.js" defer></script><script src="/analytics.js" defer></script>
<script>(function(){var p=localStorage.getItem("fxnb_is_pro")==="true";if(p)document.documentElement.dataset.pro="1";if(!p){var s=document.createElement("script");s.async=true;s.src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4857533156344939";s.crossOrigin="anonymous";document.head.appendChild(s);}window.addEventListener("userLoaded",function(e){if(e.detail&&e.detail.isPro){localStorage.setItem("fxnb_is_pro","true");document.documentElement.dataset.pro="1";document.querySelectorAll('ins.adsbygoogle,.adsbygoogle,iframe[id^="google_ads"],iframe[src*="googleads"]').forEach(function(el){el.style.display="none";});}else if(e.detail&&e.detail.isPro===false){localStorage.setItem("fxnb_is_pro","false");}});})();</script>
</head><body>
<div class="topbar"><div class="topbar-inner"><div class="topbar-left"><span>📅 ${dateStr}</span></div><div class="topbar-right"><a href="/insight/">Daily Insights</a><a href="/news">News</a></div></div></div>
<style>@media(max-width:768px){.nav-menu,.nav-actions{display:none!important;}.nav-toggle{display:flex!important;}}@media(min-width:769px){.nav-toggle{display:flex!important;}.nav-menu,.nav-actions{display:none!important;}}</style>
<nav class="nav"></nav>
<header class="page-head"><div class="page-head-inner">
<div class="crumb"><a href="/">Home</a> · <a href="/insight/">Daily Insights</a> · <span>${dateLabel}</span></div>
<span class="cat-tag">${cat}</span><h1 class="page-title">${pageTitle}</h1><p class="page-sub">${s}</p>
<div class="byline"><span class="byline-author">By FXNewsBias Team</span><span class="byline-dot">·</span><span>Published ${dateLabel}</span><span class="byline-dot">·</span><span>4 min read</span></div>
</div></header>
<div class="main">
<article class="article-card prose">
<p class="lead">${N.lead}</p>
<p class="standfirst">${N.standfirst}</p>
<div class="art-sky"><ins class='dcmads' style='display:inline-block;width:160px;height:600px' data-dcm-placement='N800570.1808597HASOFFERS.COM/B21208975.381909257' data-dcm-rendering-mode='iframe' data-dcm-https-only data-dcm-click-tracker="https://trk.pepperstonepartners.com/aff_c?offer_id=367&aff_id=44603&file_id=5511" data-dcm-api-frameworks='[APIFRAMEWORKS]' data-dcm-omid-partner='[OMIDPARTNER]' data-dcm-gdpr-applies='gdpr=\${GDPR}' data-dcm-gdpr-consent='gdpr_consent=\${GDPR_CONSENT_755}' data-dcm-addtl-consent='addtl_consent=\${ADDTL_CONSENT}' data-dcm-ltd='false' data-dcm-resettable-device-id='' data-dcm-app-id=''><script src='https://www.googletagservices.com/dcm/dcmads.js'></script></ins><img src="https://trk.pepperstonepartners.com/aff_i?offer_id=367&aff_id=44603&file_id=5511" width="0" height="0" style="position:absolute;visibility:hidden;" border="0" /></div>
<h2 class="h2">What Happened</h2>${N.whatHappened}
<h2 class="h2">Market Reaction</h2>${N.reaction}
<h2 class="h2">What's Driving the Move</h2>${N.driversSection}
<h2 class="h2">What to Watch Next</h2>${N.scenarios}${N.closing}
<div class="glance"><div class="glance-h">📊 Bias snapshot at the time of writing</div><div class="glance-grid">${N.glance}</div></div>
<div class="art-sky-b"><a href="https://trk.pepperstonepartners.com/aff_c?offer_id=391&aff_id=44603&file_id=5597"><img src="https://media.go2speed.org/brand/files/pepperstonegroup/391/TradingViewEssentials2401-StaticBanner-Affiliates-120x600-EN-02.png" width="120" height="600" border="0" /></a><img src="https://trk.pepperstonepartners.com/aff_i?offer_id=391&aff_id=44603&file_id=5597" width="0" height="0" style="position:absolute;visibility:hidden;" border="0" /></div>
<div class="cta"><strong>Catch every session wrap as it drops.</strong> Bookmark <a href="/insight/">/insight/</a> or subscribe to our <a href="/insight/rss.xml">RSS feed</a> for fresh forex sentiment analysis 3 times a day — Asia, London and New York sessions.</div>
<p class="ai-disclosure" style="margin-top:24px;padding:14px 16px;background:#f8fafc;border-left:3px solid #94a3b8;border-radius:4px;font-size:13px;color:#475569;line-height:1.6;"><strong>How this briefing was written:</strong> AI-drafted from real forex news headlines scanned every 3 hours by FXNewsBias, then auto-published on a fixed session schedule. Sentiment scores reflect news flow only — not technical signals or price action. This is information, not financial advice. Always cross-check with your own analysis before trading.</p>
</article>
<aside>
<div class="sidebar-card"><div class="sidebar-h">📊 Live Currency Bias</div>${sidebarCcys}<a class="side-link" style="text-align:center;color:#2563eb;border-top:1px solid #e5e7eb;margin-top:6px;padding-top:12px;" href="/currencies">View all 8 currencies →</a></div>
<div class="sidebar-card"><div class="sidebar-h">🔗 Explore More</div><a class="side-link" href="/">Live Sentiment Dashboard</a><a class="side-link" href="/pairs">All Forex Pairs</a><a class="side-link" href="/calendar">Economic Calendar</a><a class="side-link" href="/news">Latest Forex News</a><a class="side-link" href="/insight/">All Daily Insights</a></div>
<div class="sidebar-card"><div class="sidebar-h">📤 Share This Insight</div><div class="share-row"><a class="share-btn" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(headline)}" target="_blank" rel="noopener">𝕏 Twitter</a><a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">LinkedIn</a><a class="share-btn" href="https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(headline)}" target="_blank" rel="noopener">🔴 Reddit</a></div></div>
</aside>
</div>
<footer><div class="footer-inner"><div class="footer-bottom">© ${new Date().getFullYear()} FXNewsBias · <a href="/about">About</a> · <a href="/disclaimer">Disclaimer</a> · <a href="/insight/">All Daily Insights</a> · <a href="/insight/rss.xml">RSS</a> · <a href="https://www.reddit.com/u/fxnewsbias/s/1bZFbWSZ50" target="_blank" rel="noopener noreferrer">🔴 Reddit</a></div></div></footer>
</body></html>`;
}

function _insRenderIndex(articles){
  const dateStr = new Date().toUTCString().split(' ').slice(0,4).join(' ');
  const items = articles.map(a=>`<article class="ix-card"><div class="ix-meta"><span class="ix-cat">${_insEsc(a.category||'Market Wrap')}</span><span class="ix-date">${a.dateLabel}</span></div><h2 class="ix-title"><a href="/insight/${a.slug}">${_insEsc(a.headline)}</a></h2><p class="ix-desc">${_insEsc(a.summary)}</p><a class="ix-read" href="/insight/${a.slug}">Read full insight →</a></article>`).join('');
  const collectionLd = JSON.stringify({"@context":"https://schema.org","@type":"CollectionPage","name":"Daily Forex Insights","description":"Forex market wraps with focus on the highest-impact news, market reaction, and what to watch next. Published 3 times a day for the Asia, London and New York sessions.","url":_INS_SITE+"/insight/","publisher":{"@type":"Organization","name":"FXNewsBias","url":_INS_SITE,"logo":{"@type":"ImageObject","url":_INS_SITE+"/og-image.png"}},"mainEntity":{"@type":"ItemList","numberOfItems":articles.length,"itemListElement":articles.map((a,i)=>({"@type":"ListItem","position":i+1,"url":_INS_SITE+"/insight/"+a.slug,"name":a.headline}))}});
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon.ico"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#0f172a">
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"></noscript>
<title>Daily Forex Insights | News Sentiment Analysis - FXNewsBias</title>
<meta name="description" content="Forex market wraps with focus on the highest-impact news, market reaction, and what to watch next. Published 3 times a day for the Asia, London and New York sessions.">
<meta name="robots" content="index, follow"><link rel="canonical" href="${_INS_SITE}/insight/">
<meta property="og:type" content="website"><meta property="og:title" content="Daily Forex Insights | FXNewsBias"><meta property="og:description" content="Daily forex market wraps with focus on the highest-impact news, market reaction, and what to watch next."><meta property="og:url" content="${_INS_SITE}/insight/"><meta property="og:image" content="${_INS_SITE}/og/insight/index.png?v=2"><meta property="og:image:secure_url" content="${_INS_SITE}/og/insight/index.png?v=2"><meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="FXNewsBias Daily Insights — forex market wraps 3 times a day"><meta property="og:site_name" content="FXNewsBias"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${_INS_SITE}/og/insight/index.png?v=2"><meta name="twitter:image:alt" content="FXNewsBias Daily Insights — forex market wraps 3 times a day">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Inter',-apple-system,sans-serif;background:#fff;color:#1a1a1a;line-height:1.5;}:root{--border:#e5e7eb;--accent:#2563eb;}a{color:#2563eb;text-decoration:none;}a:hover{text-decoration:underline;}
.topbar{background:#0f172a;color:#fff;padding:6px 0;font-size:12px;}.topbar-inner{max-width:1280px;margin:0 auto;padding:0 20px;display:flex;justify-content:space-between;align-items:center;}.topbar a{color:#94a3b8;text-decoration:none;}
.page-head{background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;padding:32px 0;}.page-head-inner{max-width:1280px;margin:0 auto;padding:0 20px;}.crumb{font-size:13px;color:#94a3b8;margin-bottom:10px;}.crumb a{color:#94a3b8;}.page-title{font-size:clamp(24px,4vw,32px);font-weight:800;color:#fff;margin-bottom:8px;letter-spacing:-0.5px;}.page-sub{color:#94a3b8;font-size:14px;line-height:1.5;max-width:760px;}
.main{max-width:1280px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:1fr 320px;gap:24px;}@media(max-width:980px){.main{grid-template-columns:1fr;}}
.ix-grid{display:grid;gap:14px;}.ix-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:20px;border-left:4px solid var(--accent);transition:box-shadow .15s, transform .15s;}.ix-card:hover{box-shadow:0 4px 14px rgba(37,99,235,.08);transform:translateY(-1px);}
.ix-meta{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}.ix-cat{background:#2563eb;color:#fff;font-size:10px;font-weight:700;letter-spacing:1px;padding:3px 8px;border-radius:3px;text-transform:uppercase;}.ix-date{font-size:12px;color:#6b7280;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;}
.ix-title{margin:6px 0 8px;}.ix-title a{color:#1a1a1a;font-size:18px;font-weight:800;line-height:1.35;letter-spacing:-0.2px;}.ix-title a:hover{color:#2563eb;text-decoration:none;}.ix-desc{color:#374151;font-size:14px;line-height:1.6;margin-bottom:8px;}.ix-read{color:#2563eb;font-size:13px;font-weight:700;}
.rss-card{background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;border-radius:10px;padding:20px;margin-top:24px;text-align:center;}.rss-card a{color:#1e40af;font-weight:700;font-size:14px;}
.sidebar-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:14px;}.sidebar-h{font-size:13px;font-weight:800;color:#1a1a1a;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;}.side-link{display:block;padding:10px 0;border-bottom:1px solid var(--border);color:#1a1a1a;font-size:14px;font-weight:600;line-height:1.4;}.side-link:last-child{border-bottom:none;}.side-link:hover{color:#2563eb;text-decoration:none;}
footer{background:#0f172a;color:#94a3b8;padding:32px 20px 20px;margin-top:40px;}.footer-inner{max-width:1280px;margin:0 auto;}.footer-bottom{text-align:center;font-size:12px;padding-top:16px;border-top:1px solid #1e293b;color:#64748b;}.footer-bottom a{color:#94a3b8;}</style>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://fxnewsbias.com/"},{"@type":"ListItem","position":2,"name":"Daily Insights","item":"https://fxnewsbias.com/insight/"}]}</script>
<script type="application/ld+json">${collectionLd}</script>
<script src="/nav.js" defer></script><script src="/cookie.js" defer></script><script src="/analytics.js" defer></script>
</head><body>
<div class="topbar"><div class="topbar-inner"><div><span style="color:#94a3b8;">📅 ${dateStr}</span></div><div><a href="/news" style="color:#94a3b8;margin-left:14px;">News</a></div></div></div>
<style>@media(max-width:768px){.nav-menu,.nav-actions{display:none!important;}.nav-toggle{display:flex!important;}}@media(min-width:769px){.nav-toggle{display:flex!important;}.nav-menu,.nav-actions{display:none!important;}}</style>
<nav class="nav"></nav>
<header class="page-head"><div class="page-head-inner">
<div class="crumb"><a href="/">Home</a> · <span>Daily Insights</span></div>
<h1 class="page-title">Daily Forex Insights</h1>
<p class="page-sub">Forex market wraps focused on the highest-impact news, the currencies that moved, and what traders should watch over the next 24 hours. Daily forex session wraps — Asia 08:05, London 14:05, New York 20:05 (MYT). Monday to Friday.</p>
</div></header>
<div class="main">
<div><div class="ix-grid">${items}</div><div class="rss-card"><a href="/insight/rss.xml">📡 Subscribe via RSS</a><div style="font-size:13px;color:#1e40af;margin-top:6px;">Get new insights in Feedly, Inoreader, or any RSS reader</div></div></div>
<aside>
<div class="sidebar-card"><div class="sidebar-h">📊 Live Tools</div><a class="side-link" href="/">Sentiment Dashboard</a><a class="side-link" href="/currencies">Currency Strength Meter</a><a class="side-link" href="/pairs">All Forex Pairs</a><a class="side-link" href="/calendar">Economic Calendar</a><a class="side-link" href="/news">Forex News Feed</a></div>
<div class="sidebar-card"><div class="sidebar-h">ℹ️ About These Insights</div><p style="font-size:13.5px;color:#374151;line-height:1.6;">Each insight focuses on the highest-impact news from the past 24 hours, the currency reaction, the drivers behind the move, and forward-looking scenarios for the next session.</p></div>
</aside>
</div>
<footer><div class="footer-inner"><div class="footer-bottom">© ${new Date().getFullYear()} FXNewsBias · <a href="/about">About</a> · <a href="/disclaimer">Disclaimer</a></div></div></footer>
</body></html>`;
}

function _insRenderRss(articles){
  const items = articles.map(a=>`<item><title>${_insEsc(a.headline)}</title><link>${_INS_SITE}/insight/${a.slug}</link><guid>${_INS_SITE}/insight/${a.slug}</guid><pubDate>${new Date(a.dateISO).toUTCString()}</pubDate><description>${_insEsc(a.summary)}</description></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/insight/rss-style.xsl"?>
<rss version="2.0"><channel>
<title>FXNewsBias Daily Insights</title>
<link>${_INS_SITE}/insight/</link>
<description>Daily forex market insights focused on the highest-impact news and what traders should watch next.</description>
<language>en</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel></rss>`;
}

async function _insListExistingArticles(env) {
  // List files in /insight/ via GitHub Contents API
  try {
    const data = await _insGh(env, 'GET', `/repos/{owner}/{repo}/contents/insight?ref=${env.GITHUB_BRANCH || 'main'}`);
    return (data || []).filter(f => f.type === 'file' && /^\d{4}-\d{2}-\d{2}-.+\.html$/.test(f.name)).map(f => f.name);
  } catch (e) {
    console.log('Insight: failed to list existing articles:', e.message);
    return [];
  }
}

async function _insGetFile(env, path) {
  try {
    const data = await _insGh(env, 'GET', `/repos/{owner}/{repo}/contents/${path}?ref=${env.GITHUB_BRANCH || 'main'}`);
    if (data && data.content) {
      // atob() returns a binary string (byte values as char codes), NOT a Unicode string.
      // Files with non-ASCII characters (emojis, em-dashes, arrows) must be decoded
      // via TextDecoder to get a proper UTF-8 JS string before any string operations.
      // Passing a binary string to btoa(unescape(encodeURIComponent(...))) double-encodes
      // every byte above 127, corrupting all multi-byte sequences.
      const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch (_) {}
  return null;
}

async function _insCommitFiles(env, files, commitMessage) {
  // files: [{path, content}]
  const owner = env.GITHUB_OWNER || 'EARNOVAGAMING';
  const repo = env.GITHUB_REPO || 'fxnewsbias';
  const branch = env.GITHUB_BRANCH || 'main';

  // Create blobs once — they are content-addressed and reusable across retry attempts.
  // Pass { binary: true } for files where content is already a base64 string (e.g. PNG).
  const blobShas = new Map();
  for (const f of files) {
    const blob = await _insGh(env, 'POST', `/repos/{owner}/{repo}/git/blobs`, {
      content: f.binary ? f.content : btoa(unescape(encodeURIComponent(f.content))),
      encoding: 'base64'
    });
    blobShas.set(f.path, blob.sha);
  }

  // Retry the tree→commit→ref-update loop up to 3 times.
  // On a 422 the branch has moved (e.g. concurrent cron commit); re-read HEAD
  // and rebuild the commit on top of the new tip.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ref = await _insGh(env, 'GET', `/repos/{owner}/{repo}/git/ref/heads/${branch}`);
    const baseSha = ref.object.sha;
    const baseCommit = await _insGh(env, 'GET', `/repos/{owner}/{repo}/git/commits/${baseSha}`);
    const baseTreeSha = baseCommit.tree.sha;

    const treeItems = files.map(f => ({ path: f.path, mode: '100644', type: 'blob', sha: blobShas.get(f.path) }));
    const tree = await _insGh(env, 'POST', `/repos/{owner}/{repo}/git/trees`, {
      base_tree: baseTreeSha, tree: treeItems
    });
    const commit = await _insGh(env, 'POST', `/repos/{owner}/{repo}/git/commits`, {
      message: commitMessage, tree: tree.sha, parents: [baseSha]
    });

    try {
      await _insGh(env, 'PATCH', `/repos/{owner}/{repo}/git/refs/heads/${branch}`, { sha: commit.sha });
      return commit.sha;
    } catch(e) {
      if (attempt < 3 && e.message && e.message.includes('422')) {
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }
      throw e;
    }
  }
}

async function _insSendFailureEmail(env, error, ctx) {
  const to = env.INSIGHT_ALERT_EMAIL_TO || env.ALERT_EMAIL_TO;
  if (!to || !env.RESEND_API_KEY) {
    console.log('Insight failure: no email channel configured');
    return;
  }
  const recipients = String(to).split(',').map(s => s.trim()).filter(Boolean);
  const fromEmail = env.ALERT_EMAIL_FROM || env.CONTACT_FROM_EMAIL || 'noreply@fxnewsbias.com';
  const subject = 'FXNewsBias: daily insight generation FAILED';
  const text = `Daily insight generation failed at ${new Date().toISOString()}\n\nError: ${error.message || error}\n\nContext: ${ctx || 'cron run'}\n\nCheck Cloudflare worker logs for full stack trace.`;
  const html = `<pre style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;white-space:pre-wrap;">${_insEsc(text)}</pre>`;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `FXNewsBias Alerts <${fromEmail}>`, to: recipients, subject, text, html }),
      signal: AbortSignal.timeout(25000),
    });
    console.log('Insight failure email sent to', recipients.join(','));
  } catch (e) {
    console.log('Insight failure email error:', e.message);
  }
}

async function generateDailyInsight(env, session) {
  const sess = _INS_SESSIONS[session] ? session : _insDetectSessionFromHour();
  const sessMeta = _INS_SESSIONS[sess];
  console.log(`Daily insight: starting... (session=${sess})`);
  try {
    if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN env var not set');
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error('Supabase env vars missing');

    // 1. Fetch sentiment + news
    const sentRows = await _insSbFetch(env, 'sentiment?select=currency,bias,score,drivers,created_at&order=created_at.desc&limit=80');
    const sentiment = {};
    for (const r of sentRows) { if (!sentiment[r.currency]) sentiment[r.currency] = r; if (Object.keys(sentiment).length === 8) break; }
    const since = new Date(Date.now() - 24*60*60*1000).toISOString();
    const news = await _insSbFetch(env, `news?select=title,source,url,impact,currencies_affected,created_at&created_at=gte.${since}&order=created_at.desc&limit=50`);

    // 2. Validate
    if (Object.keys(sentiment).length < 6) throw new Error(`Insufficient sentiment data: only ${Object.keys(sentiment).length} currencies`);
    if (news.length < 3) throw new Error(`Insufficient news data: only ${news.length} items`);

    // 3. Generate article — session-tagged (3x per day: asia/london/newyork)
    const angle = _insDetectAngle(sentiment);
    const dateISO = new Date().toISOString();
    const today = dateISO.slice(0, 10);
    const dateLabel = new Date().toUTCString().split(' ').slice(0,4).join(' ');
    const sessionHeadline = `${sessMeta.label}: ${angle.headline}`;
    const sessionSummary = `${sessMeta.intro} ${angle.summary}`;
    const sessionCategory = `${sessMeta.label} • ${angle.category}`;

    // Build AI narrative FIRST so we can derive a unique, event-specific slug from it
    let narrative = null;
    try {
      narrative = await _insBuildNarrativeAI(env, {sentiment, news, biggestMover: angle.biggestMover, sessMeta, angle});
      console.log('Insight: AI narrative generated successfully');
    } catch (e) {
      console.log('Insight: AI narrative failed, using template fallback:', e.message);
    }

    // Derive slug from AI page_title for unique URLs; fall back to formulaic angle.slug
    const indexHeadline = (narrative && narrative.pageTitle) ? narrative.pageTitle : sessionHeadline;
    let slugTail = angle.slug;
    if (narrative && narrative.pageTitle) {
      slugTail = narrative.pageTitle
        .toLowerCase()
        .replace(/[''ʼ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    }
    const slug = `${today}-${sessMeta.short}-${slugTail}`;

    const articleHtml = _insRenderArticle({ headline: sessionHeadline, slug, summary: sessionSummary, sentiment, news, biggestMover: angle.biggestMover, dateISO, dateLabel, category: sessionCategory, narrative });

    // 4. Word count check
    const text = articleHtml.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
    const wordCount = text.split(' ').length;
    if (wordCount < 500) throw new Error(`Article too short: ${wordCount} words (need 500+)`);
    console.log(`Insight: generated ${wordCount} words, slug=${slug}`);

    // 5. Build articlesMeta from articles.json manifest (real titles/summaries)
    //    Prepend the new article, then merge with stored manifest entries.
    const newEntry = { slug, headline: indexHeadline, summary: sessionSummary, dateISO, dateLabel, category: sessionCategory };

    let storedEntries = [];
    try {
      const manifestRaw = await _insGetFile(env, 'insight/articles.json');
      if (manifestRaw) storedEntries = JSON.parse(manifestRaw);
    } catch (_) {}

    // Merge: new entry first, then stored entries excluding this slug, cap at 50
    const articlesMeta = [newEntry, ...storedEntries.filter(e => e.slug !== slug)].slice(0, 50);

    // Write updated manifest back (included in commit below)
    const updatedManifest = JSON.stringify(articlesMeta, null, 2);


    // 6. Build sitemap update
    const oldSitemap = (await _insGetFile(env, 'sitemap.xml')) || '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>';
    let newSitemap = oldSitemap;
    if (!newSitemap.includes(`/insight/${slug}`)) {
      const entry = `  <url><loc>${_INS_SITE}/insight/${slug}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
      newSitemap = newSitemap.replace('</urlset>', entry + '\n</urlset>');
    }

    // 7. Build OG image SVG then convert to PNG for social card.
    // PNG is required — Twitter/LinkedIn reject SVG as og:image.
    // Falls back gracefully: if conversion fails the article still
    // publishes and og:image uses the per-currency PNG instead.
    const ogSvg = _insBuildOgSvg({
      headline: angle.headline,
      sessionShort: sessMeta.short,
      dateLabel,
      biggestMover: angle.biggestMover
    });
    let ogFileEntry = { path: `og/insight/${slug}.svg`, content: ogSvg };
    let ogImageOverride = null;
    try {
      const ogPngBytes = await _svgToPng(ogSvg);
      const ogPngBase64 = _uint8ToBase64(ogPngBytes);
      ogFileEntry = { path: `og/insight/${slug}.png`, content: ogPngBase64, binary: true };
      ogImageOverride = `${_INS_SITE}/og/insight/${slug}.png`;
      console.log(`Insight: OG PNG generated (${ogPngBytes.length} bytes)`);
    } catch (e) {
      console.log('Insight: SVG→PNG failed, falling back to SVG + currency PNG:', e.message);
    }

    // Rebuild article HTML now that we know the final og:image URL
    const finalArticleHtml = _insRenderArticle({
      headline: sessionHeadline, slug, summary: sessionSummary,
      sentiment, news, biggestMover: angle.biggestMover,
      dateISO, dateLabel, category: sessionCategory,
      narrative, ogImageOverride
    });

    // 8. Commit all files
    const sha = await _insCommitFiles(env, [
      { path: `insight/${slug}.html`, content: finalArticleHtml },
      ogFileEntry,
      { path: 'insight/articles.json', content: updatedManifest },
      { path: 'insight/index.html', content: _insRenderIndex(articlesMeta) },
      { path: 'insight/rss.xml', content: _insRenderRss(articlesMeta) },
      { path: 'sitemap.xml', content: newSitemap }
    ], `Daily insight (${sessMeta.label}): ${indexHeadline}`);

    console.log(`Insight: committed ${sha.slice(0,7)} - ${slug}`);
    return { ok: true, slug, sha, wordCount };
  } catch (e) {
    console.error('Insight: FAILED -', e.message);
    await _insSendFailureEmail(env, e, 'generateDailyInsight');
    return { ok: false, error: e.message };
  }
}

// ============================================================
// ADMIN PANEL DATA ENDPOINT
// ============================================================
// Read-only. Lists Firebase Auth users + Firestore subscription tiers.
// Gated by Firebase ID token (caller must be signed in) AND email
// must match ADMIN_EMAIL allowlist. Does NOT modify any data.
async function handleAdminData(request, env) {
  const ADMIN_EMAILS = ['dineshsanther123gf@gmail.com'];
  const FIREBASE_API_KEY = env.FIREBASE_API_KEY || 'AIzaSyD88nfD-GSk2icxgPMqOHOuLjCM19Zzso4';
  const PROJECT_ID = env.FIREBASE_PROJECT_ID || 'fxnewsbias';
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return new Response(JSON.stringify({error: 'POST only'}), { status: 405, headers: cors });
  try {
    const { idToken } = await request.json();
    if (!idToken) return new Response(JSON.stringify({error: 'idToken required'}), { status: 400, headers: cors });
    // 1. Verify ID token via Firebase REST
    const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(25000)
    });
    const verifyData = await verifyRes.json();
    const callerEmail = verifyData?.users?.[0]?.email;
    if (!callerEmail) return new Response(JSON.stringify({error: 'invalid token'}), { status: 401, headers: cors });
    if (!ADMIN_EMAILS.includes(callerEmail.toLowerCase())) {
      return new Response(JSON.stringify({error: 'forbidden'}), { status: 403, headers: cors });
    }
    // 2. Get OAuth token for server-side Firebase APIs
    const oauthToken = await getFirebaseToken(env);
    if (!oauthToken) return new Response(JSON.stringify({error: 'firebase auth failed'}), { status: 500, headers: cors });
    // 3. List all Firebase Auth users (paginated, max 500/page)
    const allUsers = [];
    let nextPageToken = '';
    for (let page = 0; page < 20; page++) {
      const body = { targetProjectId: PROJECT_ID, maxResults: 500 };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=500${nextPageToken ? '&nextPageToken=' + encodeURIComponent(nextPageToken) : ''}`, {
        headers: { 'Authorization': `Bearer ${oauthToken}` }, signal: AbortSignal.timeout(25000)
      });
      const d = await r.json();
      if (d.users) allUsers.push(...d.users);
      if (!d.nextPageToken) break;
      nextPageToken = d.nextPageToken;
    }
    // 4. List Firestore subscriptions
    const subsByEmail = {};
    try {
      const fsRes = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/subscriptions?pageSize=500`, {
        headers: { 'Authorization': `Bearer ${oauthToken}` }
      });
      const fsData = await fsRes.json();
      (fsData.documents || []).forEach(doc => {
        const f = doc.fields || {};
        const email = f.email?.stringValue;
        if (!email) return;
        subsByEmail[email.toLowerCase()] = {
          isPro: f.isPro?.booleanValue === true,
          plan: f.plan?.stringValue || 'free',
          stripeCustomerId: f.stripeCustomerId?.stringValue || '',
          updatedAt: f.updatedAt?.stringValue || '',
          currentPeriodEnd: f.currentPeriodEnd?.stringValue || '',
          cancelAtPeriodEnd: f.cancelAtPeriodEnd?.booleanValue === true
        };
      });
    } catch (e) {
      console.log('Firestore subs fetch failed:', e.message);
    }
    // 5. Merge — return clean rows
    const rows = allUsers.map(u => {
      const email = (u.email || '').toLowerCase();
      const sub = subsByEmail[email] || { isPro: false, plan: 'free', stripeCustomerId: '', updatedAt: '', currentPeriodEnd: '', cancelAtPeriodEnd: false };
      const providers = (u.providerUserInfo || []).map(p => p.providerId).join(',') || 'password';
      return {
        uid: u.localId,
        email: u.email || '',
        displayName: u.displayName || '',
        emailVerified: u.emailVerified === true,
        providers,
        createdAt: u.createdAt ? new Date(parseInt(u.createdAt)).toISOString() : '',
        lastLoginAt: u.lastLoginAt ? new Date(parseInt(u.lastLoginAt)).toISOString() : '',
        disabled: u.disabled === true,
        tier: sub.isPro ? 'pro' : 'free',
        stripeCustomerId: sub.stripeCustomerId,
        proUpdatedAt: sub.updatedAt,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd
      };
    });
    rows.sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const stats = {
      total: rows.length,
      pro: rows.filter(r => r.tier === 'pro').length,
      free: rows.filter(r => r.tier === 'free').length,
      verified: rows.filter(r => r.emailVerified).length,
      googleSignIn: rows.filter(r => r.providers.includes('google.com')).length,
      last7d: rows.filter(r => r.createdAt && (Date.now() - new Date(r.createdAt).getTime()) < 7*86400e3).length,
      last30d: rows.filter(r => r.createdAt && (Date.now() - new Date(r.createdAt).getTime()) < 30*86400e3).length,
    };
    return new Response(JSON.stringify({ ok: true, stats, users: rows, generatedAt: new Date().toISOString() }), { status: 200, headers: cors });
  } catch (e) {
    console.error('admin-data error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

// ============================================
// SEO ARTICLE GENERATION (Claude Haiku)
// ============================================

const SEO_CURRENCIES = [
  { slug:'ccy-usd', code:'USD', name:'US Dollar',          bank:'Federal Reserve (Fed)',                  pairs:'EUR/USD, USD/JPY, GBP/USD', keywords:'usd sentiment today, us dollar bias today, dollar forecast, usd fundamental analysis' },
  { slug:'ccy-eur', code:'EUR', name:'Euro',                bank:'European Central Bank (ECB)',             pairs:'EUR/USD, EUR/GBP, EUR/JPY', keywords:'eur sentiment today, euro bias today, euro forecast, eur fundamental analysis' },
  { slug:'ccy-gbp', code:'GBP', name:'British Pound',       bank:'Bank of England (BoE)',                  pairs:'GBP/USD, EUR/GBP, GBP/JPY', keywords:'gbp sentiment today, pound bias today, sterling forecast, gbp fundamental analysis' },
  { slug:'ccy-jpy', code:'JPY', name:'Japanese Yen',        bank:'Bank of Japan (BoJ)',                    pairs:'USD/JPY, EUR/JPY, GBP/JPY', keywords:'jpy sentiment today, yen bias today, japanese yen forecast, jpy fundamental analysis' },
  { slug:'ccy-aud', code:'AUD', name:'Australian Dollar',   bank:'Reserve Bank of Australia (RBA)',        pairs:'AUD/USD, AUD/JPY, AUD/NZD', keywords:'aud sentiment today, aussie bias today, australian dollar forecast, aud fundamental analysis' },
  { slug:'ccy-cad', code:'CAD', name:'Canadian Dollar',     bank:'Bank of Canada (BoC)',                   pairs:'USD/CAD, CAD/JPY',           keywords:'cad sentiment today, loonie bias today, canadian dollar forecast, cad fundamental analysis' },
  { slug:'ccy-chf', code:'CHF', name:'Swiss Franc',         bank:'Swiss National Bank (SNB)',              pairs:'USD/CHF, EUR/CHF, CHF/JPY', keywords:'chf sentiment today, franc bias today, swiss franc forecast, chf fundamental analysis' },
  { slug:'ccy-nzd', code:'NZD', name:'New Zealand Dollar',  bank:'Reserve Bank of New Zealand (RBNZ)',    pairs:'NZD/USD, AUD/NZD',           keywords:'nzd sentiment today, kiwi bias today, new zealand dollar forecast, nzd fundamental analysis' },
];

async function generateCurrencySEO(ccy, sentData, headlines, env) {
  const dateStr  = new Date().toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const dateShort = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  const score   = sentData.score || 50;
  const bias    = sentData.bias  || 'Neutral';
  const drivers = (Array.isArray(sentData.drivers) ? sentData.drivers : []).slice(0,3).join('; ') || 'mixed signals across the board';
  const headlineList = headlines.length ? headlines.slice(0,5).map((h,i)=>`${i+1}. ${h}`).join('\n') : 'No major headlines in this window.';

  const prompt = `You are a senior FX analyst at a major bank writing the "What Is Driving the ${ccy.code} Today" section of a live market page on ${dateStr}.

Current ${ccy.code} data:
- Sentiment score: ${score}/100 (${bias})
- Key drivers: ${drivers}
- Recent headlines:\n${headlineList}

Write exactly 2 short paragraphs using ONLY <p> and <strong> tags. No headings, no lists, no other tags.

Paragraph 1: What the ${ccy.name} is doing right now — reference the score (${score}/100), the bias (${bias}), specific drivers. Be direct and data-specific.
Paragraph 2: What to watch — upcoming catalysts, key risks, best ${ccy.code} pairs to track (${ccy.pairs}).

Hard rules:
- Never write "as of [date]", "it is worth noting", "it is important to", "in conclusion", "furthermore", "it is clear that"
- No markdown symbols. No bullet points.
- Confident, direct tone — no fluff. Vary sentence length.
- Naturally include: ${ccy.keywords}
- 120–170 words total.

Return ONLY valid JSON (no markdown, no code fences):
{"page_title":"<max 65 chars — STRICT format: '${ccy.code} ${bias} ${score}/100 | [CATALYST] — ${dateShort}'. CATALYST must name a specific real-world event from the headlines (e.g. named data print, central bank decision, specific inflation figure, named geopolitical event). BANNED in title (any = failure): 'Rate Expectations', 'Strength', 'Weakness', 'Sentiment Shift', 'Markets Await', 'Rate Divergence', 'Risk Appetite', 'Risk Sentiment', score notation like '72/100' outside the fixed slot. Rules: (1) Em dash — before date, never a plain hyphen. (2) Write BoJ not BOJ, BoE not BOE, BoC not BOC. (3) No brand suffix.>","html":"<the two paragraphs>"}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) throw new Error(`Haiku currency SEO ${ccy.code}: ${resp.status}`);
  const data = await resp.json();
  const raw = data.content?.[0]?.text?.trim() || '';
  let pageTitle = '', html = raw;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { const p = JSON.parse(jsonMatch[0]); pageTitle = p.page_title||''; html = p.html||raw; } catch(_) {}
  }
  if (!pageTitle) pageTitle = `${ccy.code} ${bias} | ${ccy.name} Sentiment — ${dateShort}`;
  pageTitle = pageTitle.replace(/ - FXNewsBias$/i, '').replace(/ [-–] (\d)/, ' — $1').replace(/\bBOJ\b/g, 'BoJ').replace(/\bBOE\b/g, 'BoE').replace(/\bBOC\b/g, 'BoC');
  return { pageTitle, html };
}

async function generateAllCurrencySEO(env, opts = {}) {
  const { cycleTs } = opts;
  await withRetry('currencySEO', async () => {
    const sentResp = await fetch(`${env.SUPABASE_URL}/rest/v1/sentiment?select=currency,score,bias,drivers&order=id.desc&limit=16`, {
      headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(25000),
    });
    const sentRows = sentResp.ok ? await sentResp.json() : [];
    const sentMap = {};
    for (const row of sentRows) {
      if (!sentMap[row.currency]) sentMap[row.currency] = { score: row.score||50, bias: row.bias||'Neutral', drivers: row.drivers||[] };
    }

    const cutoff = new Date(Date.now() - 6*60*60*1000).toISOString(); // 6h window to tolerate staggered cron
    const newsResp = await fetch(`${env.SUPABASE_URL}/rest/v1/news?select=title,currencies_affected&fetched_at=gte.${cutoff}&order=fetched_at.desc&limit=50`, {
      headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(25000),
    });
    const newsRows = newsResp.ok ? await newsResp.json() : [];
    console.log(`generateAllCurrencySEO: ${sentRows.length} sentiment rows, ${newsRows.length} headlines`);

    const titleUpdates = [];
    const CCY_BATCH = 4;
    for (let ci = 0; ci < SEO_CURRENCIES.length; ci += CCY_BATCH) {
      const ccyBatch = SEO_CURRENCIES.slice(ci, ci + CCY_BATCH);
      await Promise.all(ccyBatch.map(async (ccy) => {
        try {
          const sentData = sentMap[ccy.code] || { score: 50, bias: 'Neutral', drivers: [] };
          const relevant = newsRows.filter(n => (n.currencies_affected||[]).includes(ccy.code)).map(n=>n.title);
          const others   = newsRows.filter(n => !(n.currencies_affected||[]).includes(ccy.code)).map(n=>n.title);
          const headlines = [...relevant, ...others].filter(Boolean).slice(0,5);
          const { pageTitle, html } = await generateCurrencySEO(ccy, sentData, headlines, env);
          if (html) {
            try { await saveSEOCache(ccy.slug, html, env); } catch(ce) { console.log(`cache ${ccy.code}:`, ce.message); }
            console.log(`Currency SEO cached: ${ccy.code} (${sentData.bias} ${sentData.score}/100) — title: ${pageTitle}`);
          }
          if (pageTitle) titleUpdates.push({ path: `currencies/${ccy.code.toLowerCase()}/index.html`, pageTitle, ccy, sentData });
        } catch(e) {
          console.log(`Currency SEO error for ${ccy.code}:`, e.message);
        }
      }));
      if (ci + CCY_BATCH < SEO_CURRENCIES.length) await new Promise(r => setTimeout(r, 600));
    }

    // Patch <title>, og:title, twitter:title in each static HTML file and commit as one batch
    if (titleUpdates.length > 0) {
      try {
        const fileContents = await Promise.all(titleUpdates.map(({ path }) => _insGetFile(env, path)));
        const filesToCommit = [];
        for (let i = 0; i < titleUpdates.length; i++) {
          const { path, pageTitle, ccy, sentData } = titleUpdates[i];
          const current = fileContents[i];
          if (!current) { console.log(`Currency title patch: file not found ${path}`); continue; }
          const safe = pageTitle.replace(/"/g, '&quot;');

          // Extract catalyst from title: "CODE BIAS SCORE/100 | CATALYST — DATE"
          const catMatch = pageTitle.match(/[|:]\s*(.+?)\s*(?:[—–-]|\|)\s*\d/);
          const catalyst = catMatch ? catMatch[1].trim() : `${ccy.name} market analysis`;
          const bias = sentData.bias || 'Neutral';
          const score = sentData.score || 50;
          const dateShort = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

          // Dynamic meta description (max 155 chars)
          const descRaw = `${ccy.code} (${ccy.name}) is ${bias} today (${score}/100). ${catalyst}. Live news-based forex sentiment & bias — ${dateShort}.`;
          const safeDesc = descRaw.replace(/"/g, '&quot;').slice(0, 155);

          // H1: keep flag span, replace static "CODE Sentiment & NAME Bias" with bias + score + catalyst
          const h1Text = `${ccy.code} ${bias} — ${catalyst}`;

          const patched = current
            .replace(/<title>[^<]*<\/title>/, `<title>${safe}</title>`)
            .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${safe}">`)
            .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${safe}">`)
            .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${safeDesc}">`)
            .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${safeDesc}">`)
            .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${safeDesc}">`)
            .replace(/(<h1[^>]*><span[^>]*>[^<]*<\/span>\s*)[^<]*(<\/h1>)/, `$1${h1Text}$2`);
          filesToCommit.push({ path, content: patched });
        }
        if (filesToCommit.length > 0) {
          const dateLabel = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
          await _insCommitFiles(env, filesToCommit, `seo: update currency page titles — ${dateLabel}`);
          console.log(`Currency SEO: committed ${filesToCommit.length} title patches`);
        }
      } catch(e) {
        console.log('Currency SEO title commit error:', e.message);
      }
    }

    console.log('generateAllCurrencySEO: done');
  }, env, cycleTs);
}

const SEO_PAIRS = [
  { slug: 'eur-usd',  name: 'EUR/USD', base: 'EUR', quote: 'USD', keywords: 'eurusd fundamental bias analysis, eurusd sentiment today, eurusd bias today' },
  { slug: 'gbp-usd',  name: 'GBP/USD', base: 'GBP', quote: 'USD', keywords: 'gbpusd sentiment today, gbpusd bias analysis, cable forex today' },
  { slug: 'usd-jpy',  name: 'USD/JPY', base: 'USD', quote: 'JPY', keywords: 'usdjpy sentiment today, usdjpy bias analysis, dollar yen forecast today' },
  { slug: 'usd-chf',  name: 'USD/CHF', base: 'USD', quote: 'CHF', keywords: 'usd to chf forecast, usd chf forecast, usd chf sentiment' },
  { slug: 'aud-usd',  name: 'AUD/USD', base: 'AUD', quote: 'USD', keywords: 'aud usd sentiment, aud usd bias analysis, audusd today' },
  { slug: 'usd-cad',  name: 'USD/CAD', base: 'USD', quote: 'CAD', keywords: 'usdcad sentiment today, usdcad bias analysis, loonie forex today' },
  { slug: 'nzd-usd',  name: 'NZD/USD', base: 'NZD', quote: 'USD', keywords: 'nzdusd sentiment today, nzdusd bias analysis, kiwi forex today' },
  { slug: 'eur-gbp',  name: 'EUR/GBP', base: 'EUR', quote: 'GBP', keywords: 'eurgbp sentiment today, eurgbp bias analysis, euro sterling today' },
  { slug: 'eur-jpy',  name: 'EUR/JPY', base: 'EUR', quote: 'JPY', keywords: 'eurjpy sentiment today, eurjpy bias analysis, euro yen today' },
  { slug: 'gbp-jpy',  name: 'GBP/JPY', base: 'GBP', quote: 'JPY', keywords: 'current trend bias gbpjpy, gbpjpy sentiment today, pound yen today' },
  { slug: 'aud-jpy',  name: 'AUD/JPY', base: 'AUD', quote: 'JPY', keywords: 'audjpy sentiment today, audjpy bias analysis, aussie yen today' },
  { slug: 'aud-nzd',  name: 'AUD/NZD', base: 'AUD', quote: 'NZD', keywords: 'audnzd sentiment today, audnzd bias analysis, aud nzd today' },
  { slug: 'eur-chf',  name: 'EUR/CHF', base: 'EUR', quote: 'CHF', keywords: 'eurchf sentiment today, eurchf bias analysis, euro franc today' },
  { slug: 'cad-jpy',  name: 'CAD/JPY', base: 'CAD', quote: 'JPY', keywords: 'cadjpy sentiment today, cadjpy bias analysis, cad jpy today' },
  { slug: 'chf-jpy',  name: 'CHF/JPY', base: 'CHF', quote: 'JPY', keywords: 'chfjpy sentiment today, chfjpy bias analysis, franc yen today' },
];

async function generatePairSEO(pair, score, headlines, env) {
  const dateStr   = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const dateShort = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const biasLabel = score > 10 ? 'Bullish' : score < -10 ? 'Bearish' : 'Neutral';
  const headlineList = headlines.length ? headlines.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n') : 'No major headlines at this time.';

  const prompt = `You are an expert forex analyst writing a concise, SEO-optimised market update for ${pair.name} on ${dateStr}.

Current data:
- Sentiment bias score: ${score} (${biasLabel} — positive = ${pair.base} strength, negative = ${pair.quote} strength)
- Key forex headlines (last 3 hours):\n${headlineList}

Write a 3-paragraph HTML article using ONLY these tags: <p>, <strong>, <ul>, <li>. No headings, no other tags.

Paragraph 1: Current ${pair.name} sentiment today — reference the bias score, explain what it means for direction.
Paragraph 2: Key drivers — name the SPECIFIC real-world event from the headlines above (e.g. a named data print, a central bank rate decision, a specific inflation figure, a named geopolitical development, a commodity price move). For cross pairs (e.g. EUR/JPY, GBP/JPY), name the distinct driver for EACH component currency — do not merge them into one generic phrase.
Paragraph 3: What to watch — forward-looking, mention next session, specific upcoming data or risk events if relevant.

Hard rules:
- Naturally include these keywords: ${pair.keywords}, live forex sentiment, forex bias today 2026, news-based forex analysis
- Keep it factual and data-driven. Do NOT invent specific price levels.
- Total length: 200–280 words.
- NEVER write vague phrases like "rate expectations", "strength dominates", "sentiment shift", "rate divergence", "[currency] strength", "risk sentiment", "risk appetite", "quiet markets", "no major headlines", "no major catalysts", "absence of data", "lack of data", "no data", "markets await" — if headlines are quiet, describe positioning, technical levels, or the macro backdrop instead.

Title rules — STRICT format: "${pair.name} ${biasLabel} Today | [CATALYST] — ${dateShort}"
CATALYST must name a specific named event, policy decision, data print, or macro theme. If headlines are quiet, describe the POSITIONING or TECHNICAL driver (e.g. "USD Holds Near 99 as Traders Await FOMC", "EUR Tests Support on Thin Volume"). Never acknowledge the absence of news. Max 65 chars total.
BANNED words/phrases in title (any = failure): "Rate Expectations", "Strength Dominates", "Sentiment Shift", "Rate Divergence", "CHF Strength", "USD Strength", "EUR Strength", "GBP Strength", "AUD Strength", "JPY Strength", "CAD Strength", "NZD Strength", "Risk Appetite", "Risk Sentiment", "Markets Await", "Sentiment Bullish", "Sentiment Bearish", "Sentiment Neutral", "Bias Today —" (without pipe), "No Major", "Absence of", "Lack of", "No Data", "No Catalyst", "Quiet Session", score notation like "72/100".
Rules: (1) Em dash — before date, never a plain hyphen. (2) Write BoJ not BOJ, BoE not BOE, BoC not BOC, SNB not snb. (3) No brand suffix. (4) ALWAYS use format "PAIR Bullish/Bearish/Neutral Today | CATALYST — DATE" — never "Sentiment Bullish" or "Bias Today —".

Return ONLY valid JSON (no markdown, no code fences):
{"page_title":"<title here>","html":"<the three paragraphs>"}`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 750, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  });
  if (!resp.ok) throw new Error(`Haiku SEO ${pair.slug}: ${resp.status}`);
  const data = await resp.json();
  const raw = data.content?.[0]?.text?.trim() || '';
  let pageTitle = '', html = raw;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { const p = JSON.parse(jsonMatch[0]); pageTitle = p.page_title||''; html = p.html||raw; } catch(_) {}
  }
  if (!pageTitle) pageTitle = `${pair.name} ${biasLabel} Bias Today | ${pair.name} Sentiment — ${dateShort}`;
  pageTitle = pageTitle.replace(/ - FXNewsBias$/i, '').replace(/ [-–] (\d)/, ' — $1').replace(/\bBOJ\b/g, 'BoJ').replace(/\bBOE\b/g, 'BoE').replace(/\bBOC\b/g, 'BoC');
  return { pageTitle, html };
}

async function saveSEOCache(slug, html, env) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/seo_cache`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ slug, html, updated_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`saveSEOCache ${slug}: ${r.status} ${t.slice(0, 200)}`);
  }
}


async function generateAllPairSEO(env, opts = {}) {
  const { cycleTs } = opts;
  await withRetry('pairSEO', async () => {
    const sentResp = await fetch(`${env.SUPABASE_URL}/rest/v1/sentiment?select=currency,score,bias&order=created_at.desc&limit=16`, {
      headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(25000),
    });
    const sentRows = sentResp.ok ? await sentResp.json() : [];
    const sentMap = {};
    for (const row of sentRows) {
      if (!sentMap[row.currency]) sentMap[row.currency] = { score: row.score || 0, bias: row.bias || 0 };
    }

    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // 6h window to tolerate staggered cron
    const newsResp = await fetch(`${env.SUPABASE_URL}/rest/v1/news?select=title,currencies_affected&fetched_at=gte.${cutoff}&order=fetched_at.desc&limit=50`, {
      headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      signal: AbortSignal.timeout(25000),
    });
    const newsRows = newsResp.ok ? await newsResp.json() : [];
    console.log(`generateAllPairSEO: ${sentRows.length} sentiment rows, ${newsRows.length} headlines`);

    const titleUpdates = [];
    const BATCH = 3;
    for (let i = 0; i < SEO_PAIRS.length; i += BATCH) {
      const batch = SEO_PAIRS.slice(i, i + BATCH);
      await Promise.all(batch.map(async (pair) => {
        try {
          const baseData = sentMap[pair.base] || { score: 0 };
          const quoteData = sentMap[pair.quote] || { score: 0 };
          const pairScore = Math.round((baseData.score||0) - (quoteData.score||0));
          // Filter headlines: pair-relevant first, then global macro fallback (mirrors currency approach)
          const relevant = newsRows.filter(n => { const c = n.currencies_affected||[]; return c.includes(pair.base) || c.includes(pair.quote); }).map(n => n.title);
          const others   = newsRows.filter(n => { const c = n.currencies_affected||[]; return !c.includes(pair.base) && !c.includes(pair.quote); }).map(n => n.title);
          const pairHeadlines = [...relevant, ...others].filter(Boolean).slice(0, 6);
          const { pageTitle, html } = await generatePairSEO(pair, pairScore, pairHeadlines, env);
          if (html) {
            try { await saveSEOCache(pair.slug, html, env); } catch(ce) { console.log(`cache ${pair.slug}:`, ce.message); }
            console.log(`SEO processed: ${pair.slug} — title: ${pageTitle}`);
          }
          if (pageTitle) titleUpdates.push({ path: `pairs/${pair.slug}/index.html`, pageTitle, pair, pairScore });
        } catch (e) { console.log(`SEO gen error for ${pair.slug}:`, e.message); }
      }));
      if (i + BATCH < SEO_PAIRS.length) await new Promise(r => setTimeout(r, 1000));
    }

    // Patch <title>, og:title, twitter:title in each static HTML file and commit as one batch
    if (titleUpdates.length > 0) {
      try {
        const fileContents = await Promise.all(titleUpdates.map(({ path }) => _insGetFile(env, path)));
        const filesToCommit = [];
        for (let i = 0; i < titleUpdates.length; i++) {
          const { path, pageTitle, pair, pairScore } = titleUpdates[i];
          const current = fileContents[i];
          if (!current) { console.log(`Pair title patch: file not found ${path}`); continue; }
          const safe = pageTitle.replace(/"/g, '&quot;');

          // Extract catalyst from title: "PAIR BIAS Today | CATALYST — DATE" or "...: CATALYST — DATE"
          const catMatch = pageTitle.match(/[|:]\s*(.+?)\s*[—–-]\s*\d/) ;
          const catalyst = catMatch ? catMatch[1].trim() : `${pair.name} forex sentiment`;
          const biasLabel = pairScore > 10 ? 'Bullish' : pairScore < -10 ? 'Bearish' : 'Neutral';
          const dateShort = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

          // Dynamic meta description (max 155 chars)
          const descRaw = `${pair.name} is ${biasLabel} today. ${catalyst}. Live news-based forex sentiment & bias for traders — ${dateShort}.`;
          const safeDesc = descRaw.replace(/"/g, '&quot;').slice(0, 155);

          // H1: keep flag span, replace static "Sentiment Today" with bias + catalyst
          const h1Text = `${pair.name} ${biasLabel} Today — ${catalyst}`;

          const patched = current
            .replace(/<title>[^<]*<\/title>/, `<title>${safe}</title>`)
            .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${safe}">`)
            .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${safe}">`)
            .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${safeDesc}">`)
            .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${safeDesc}">`)
            .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${safeDesc}">`)
            .replace(/(<h1[^>]*><span[^>]*>[^<]*<\/span>\s*)[^<]*(<\/h1>)/, `$1${h1Text}$2`);
          filesToCommit.push({ path, content: patched });
        }
        if (filesToCommit.length > 0) {
          const dateLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          await _insCommitFiles(env, filesToCommit, `seo: update pair page titles — ${dateLabel}`);
          console.log(`Pair SEO: committed ${filesToCommit.length} title patches`);
        }
      } catch(e) {
        console.log('Pair SEO title commit error:', e.message);
      }
    }

    console.log('generateAllPairSEO: done');
  }, env, cycleTs);
}
