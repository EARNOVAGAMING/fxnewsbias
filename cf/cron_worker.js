// FXNewsBias Sentiment Worker
// Handles: sentiment analysis, prices, Telegram alerts, Stripe webhooks, Firebase Pro updates

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
await runSentimentAnalysis(env);
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
if (url.pathname === '/run-insight') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await generateDailyInsight(env);
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
// Weekly Pro report endpoint — public, edge-cached 6h
if (url.pathname === '/api/weekly-report') {
return handleWeeklyReport(request, env, ctx);
}
return new Response('FXNewsBias Cron Worker Running', { status: 200 });
},

async scheduled(event, env, ctx) {
// Two cron triggers:
//   '0 */3 * * *'  -> sentiment analysis (every 3 hours)
//   '*/15 * * * *' -> price updates + staleness check (every 15 minutes)
const tasks = [];
if (event.cron === '0 6 * * *') {
// Daily insight generator — runs at 06:00 UTC, before London open.
tasks.push(generateDailyInsight(env).catch(e => console.log('Daily insight error:', e.message)));
} else if (event.cron === '0 */3 * * *') {
tasks.push(runSentimentAnalysis(env));
tasks.push(updatePrices(env));
// Once every 3 hours is plenty for a retention sweep — system_state is
// tiny and only needs to be pruned occasionally.
tasks.push(cleanupSystemState(env).catch(e => console.log('Cleanup error:', e.message)));
// News and sentiment grow unbounded with every cron tick — sweep them
// on the same 3-hourly cadence so the Supabase tables stay manageable.
tasks.push(cleanupNews(env).catch(e => console.log('cleanupNews error:', e.message)));
tasks.push(cleanupSentiment(env).catch(e => console.log('cleanupSentiment error:', e.message)));
// The cleanup_runs history table itself accumulates ~24 rows/day forever
// (3 tables x 8 sweeps/day) — sweep it on the same tick so it stays
// bounded. See cleanupCleanupRuns for retention details.
tasks.push(cleanupCleanupRuns(env).catch(e => console.log('cleanupCleanupRuns error:', e.message)));
} else {
tasks.push(updatePrices(env));
}
// Always run the staleness check so a stalled sentiment cron still gets noticed.
tasks.push(checkSentimentFreshness(env).catch(e => console.log('Staleness check error:', e.message)));
ctx.waitUntil(Promise.all(tasks));
}
};

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
if (customerEmail) {
await updateUserProStatus(customerEmail, customerId, true, env);
console.log('Pro activated for:', customerEmail);
}
break;
}
case 'customer.subscription.created':
case 'customer.subscription.updated': {
const subscription = event.data.object;
const customerId = subscription.customer;
const isActive = subscription.status === 'active';
const customerEmail = await getStripeCustomerEmail(customerId, env);
if (customerEmail) {
await updateUserProStatus(customerEmail, customerId, isActive, env);
console.log('Subscription', subscription.status, 'for:', customerEmail);
}
break;
}
case 'customer.subscription.deleted': {
const subscription = event.data.object;
const customerId = subscription.customer;
const customerEmail = await getStripeCustomerEmail(customerId, env);
if (customerEmail) {
await updateUserProStatus(customerEmail, customerId, false, env);
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
async function updateUserProStatus(email, stripeCustomerId, isPro, env) {
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
plan: { stringValue: isPro ? 'pro' : 'free' }
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
body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
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
async function runSentimentAnalysis(env) {
console.log('Starting sentiment analysis...');
try {
const news = await fetchAllNews();
console.log(`Fetched ${news.length} news items from 12 sources`);
const sentiment = await analyzeSentiment(news, env);
console.log('Sentiment analysis complete');

// Each downstream step is isolated - one failing must not block the others.
// Telegram (user-visible) is fired FIRST so a saveNews/saveSentiment hiccup
// can never silently kill the alert (this has bitten us twice already).
try { await sendTelegramAlert(env, sentiment); console.log('Telegram alert sent'); }
catch(e) { console.log('Telegram step failed:', e.message); }

try { await saveSentiment(sentiment, env); console.log('Sentiment saved'); }
catch(e) { console.log('saveSentiment failed:', e.message); }

try { await saveNews(news, env); console.log('News saved'); }
catch(e) { console.log('saveNews failed:', e.message); }
} catch (error) {
console.error('Error in sentiment analysis (top-level):', error && error.message);
}
}

// ============================================
// SENTIMENT FRESHNESS / STALENESS ALERTING
// ============================================
// Compares the latest sentiment.created_at to the observed cadence and
// notifies the team (Telegram + optional generic webhook) when the feed is
// more than ~1.5 cycles late. Alerts fire ONCE per incident — incident state
// is keyed on the id of the stale latest-sentiment row, persisted in a small
// `system_state` table in Supabase. When a fresh row arrives the alert is
// auto-resolved and a recovery message is sent.
//
// Required Supabase table (one-time, run as SQL):
//   create table if not exists system_state (
//     key text primary key,
//     value jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//
// Optional env vars (in addition to TELEGRAM_BOT_TOKEN/TELEGRAM_CHANNEL_ID):
//   STALENESS_WEBHOOK_URL   - optional generic webhook (Slack-compatible JSON)
//   SLACK_WEBHOOK_URL       - optional Slack incoming webhook URL
//   ALERT_EMAIL_TO          - optional comma-separated list of recipient emails
//                             (requires RESEND_API_KEY; uses ALERT_EMAIL_FROM or
//                              CONTACT_FROM_EMAIL or 'noreply@fxnewsbias.com')
//   SENTIMENT_CADENCE_MS    - override cadence (default: derived, fallback 3h)
//   STALENESS_MULTIPLIER    - override multiplier (default 1.5)
async function checkSentimentFreshness(env) {
const STATE_KEY = 'sentiment_alert';
const DEFAULT_CADENCE_MS = 3 * 60 * 60 * 1000; // 3 hours
const multiplier = parseFloat(env.STALENESS_MULTIPLIER) || 1.5;

// Pull the most recent few rows so we can both detect the latest update
// and estimate the observed cadence between scheduled runs.
const resp = await fetch(
`${env.SUPABASE_URL}/rest/v1/sentiment?select=id,currency,created_at&order=created_at.desc&limit=20`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
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
cadenceMs = gaps[Math.floor(gaps.length / 2)]; // median
}
if (!cadenceMs || cadenceMs <= 0) cadenceMs = DEFAULT_CADENCE_MS;
}

const thresholdMs = Math.round(cadenceMs * multiplier);
const isStale = ageMs > thresholdMs;

const prevState = await readSystemState(env, STATE_KEY);
const activeAlertId = prevState && prevState.active_for_id ? prevState.active_for_id : null;

const summary = {
ok: true,
latest_id: latest.id,
latest_at: latest.created_at,
age_minutes: Math.round(ageMs / 60000),
cadence_minutes: Math.round(cadenceMs / 60000),
threshold_minutes: Math.round(thresholdMs / 60000),
stale: isStale,
alert_active_for_id: activeAlertId
};

if (isStale) {
// Only fire once per incident — keyed on the id of the stuck "latest" row.
if (activeAlertId === latest.id) {
console.log('Staleness: still stale, alert already sent for sentiment id', latest.id);
summary.action = 'noop-already-alerted';
return summary;
}
const lateBy = ageMs - cadenceMs;
const text = `🚨 *FXNewsBias sentiment feed is stalled*\n\n`
+ `Latest sentiment row: \`${latest.created_at}\`\n`
+ `Age: *${Math.round(ageMs / 60000)} min* (cadence ~${Math.round(cadenceMs / 60000)} min, `
+ `threshold ${Math.round(thresholdMs / 60000)} min)\n`
+ `Late by: *${Math.round(lateBy / 60000)} min*\n\n`
+ `The sentiment cron has not produced a fresh row. Check the worker logs / Anthropic API / Supabase writes.`;
await sendStalenessNotification(env, text);
const startedAt = new Date().toISOString();
await writeSystemState(env, STATE_KEY, {
active_for_id: latest.id,
alerted_at: startedAt,
latest_at: latest.created_at,
age_minutes: summary.age_minutes,
threshold_minutes: summary.threshold_minutes
});
await recordIncidentStart(env, STATE_KEY, startedAt, {
sentiment_id: latest.id,
latest_at: latest.created_at,
age_minutes: summary.age_minutes,
cadence_minutes: summary.cadence_minutes,
threshold_minutes: summary.threshold_minutes,
late_by_minutes: Math.round(lateBy / 60000)
});
console.log('Staleness: alert sent for sentiment id', latest.id);
summary.action = 'alert-sent';
return summary;
}

// Fresh data: auto-resolve any active incident.
if (activeAlertId && activeAlertId !== latest.id) {
const text = `✅ *FXNewsBias sentiment feed recovered*\n\n`
+ `Fresh sentiment row at \`${latest.created_at}\` (age ${Math.round(ageMs / 60000)} min). Alerts resolved.`;
await sendStalenessNotification(env, text);
const resolvedAt = new Date().toISOString();
await recordIncidentResolved(env, STATE_KEY, resolvedAt, {
recovered_sentiment_id: latest.id,
latest_at: latest.created_at,
age_minutes_at_recovery: summary.age_minutes
});
await writeSystemState(env, STATE_KEY, {
active_for_id: null,
resolved_at: resolvedAt,
latest_at: latest.created_at
});
console.log('Staleness: incident resolved.');
summary.action = 'resolved';
return summary;
}

summary.action = 'fresh';
return summary;
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
body: JSON.stringify({
chat_id: env.TELEGRAM_CHANNEL_ID,
text,
parse_mode: 'Markdown',
disable_web_page_preview: true
})
})
});
}

if (env.STALENESS_WEBHOOK_URL) {
channels.push({
name: 'webhook',
send: () => fetch(env.STALENESS_WEBHOOK_URL, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ text })
})
});
}

if (env.SLACK_WEBHOOK_URL) {
channels.push({
name: 'slack',
send: () => fetch(env.SLACK_WEBHOOK_URL, {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ text, mrkdwn: true })
})
});
}

if (env.ALERT_EMAIL_TO && env.RESEND_API_KEY) {
const recipients = String(env.ALERT_EMAIL_TO)
.split(',')
.map(s => s.trim())
.filter(Boolean);
if (recipients.length) {
const fromEmail = env.ALERT_EMAIL_FROM || env.CONTACT_FROM_EMAIL || 'noreply@fxnewsbias.com';
const subject = /\bTEST\b/.test(text)
? 'FXNewsBias: test staleness alert'
: (/recovered/i.test(text)
? 'FXNewsBias: sentiment feed recovered'
: 'FXNewsBias: sentiment feed stalled');
const htmlBody = `<pre style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;white-space:pre-wrap;">${escapeHtml(text)}</pre>`;
channels.push({
name: 'email',
send: () => fetch('https://api.resend.com/emails', {
method: 'POST',
headers: {
'Authorization': `Bearer ${env.RESEND_API_KEY}`,
'Content-Type': 'application/json'
},
body: JSON.stringify({
from: `FXNewsBias Alerts <${fromEmail}>`,
to: recipients,
subject,
text,
html: htmlBody
})
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
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
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
}
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
}
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
}
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
}
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
body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
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
// WEEKLY PRO REPORT — aggregates 7-14 days of sentiment + Claude narrative
// =====================================================================
async function handleWeeklyReport(request, env, ctx) {
const cors = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Methods': 'GET, OPTIONS',
'Access-Control-Allow-Headers': 'Content-Type',
'Vary': 'Origin'
};
if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

const url = new URL(request.url);
const bypass = url.searchParams.get('refresh') === '1';
const cacheUrl = new URL(url.origin + '/api/weekly-report');
const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
const cache = caches.default;

if (!bypass) {
const cached = await cache.match(cacheKey);
if (cached) {
const r = new Response(cached.body, cached);
Object.entries(cors).forEach(([k,v]) => r.headers.set(k,v));
r.headers.set('X-Cache', 'HIT');
return r;
}
}

try {
const report = await buildWeeklyReport(env);
const body = JSON.stringify(report);
const resp = new Response(body, {
status: 200,
headers: {
'Content-Type': 'application/json',
'Cache-Control': 'public, max-age=21600',
...cors,
'X-Cache': 'MISS'
}
});
if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
return resp;
} catch (e) {
console.log('Weekly report build failed:', e.message, e.stack);
return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
status: 500, headers: { 'Content-Type': 'application/json', ...cors }
});
}
}

async function buildWeeklyReport(env) {
const now = new Date();
const weekStart = new Date(now); weekStart.setUTCDate(now.getUTCDate() - 7);
const lastWeekStart = new Date(now); lastWeekStart.setUTCDate(now.getUTCDate() - 14);

// Pull 14 days of sentiment for delta + this-week trend
const sentRes = await fetch(
`${env.SUPABASE_URL}/rest/v1/sentiment?select=created_at,currency,score,bias,drivers&created_at=gte.${lastWeekStart.toISOString()}&order=created_at.asc&limit=4000`,
{ headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
);
const sentData = await sentRes.json();

const newsRes = await fetch(
`${env.SUPABASE_URL}/rest/v1/news?select=title,source,created_at,impact&order=id.desc&limit=80`,
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

// Daily averages for sparkline (7 days)
const days = [];
for (let d = 6; d >= 0; d--) {
const dayStart = new Date(now); dayStart.setUTCDate(now.getUTCDate() - d); dayStart.setUTCHours(0,0,0,0);
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

const sampleNews = (newsData || []).slice(0, 30).map(n => `- [${n.source}] ${n.title}`).join('\n');

const ctxBlock = currencies.map(c => {
const p = perCurrency[c];
const arrow = p.delta === null ? '~' : p.delta > 2 ? 'UP' : p.delta < -2 ? 'DOWN' : 'flat';
return `${c}: this-wk avg ${p.this_week_avg} (${arrow} from ${p.last_week_avg ?? 'n/a'}), now ${p.current_score} ${p.current_bias}, ${p.bias_flips} bias flips, time bull/bear/neut: ${p.pct_bullish}%/${p.pct_bearish}%/${p.pct_neutral}%`;
}).join('\n');

const claudePrompt = `You are a senior FX strategist writing the FXNewsBias Pro Weekly Report for the week ending ${now.toISOString().slice(0,10)}.

PER-CURRENCY WEEK DATA (sentiment scores, 0=very bearish, 50=neutral, 100=very bullish):
${ctxBlock}

WEEK HIGHLIGHTS:
- Strongest currency now: ${strongest.currency} (${strongest.score})
- Weakest currency now: ${weakest.currency} (${weakest.score})
- Top gainer this week: ${topGainer.currency} (${topGainer.change > 0 ? '+' : ''}${topGainer.change} pts vs Mon open)
- Top loser this week: ${topLoser.currency} (${topLoser.change} pts)
- Most volatile (most bias flips): ${mostVolatile.currency} (${mostVolatile.flips} flips)

RECENT NEWS HEADLINES (last 30, most recent first):
${sampleNews}

Write a JSON response with three sections:

1. "narrative" — exactly 3 paragraphs in plain trader-friendly English (180-260 words total):
   • Para 1: What happened this week — tie the biggest sentiment moves to specific news/themes from the headlines above. Name names.
   • Para 2: Where the market stands now — what the strongest/weakest currencies imply, what regime we are in (risk-on / risk-off / mixed). Reference actual scores.
   • Para 3: Setup for next week — what to watch, key risks, what could change the picture.
   Use real specifics from the data, not generic phrases. Do not use the words "in conclusion" or "overall".

2. "key_events" — array of 4 to 7 high-impact economic events likely in the NEXT 7 days. Use the news context plus your knowledge of standard release schedules (NFP first Friday of month, FOMC meeting weeks, ECB calendar, BOE, BOJ etc.). For each: { "event": short name, "currency": 3-letter code, "day": "Mon"|"Tue"|"Wed"|"Thu"|"Fri", "impact": "High"|"Medium", "why": one-sentence trader takeaway }.

3. "regime_warning" — one sentence (max 30 words) flagging the single biggest risk for traders this week given current sentiment + news (e.g. "JPY intervention risk elevated near 155", "Watch Fed-speak whiplash with multiple FOMC members on circuit").

Respond ONLY with strict JSON, no markdown, no preamble:
{
  "narrative": "...",
  "key_events": [{"event":"...","currency":"USD","day":"Fri","impact":"High","why":"..."}],
  "regime_warning": "..."
}`;

let claudeOut = { narrative: '', key_events: [], regime_warning: '' };
try {
const cRes = await fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'x-api-key': env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, messages: [{ role: 'user', content: claudePrompt }] })
});
const cData = await cRes.json();
const text = cData.content?.[0]?.text || '';
const m = text.match(/\{[\s\S]*\}/);
if (m) claudeOut = JSON.parse(m[0]);
} catch (e) {
console.log('Claude weekly narrative failed:', e.message);
claudeOut.narrative = 'The weekly narrative is being generated. Please refresh in a few minutes.';
}

return {
week_start: weekStart.toISOString(),
week_end: now.toISOString(),
generated_at: now.toISOString(),
per_currency: perCurrency,
movers: { strongest, weakest, top_gainer: topGainer, top_loser: topLoser, most_volatile: mostVolatile },
bias_flips_timeline: flipsTimeline.slice(-15).reverse(),
pair_heatmap: heatmap,
trade_setups: setups,
narrative: claudeOut.narrative || '',
key_events: claudeOut.key_events || [],
regime_warning: claudeOut.regime_warning || ''
};
}

async function fetchAllNews() {
// 13 verified-working feeds (audited 2026-05-11). Each call lifts up to
// PER_SOURCE_CAP items so we don't truncate a busy feed (BBC publishes 47,
// CNBC 30, ActionForex 20). Overall cap of 100 is what Claude sees.
const PER_SOURCE_CAP = 15;
const TOTAL_CAP = 100;
const feeds = [
// Forex / FX-specific
{ url: 'https://www.fxstreet.com/rss/news', source: 'FXStreet' },
{ url: 'https://www.forexlive.com/feed/', source: 'ForexLive' },
{ url: 'https://www.actionforex.com/feed/', source: 'Action Forex' },
{ url: 'https://www.forexcrunch.com/feed/', source: 'Forex Crunch' },
// Macro / financial press
{ url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC News' },
{ url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC' },
{ url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html', source: 'CNBC Currencies' },
{ url: 'https://www.cnbc.com/id/15839135/device/rss/rss.html', source: 'CNBC Markets' },
{ url: 'https://www.marketwatch.com/rss/topstories', source: 'MarketWatch' },
{ url: 'https://feeds.a.dj.com/rss/RSSWSJD.xml', source: 'WSJ' },
{ url: 'https://www.investing.com/rss/news.rss', source: 'Investing.com' },
{ url: 'https://www.nasdaq.com/feed/rssoutbound', source: 'Nasdaq' },
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

const response = await fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'x-api-key': env.CLAUDE_API_KEY,
'anthropic-version': '2023-06-01'
},
body: JSON.stringify({
model: 'claude-haiku-4-5-20251001',
max_tokens: 1000,
messages: [{ role: 'user', content: prompt }]
})
});

const data = await response.json();
const text = data.content[0].text;
const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) throw new Error('No JSON in Claude response');
return JSON.parse(jsonMatch[0]);
}

async function saveSentiment(sentiment, env) {
const currencies = Object.entries(sentiment);
for (const [currency, data] of currencies) {
await fetch(`${env.SUPABASE_URL}/rest/v1/sentiment`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'apikey': env.SUPABASE_SERVICE_KEY,
'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
'Prefer': 'return=minimal'
},
body: JSON.stringify({
currency: currency,
score: data.score,
bias: data.bias,
drivers: data.drivers
})
});
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
console.log(`Forex-relevant: ${filteredNews.length}/${news.length}`);
let existingUrls = new Set();
try {
const exResp = await fetch(`${env.SUPABASE_URL}/rest/v1/news?select=url&order=id.desc&limit=500`, {
headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` }
});
const exData = await exResp.json();
existingUrls = new Set((exData || []).map(n => n.url).filter(Boolean));
} catch(e) { console.log('Dedup fetch failed:', e.message); }
const dedupedNews = filteredNews.filter(item => item.url && !existingUrls.has(item.url));
console.log(`After dedup: ${dedupedNews.length}`);
for (const item of dedupedNews.slice(0, 20)) {
const title = item.title.toLowerCase();
let impact = 'Low';

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

if (highKeywords.some(kw => title.includes(kw))) {
impact = 'High';
} else if (medKeywords.some(kw => title.includes(kw))) {
impact = 'Medium';
}

await fetch(`${env.SUPABASE_URL}/rest/v1/news`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'apikey': env.SUPABASE_SERVICE_KEY,
'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
'Prefer': 'return=minimal'
},
body: JSON.stringify({
title: item.title,
source: item.source,
url: item.url,
impact: impact,
currencies_affected: ccyRegexes.filter(([,r]) => r.test(item.title)).map(([c]) => c)
})
});
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
})
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

for (const pair of pairs) {
try {
// /quote returns close + percent_change in one call
const response = await fetch(
`https://api.twelvedata.com/quote?symbol=${pair}&apikey=${env.TWELVE_DATA_KEY}`,
{ signal: AbortSignal.timeout(5000) }
);
const data = await response.json();
if (!data || !data.close) {
console.log(`No quote for ${pair}:`, JSON.stringify(data).slice(0,200));
continue;
}

const price = parseFloat(data.close);
const changePct = data.percent_change != null ? parseFloat(data.percent_change) : 0;

const existing = await fetch(
`${env.SUPABASE_URL}/rest/v1/prices?pair=eq.${encodeURIComponent(pair)}&select=id`,
{ headers: { 'apikey': env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
);
const existingData = await existing.json();

if (existingData.length > 0) {
await fetch(
`${env.SUPABASE_URL}/rest/v1/prices?pair=eq.${encodeURIComponent(pair)}`,
{
method: 'PATCH',
headers: {
'Content-Type': 'application/json',
'apikey': env.SUPABASE_SERVICE_KEY,
'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
'Prefer': 'return=minimal'
},
body: JSON.stringify({ price: price, change_pct: changePct, updated_at: new Date().toISOString() })
}
);
} else {
await fetch(`${env.SUPABASE_URL}/rest/v1/prices`, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'apikey': env.SUPABASE_SERVICE_KEY,
'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
'Prefer': 'return=minimal'
},
body: JSON.stringify({ pair: pair, price: price, change_pct: changePct })
});
}
await new Promise(r => setTimeout(r, 500));
} catch (error) {
console.log(`Failed to update ${pair}:`, error.message);
}
}
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
    headline = `${_INS_CCY_NAMES[top.currency]} Strengthens as Bullish Sentiment Builds Across Forex — ${dateLabel}`;
    slug = `${top.currency.toLowerCase()}-strengthens-bullish-sentiment`;
    category=`${top.currency} Analysis`;
    summary = `${_INS_CCY_NAMES[top.currency]} (${top.currency}) leads forex sentiment today with a strong bullish reading, while other majors show mixed positioning.`;
  } else if (top.score <= 35) {
    headline = `${_INS_CCY_NAMES[top.currency]} Weakens as Bearish News Sentiment Dominates — ${dateLabel}`;
    slug = `${top.currency.toLowerCase()}-weakens-bearish-pressure`;
    category=`${top.currency} Analysis`;
    summary = `${_INS_CCY_NAMES[top.currency]} (${top.currency}) faces the strongest bearish pressure across the major currencies today, with negative news flow weighing on sentiment.`;
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

function _insRenderArticle({ headline, slug, summary, sentiment, news, biggestMover, dateISO, dateLabel, category }){
  const url = `${_INS_SITE}/insight/${slug}`;
  const h = _insEsc(headline), s = _insEsc(summary);
  const biasGrid = _INS_CCY_ORDER.map(c=>{
    const x = sentiment[c]; if(!x) return '';
    return `<div class="bias-card" style="border-left-color:${_insBiasColor(x.bias)};"><div class="bias-ccy">${c}</div><div class="bias-score">${x.score}</div><div class="bias-label" style="color:${_insBiasColor(x.bias)};">${_insBiasArrow(x.bias)} ${x.bias}</div></div>`;
  }).join('');
  const starters = ['Today the','Sentiment for the','The','Markets sent the','News flow drove the',"Today's data left the"];
  const breakdown = _INS_CCY_ORDER.map((c,i)=>{
    const x = sentiment[c]; if(!x) return '';
    const drivers = (x.drivers||[]).slice(0,3);
    const dlist = drivers.length ? drivers.map(d=>`<li>${_insEsc(d)}</li>`).join('') : '<li>No specific drivers recorded.</li>';
    return `<div class="ccy-block" style="border-left-color:${_insBiasColor(x.bias)};"><div class="ccy-head"><span class="ccy-arrow" style="color:${_insBiasColor(x.bias)};">${_insBiasArrow(x.bias)}</span><span class="ccy-name">${_INS_CCY_NAMES[c]} (${c})</span><span style="color:${_insBiasColor(x.bias)};font-weight:700;font-size:13px;">${x.bias}</span><span class="ccy-score">${x.score}/100</span></div><p class="ccy-intro">${starters[i%starters.length]} <strong>${_INS_CCY_NAMES[c]}</strong> shows a <strong style="color:${_insBiasColor(x.bias)};">${x.bias.toLowerCase()}</strong> news sentiment reading at <strong>${x.score}/100</strong>, driven by:</p><ul class="ccy-list">${dlist}</ul></div>`;
  }).join('');
  const high = news.filter(n=>n.impact==='High').slice(0,3);
  const fill = news.filter(n=>n.impact!=='High').slice(0,Math.max(0,3-high.length));
  const top = [...high,...fill].slice(0,3);
  const newsHtml = top.length===0 ? '<p style="color:#6b7280;">No notable headlines recorded in the past 24 hours.</p>' :
    `<ol class="news-list">${top.map(n=>{
      const ccys = (n.currencies_affected||[]).join(', ') || 'cross-market';
      return `<li><a class="news-link" href="${_insEsc(_insSafeUrl(n.url))}" target="_blank" rel="noopener nofollow">${_insEsc(n.title)}</a><div class="news-meta"><span class="imp-badge imp-${_insEsc(n.impact||'Medium')}">${_insEsc(n.impact||'')}</span>${_insEsc(n.source)} · affects ${_insEsc(ccys)}</div></li>`;
    }).join('')}</ol>`;
  const intro = `Forex markets digested a fresh wave of news flow over the past 24 hours, with our sentiment engine scoring the eight major currencies using live headlines from Reuters, Bloomberg, ForexLive and central bank wires. Today's standout mover is the <strong>${_INS_CCY_NAMES[biggestMover.currency]}</strong>, which printed a <strong style="color:${_insBiasColor(biggestMover.bias)};">${biggestMover.bias.toLowerCase()}</strong> reading at ${biggestMover.score}/100. Below is the full bias snapshot, followed by a currency-by-currency breakdown and the top news driving today's sentiment.`;
  const closing = `Use this insight as a fundamental backdrop alongside your own technical analysis. Pair the strongest bullish currency against the weakest bearish currency for a classic news-driven setup. Tomorrow's update lands at 06:00 UTC ahead of the London open. Track these biases live on the <a href="/">FXNewsBias dashboard</a>, the <a href="/currencies">currency strength meter</a>, the <a href="/pairs">28-pair bias matrix</a>, or the <a href="/calendar">economic calendar</a>.`;
  const sidebarCcys = _INS_CCY_ORDER.slice(0,5).map(c=>{
    const x = sentiment[c]; if(!x) return '';
    return `<a class="side-link" href="/currencies"><span style="color:${_insBiasColor(x.bias)};font-weight:700;">${_insBiasArrow(x.bias)} ${c}</span> · <span style="color:#6b7280;font-weight:500;">${x.bias} ${x.score}/100</span></a>`;
  }).join('');
  const ld = JSON.stringify({"@context":"https://schema.org","@type":"NewsArticle","headline":headline,"description":summary,"datePublished":dateISO,"dateModified":dateISO,"author":{"@type":"Organization","name":"FXNewsBias Team","url":_INS_SITE},"publisher":{"@type":"Organization","name":"FXNewsBias","logo":{"@type":"ImageObject","url":`${_INS_SITE}/logo-fxnb.png`}},"mainEntityOfPage":{"@type":"WebPage","@id":url},"image":`${_INS_SITE}/og-image.png`,"articleSection":"Forex Analysis"});
  const cat = _insEsc(category||'Market Wrap');
  const dateStr = new Date().toUTCString().split(' ').slice(0,4).join(' ');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"><link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="preconnect" href="https://vtbmtxtgtdprpbilragm.supabase.co" crossorigin><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#0f172a">
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"></noscript>
<title>${h} | FXNewsBias</title><meta name="description" content="${s}"><meta name="robots" content="index, follow"><meta name="author" content="FXNewsBias Team"><link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:title" content="${h}"><meta property="og:description" content="${s}"><meta property="og:url" content="${url}"><meta property="og:image" content="${_INS_SITE}/og-image.png"><meta property="og:site_name" content="FXNewsBias">
<meta property="article:published_time" content="${dateISO}"><meta property="article:author" content="FXNewsBias Team"><meta property="article:section" content="Forex Analysis">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${h}"><meta name="twitter:description" content="${s}"><meta name="twitter:image" content="${_INS_SITE}/og-image.png">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Inter',-apple-system,sans-serif;background:#fff;color:#1a1a1a;line-height:1.5;}:root{--bg:#fff;--bg-soft:#f8f9fa;--border:#e5e7eb;--text:#1a1a1a;--text-soft:#6b7280;--text-muted:#9ca3af;--accent:#2563eb;--bull:#10b981;--bear:#ef4444;--neutral:#f59e0b;}a{color:var(--accent);text-decoration:none;}a:hover{text-decoration:underline;}
.topbar{background:#0f172a;color:#fff;padding:6px 0;font-size:12px;}.topbar-inner{max-width:1280px;margin:0 auto;padding:0 20px;display:flex;justify-content:space-between;align-items:center;}.topbar-left,.topbar-right{display:flex;gap:14px;color:#94a3b8;}.topbar a{color:#94a3b8;text-decoration:none;}.topbar a:hover{color:#fff;}
.page-head{background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;padding:32px 0;}.page-head-inner{max-width:1280px;margin:0 auto;padding:0 20px;}.crumb{font-size:13px;color:#94a3b8;margin-bottom:10px;}.crumb a{color:#94a3b8;text-decoration:none;}
.cat-tag{display:inline-block;background:#2563eb;color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;padding:4px 10px;border-radius:4px;text-transform:uppercase;margin-bottom:12px;}
.page-title{font-size:clamp(22px,3.4vw,30px);font-weight:800;line-height:1.25;letter-spacing:-0.5px;margin-bottom:10px;color:#fff;}.page-sub{color:#94a3b8;font-size:14px;line-height:1.5;max-width:760px;}
.byline{margin-top:14px;color:#94a3b8;font-size:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}.byline-author{color:#fff;font-weight:600;}.byline-dot{color:#475569;}
.main{max-width:1280px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:1fr 320px;gap:24px;}@media(max-width:980px){.main{grid-template-columns:1fr;}}
.article-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:28px;}@media(max-width:600px){.article-card{padding:20px;}}
.lead{font-size:17px;line-height:1.7;color:#374151;margin-bottom:24px;}.lead strong{color:#1a1a1a;}
.h2{font-size:21px;font-weight:800;color:#1a1a1a;margin:32px 0 14px;letter-spacing:-0.3px;border-top:1px solid var(--border);padding-top:24px;}.h2:first-of-type{border-top:none;padding-top:0;margin-top:0;}
.bias-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:8px 0 12px;}@media(max-width:600px){.bias-grid{grid-template-columns:repeat(2,1fr);}}
.bias-card{background:#f8f9fa;border:1px solid var(--border);border-left:4px solid;border-radius:8px;padding:12px;text-align:center;}.bias-ccy{font-size:11px;font-weight:700;color:var(--text-muted);letter-spacing:1px;}.bias-score{font-family:'JetBrains Mono',monospace;font-size:24px;font-weight:800;color:#1a1a1a;margin:4px 0;line-height:1;}.bias-label{font-size:12px;font-weight:700;}
.bias-note{font-size:13px;color:var(--text-soft);margin-bottom:8px;}
.ccy-block{background:#f8f9fa;border:1px solid var(--border);border-left:4px solid;border-radius:8px;padding:18px;margin-bottom:12px;}.ccy-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;}.ccy-arrow{font-size:14px;}.ccy-name{font-size:16px;font-weight:800;color:#1a1a1a;}.ccy-score{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text-soft);font-weight:600;margin-left:auto;}
.ccy-intro{color:#374151;font-size:14px;line-height:1.6;margin-bottom:8px;}.ccy-intro strong{color:#1a1a1a;}
.ccy-list{list-style:none;padding:0;margin:0;}.ccy-list li{position:relative;padding:6px 0 6px 18px;font-size:13.5px;color:#374151;line-height:1.55;border-top:1px dashed var(--border);}.ccy-list li:first-child{border-top:none;}.ccy-list li:before{content:'•';position:absolute;left:4px;color:var(--accent);font-weight:700;}
.news-list{list-style:none;padding:0;margin:0;counter-reset:n;}.news-list li{counter-increment:n;position:relative;padding:14px 14px 14px 46px;background:#f8f9fa;border:1px solid var(--border);border-radius:8px;margin-bottom:10px;}.news-list li:before{content:counter(n);position:absolute;left:14px;top:14px;background:var(--accent);color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;}
.news-link{color:#1a1a1a;font-weight:600;font-size:14.5px;line-height:1.45;display:block;margin-bottom:6px;}.news-link:hover{color:var(--accent);text-decoration:none;}.news-meta{font-size:12px;color:var(--text-soft);}
.imp-badge{display:inline-block;color:#fff;padding:2px 7px;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:0.5px;margin-right:6px;text-transform:uppercase;}.imp-High{background:#dc2626;}.imp-Medium{background:#f59e0b;}.imp-Low{background:#2563eb;}
.what-next{color:#374151;font-size:15px;line-height:1.7;}
.cta{background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;border-radius:10px;padding:18px;margin-top:24px;color:#1e40af;font-size:14.5px;line-height:1.6;}.cta strong{color:#0f172a;}
.sidebar-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:14px;}.sidebar-h{font-size:13px;font-weight:800;color:#1a1a1a;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;}
.side-link{display:block;padding:10px 0;border-bottom:1px solid var(--border);color:#1a1a1a;font-size:14px;font-weight:600;line-height:1.4;}.side-link:last-child{border-bottom:none;}.side-link:hover{color:var(--accent);text-decoration:none;}
.share-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}.share-btn{flex:1;text-align:center;padding:8px;background:#f8f9fa;border:1px solid var(--border);border-radius:6px;color:#1a1a1a;font-size:12px;font-weight:600;}.share-btn:hover{background:var(--accent);color:#fff;text-decoration:none;border-color:var(--accent);}
footer{background:#0f172a;color:#94a3b8;padding:32px 20px 20px;margin-top:40px;}.footer-inner{max-width:1280px;margin:0 auto;}.footer-bottom{text-align:center;font-size:12px;padding-top:16px;border-top:1px solid #1e293b;color:#64748b;}.footer-bottom a{color:#94a3b8;}</style>
<script type="application/ld+json">${ld}</script>
<script src="/nav.js" defer></script><script src="/cookie.js" defer></script><script src="/analytics.js" defer></script>
</head><body>
<div class="topbar"><div class="topbar-inner"><div class="topbar-left"><span>📅 ${dateStr}</span></div><div class="topbar-right"><a href="/insight/">Daily Insights</a><a href="/news">News</a></div></div></div>
<style>@media(max-width:768px){.nav-menu,.nav-actions{display:none!important;}.nav-toggle{display:flex!important;}}@media(min-width:769px){.nav-toggle{display:flex!important;}.nav-menu,.nav-actions{display:none!important;}}</style>
<nav class="nav"></nav>
<header class="page-head"><div class="page-head-inner">
<div class="crumb"><a href="/">Home</a> · <a href="/insight/">Daily Insights</a> · <span>${dateLabel}</span></div>
<span class="cat-tag">${cat}</span><h1 class="page-title">${h}</h1><p class="page-sub">${s}</p>
<div class="byline"><span class="byline-author">By FXNewsBias Team</span><span class="byline-dot">·</span><span>Published ${dateLabel}</span><span class="byline-dot">·</span><span>4 min read</span></div>
</div></header>
<div class="main">
<article class="article-card">
<p class="lead">${intro}</p>
<h2 class="h2">Currency Bias Snapshot</h2><div class="bias-grid">${biasGrid}</div>
<p class="bias-note">Scores 0-100 from our news sentiment engine. 50 is neutral, &gt;65 strongly bullish, &lt;35 strongly bearish. Updated every 3 hours from live forex news.</p>
<h2 class="h2">Currency-by-Currency Breakdown</h2>${breakdown}
<h2 class="h2">Top News Driving Today's Sentiment</h2>${newsHtml}
<h2 class="h2">What to Watch Next</h2><p class="what-next">${closing}</p>
<div class="cta"><strong>Want this every morning before London opens?</strong> Bookmark <a href="/insight/">/insight/</a> or subscribe to our <a href="/insight/rss.xml">RSS feed</a> — fresh forex sentiment analysis delivered daily, free, no signup.</div>
</article>
<aside>
<div class="sidebar-card"><div class="sidebar-h">📊 Live Currency Bias</div>${sidebarCcys}<a class="side-link" style="text-align:center;color:#2563eb;border-top:1px solid #e5e7eb;margin-top:6px;padding-top:12px;" href="/currencies">View all 8 currencies →</a></div>
<div class="sidebar-card"><div class="sidebar-h">🔗 Explore More</div><a class="side-link" href="/">Live Sentiment Dashboard</a><a class="side-link" href="/pairs">28-Pair Bias Matrix</a><a class="side-link" href="/calendar">Economic Calendar</a><a class="side-link" href="/news">Latest Forex News</a><a class="side-link" href="/insight/">All Daily Insights</a></div>
<div class="sidebar-card"><div class="sidebar-h">📤 Share This Insight</div><div class="share-row"><a class="share-btn" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(headline)}" target="_blank" rel="noopener">𝕏 Twitter</a><a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">LinkedIn</a></div></div>
</aside>
</div>
<footer><div class="footer-inner"><div class="footer-bottom">© ${new Date().getFullYear()} FXNewsBias · <a href="/about">About</a> · <a href="/disclaimer">Disclaimer</a> · <a href="/insight/">All Daily Insights</a> · <a href="/insight/rss.xml">RSS</a></div></div></footer>
</body></html>`;
}

function _insRenderIndex(articles){
  const dateStr = new Date().toUTCString().split(' ').slice(0,4).join(' ');
  const items = articles.map(a=>`<article class="ix-card"><div class="ix-meta"><span class="ix-cat">${_insEsc(a.category||'Market Wrap')}</span><span class="ix-date">${a.dateLabel}</span></div><h2 class="ix-title"><a href="/insight/${a.slug}">${_insEsc(a.headline)}</a></h2><p class="ix-desc">${_insEsc(a.summary)}</p><a class="ix-read" href="/insight/${a.slug}">Read full insight →</a></article>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon.ico"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#0f172a">
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"></noscript>
<title>Daily Forex Insights | News Sentiment Analysis - FXNewsBias</title>
<meta name="description" content="Daily forex market insights with news sentiment analysis for the 8 major currencies. Updated every morning before the London open.">
<meta name="robots" content="index, follow"><link rel="canonical" href="${_INS_SITE}/insight/">
<meta property="og:type" content="website"><meta property="og:title" content="Daily Forex Insights | FXNewsBias"><meta property="og:description" content="Daily forex market insights with news sentiment analysis for the 8 major currencies."><meta property="og:url" content="${_INS_SITE}/insight/"><meta property="og:image" content="${_INS_SITE}/og-image.png">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Inter',-apple-system,sans-serif;background:#fff;color:#1a1a1a;line-height:1.5;}:root{--border:#e5e7eb;--accent:#2563eb;}a{color:#2563eb;text-decoration:none;}a:hover{text-decoration:underline;}
.topbar{background:#0f172a;color:#fff;padding:6px 0;font-size:12px;}.topbar-inner{max-width:1280px;margin:0 auto;padding:0 20px;display:flex;justify-content:space-between;align-items:center;}.topbar a{color:#94a3b8;text-decoration:none;}
.page-head{background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;padding:32px 0;}.page-head-inner{max-width:1280px;margin:0 auto;padding:0 20px;}.crumb{font-size:13px;color:#94a3b8;margin-bottom:10px;}.crumb a{color:#94a3b8;}.page-title{font-size:clamp(24px,4vw,32px);font-weight:800;color:#fff;margin-bottom:8px;letter-spacing:-0.5px;}.page-sub{color:#94a3b8;font-size:14px;line-height:1.5;max-width:760px;}
.main{max-width:1280px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:1fr 320px;gap:24px;}@media(max-width:980px){.main{grid-template-columns:1fr;}}
.ix-grid{display:grid;gap:14px;}
.ix-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:20px;border-left:4px solid var(--accent);transition:box-shadow .15s, transform .15s;}.ix-card:hover{box-shadow:0 4px 14px rgba(37,99,235,.08);transform:translateY(-1px);}
.ix-meta{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}.ix-cat{background:#2563eb;color:#fff;font-size:10px;font-weight:700;letter-spacing:1px;padding:3px 8px;border-radius:3px;text-transform:uppercase;}.ix-date{font-size:12px;color:#6b7280;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;}
.ix-title{margin:6px 0 8px;}.ix-title a{color:#1a1a1a;font-size:18px;font-weight:800;line-height:1.35;letter-spacing:-0.2px;}.ix-title a:hover{color:#2563eb;text-decoration:none;}.ix-desc{color:#374151;font-size:14px;line-height:1.6;margin-bottom:8px;}.ix-read{color:#2563eb;font-size:13px;font-weight:700;}
.rss-card{background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;border-radius:10px;padding:20px;margin-top:24px;text-align:center;}.rss-card a{color:#1e40af;font-weight:700;font-size:14px;}
.sidebar-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:14px;}.sidebar-h{font-size:13px;font-weight:800;color:#1a1a1a;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px;}.side-link{display:block;padding:10px 0;border-bottom:1px solid var(--border);color:#1a1a1a;font-size:14px;font-weight:600;line-height:1.4;}.side-link:last-child{border-bottom:none;}.side-link:hover{color:#2563eb;text-decoration:none;}
footer{background:#0f172a;color:#94a3b8;padding:32px 20px 20px;margin-top:40px;}.footer-inner{max-width:1280px;margin:0 auto;}.footer-bottom{text-align:center;font-size:12px;padding-top:16px;border-top:1px solid #1e293b;color:#64748b;}.footer-bottom a{color:#94a3b8;}</style>
<script src="/nav.js" defer></script><script src="/cookie.js" defer></script><script src="/analytics.js" defer></script>
</head><body>
<div class="topbar"><div class="topbar-inner"><div><span style="color:#94a3b8;">📅 ${dateStr}</span></div><div><a href="/news" style="color:#94a3b8;margin-left:14px;">News</a></div></div></div>
<style>@media(max-width:768px){.nav-menu,.nav-actions{display:none!important;}.nav-toggle{display:flex!important;}}@media(min-width:769px){.nav-toggle{display:flex!important;}.nav-menu,.nav-actions{display:none!important;}}</style>
<nav class="nav"></nav>
<header class="page-head"><div class="page-head-inner">
<div class="crumb"><a href="/">Home</a> · <span>Daily Insights</span></div>
<h1 class="page-title">Daily Forex Insights</h1>
<p class="page-sub">Daily market wraps based on our live news sentiment engine. Published every morning at 06:00 UTC, ahead of the London open. Free, no signup, ad-supported.</p>
</div></header>
<div class="main">
<div><div class="ix-grid">${items}</div><div class="rss-card"><a href="/insight/rss.xml">📡 Subscribe via RSS</a><div style="font-size:13px;color:#1e40af;margin-top:6px;">Get new insights in Feedly, Inoreader, or any RSS reader</div></div></div>
<aside>
<div class="sidebar-card"><div class="sidebar-h">📊 Live Tools</div><a class="side-link" href="/">Sentiment Dashboard</a><a class="side-link" href="/currencies">Currency Strength Meter</a><a class="side-link" href="/pairs">28-Pair Bias Matrix</a><a class="side-link" href="/calendar">Economic Calendar</a><a class="side-link" href="/news">Forex News Feed</a></div>
<div class="sidebar-card"><div class="sidebar-h">ℹ️ About These Insights</div><p style="font-size:13.5px;color:#374151;line-height:1.6;">Each insight is generated from our live sentiment engine — combining bias scores, news flow, and currency-by-currency analysis into a single morning brief. No AI fluff, just the data, every day at 06:00 UTC.</p></div>
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
<description>Daily forex market insights with news sentiment analysis for the 8 major currencies.</description>
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
    if (data && data.content) return atob(data.content.replace(/\n/g,''));
  } catch (_) {}
  return null;
}

async function _insCommitFiles(env, files, commitMessage) {
  // files: [{path, content}]
  const owner = env.GITHUB_OWNER || 'EARNOVAGAMING';
  const repo = env.GITHUB_REPO || 'fxnewsbias';
  const branch = env.GITHUB_BRANCH || 'main';

  // Get current head commit
  const ref = await _insGh(env, 'GET', `/repos/{owner}/{repo}/git/ref/heads/${branch}`);
  const baseSha = ref.object.sha;
  const baseCommit = await _insGh(env, 'GET', `/repos/{owner}/{repo}/git/commits/${baseSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  // Create blobs for each file
  const treeItems = [];
  for (const f of files) {
    const blob = await _insGh(env, 'POST', `/repos/{owner}/{repo}/git/blobs`, {
      content: btoa(unescape(encodeURIComponent(f.content))),
      encoding: 'base64'
    });
    treeItems.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // Create tree
  const tree = await _insGh(env, 'POST', `/repos/{owner}/{repo}/git/trees`, {
    base_tree: baseTreeSha, tree: treeItems
  });

  // Create commit
  const commit = await _insGh(env, 'POST', `/repos/{owner}/{repo}/git/commits`, {
    message: commitMessage, tree: tree.sha, parents: [baseSha]
  });

  // Update ref
  await _insGh(env, 'PATCH', `/repos/{owner}/{repo}/git/refs/heads/${branch}`, { sha: commit.sha });
  return commit.sha;
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
      body: JSON.stringify({ from: `FXNewsBias Alerts <${fromEmail}>`, to: recipients, subject, text, html })
    });
    console.log('Insight failure email sent to', recipients.join(','));
  } catch (e) {
    console.log('Insight failure email error:', e.message);
  }
}

async function generateDailyInsight(env) {
  console.log('Daily insight: starting...');
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

    // 3. Generate article
    const angle = _insDetectAngle(sentiment);
    const dateISO = new Date().toISOString();
    const today = dateISO.slice(0, 10);
    const slug = `${today}-${angle.slug}`;
    const dateLabel = new Date().toUTCString().split(' ').slice(0,4).join(' ');

    const articleHtml = _insRenderArticle({ headline: angle.headline, slug, summary: angle.summary, sentiment, news, biggestMover: angle.biggestMover, dateISO, dateLabel, category: angle.category });

    // 4. Word count check
    const text = articleHtml.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g,' ').trim();
    const wordCount = text.split(' ').length;
    if (wordCount < 500) throw new Error(`Article too short: ${wordCount} words (need 500+)`);
    console.log(`Insight: generated ${wordCount} words, slug=${slug}`);

    // 5. List existing articles to rebuild index/RSS
    const existing = await _insListExistingArticles(env);
    const allSlugs = [`${slug}.html`, ...existing.filter(n => n !== `${slug}.html`)];
    // Keep most recent 50 for index/RSS (oldest still served, just not listed)
    const articlesMeta = [];
    articlesMeta.push({ slug, headline: angle.headline, summary: angle.summary, dateISO, dateLabel, category: angle.category });
    const _CCY_CODES = new Set(['USD','EUR','GBP','JPY','AUD','CAD','CHF','NZD']);
    for (const fname of existing.slice(0, 49)) {
      if (fname === `${slug}.html`) continue;
      const m = fname.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.html$/);
      if (!m) continue;
      const oldDate = new Date(m[1] + 'T06:00:00Z');
      const oldSlug = fname.replace(/\.html$/, '');
      // Title-case the slug, but uppercase 3-letter currency codes (USD, GBP, etc).
      const titled = oldSlug.replace(/^\d{4}-\d{2}-\d{2}-/, '').split('-').map(w => {
        const u = w.toUpperCase();
        if (_CCY_CODES.has(u)) return u;
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
      articlesMeta.push({
        slug: oldSlug,
        headline: titled,
        summary: 'Previous daily forex insight from the FXNewsBias sentiment engine.',
        dateISO: oldDate.toISOString(),
        dateLabel: oldDate.toUTCString().split(' ').slice(0,4).join(' ')
      });
    }
    articlesMeta.sort((a,b) => b.dateISO.localeCompare(a.dateISO));

    // 6. Build sitemap update
    const oldSitemap = (await _insGetFile(env, 'sitemap.xml')) || '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>';
    let newSitemap = oldSitemap;
    if (!newSitemap.includes(`/insight/${slug}`)) {
      const entry = `  <url><loc>${_INS_SITE}/insight/${slug}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`;
      newSitemap = newSitemap.replace('</urlset>', entry + '\n</urlset>');
    }

    // 7. Commit all files
    const sha = await _insCommitFiles(env, [
      { path: `insight/${slug}.html`, content: articleHtml },
      { path: 'insight/index.html', content: _insRenderIndex(articlesMeta) },
      { path: 'insight/rss.xml', content: _insRenderRss(articlesMeta) },
      { path: 'sitemap.xml', content: newSitemap }
    ], `Daily insight: ${angle.headline}`);

    console.log(`Insight: committed ${sha.slice(0,7)} - ${slug}`);
    return { ok: true, slug, sha, wordCount };
  } catch (e) {
    console.error('Insight: FAILED -', e.message);
    await _insSendFailureEmail(env, e, 'generateDailyInsight');
    return { ok: false, error: e.message };
  }
}
