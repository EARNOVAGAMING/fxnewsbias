// FXNewsBias Sentiment Worker
// Handles: sentiment analysis, prices, Telegram alerts, Stripe webhooks, Firebase Pro updates

export default {
async fetch(request, env) {
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
if (url.pathname === '/incidents') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
return handleIncidentsView(url, env);
}
if (url.pathname === '/cleanup-system-state') {
if (!_authed()) return new Response('Unauthorized', { status: 401 });
const result = await cleanupSystemState(env);
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
return new Response('FXNewsBias Cron Worker Running', { status: 200 });
},

async scheduled(event, env, ctx) {
// Two cron triggers:
//   '0 */3 * * *'  -> sentiment analysis (every 3 hours)
//   '*/15 * * * *' -> price updates + staleness check (every 15 minutes)
const tasks = [];
if (event.cron === '0 */3 * * *') {
tasks.push(runSentimentAnalysis(env));
tasks.push(updatePrices(env));
// Once every 3 hours is plenty for a retention sweep — system_state is
// tiny and only needs to be pruned occasionally.
tasks.push(cleanupSystemState(env).catch(e => console.log('Cleanup error:', e.message)));
// News and sentiment grow unbounded with every cron tick — sweep them
// on the same 3-hourly cadence so the Supabase tables stay manageable.
tasks.push(cleanupNews(env).catch(e => console.log('cleanupNews error:', e.message)));
tasks.push(cleanupSentiment(env).catch(e => console.log('cleanupSentiment error:', e.message)));
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
return { ok: false, status: r.status, error: errText, cutoff, retention_days: days };
}
const count = parseDeletedCount(r);
console.log(`cleanupSystemState: deleted ${count} row(s) older than ${cutoff} (retention=${days}d)`);
return { ok: true, deleted: count, cutoff, retention_days: days };
} catch (e) {
console.log('cleanupSystemState error:', e.message);
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
return { ok: false, status: r.status, error: errText, cutoff, retention_days: days };
}
const count = parseDeletedCount(r);
console.log(`cleanupNews: deleted ${count} row(s) older than ${cutoff} (retention=${days}d)`);
return { ok: true, deleted: count, cutoff, retention_days: days };
} catch (e) {
console.log('cleanupNews error:', e.message);
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
return { ok: false, status: r.status, error: errText, cutoff, retention_days: days, protected_ids: protectedIds };
}
const count = parseDeletedCount(r);
console.log(`cleanupSentiment: deleted ${count} row(s) older than ${cutoff} (retention=${days}d, protected=${protectedIds.length})`);
return { ok: true, deleted: count, cutoff, retention_days: days, protected_ids: protectedIds };
} catch (e) {
console.log('cleanupSentiment error:', e.message);
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
async function fetchAllNews() {
const feeds = [
// Original 6 sources (proven working)
{ url: 'https://www.fxstreet.com/rss/news', source: 'FXStreet' },
{ url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'BBC News' },
{ url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC' },
{ url: 'https://www.marketwatch.com/rss/topstories', source: 'MarketWatch' },
{ url: 'https://www.dailyfx.com/feeds/all', source: 'DailyFX' },
{ url: 'https://www.investing.com/rss/news.rss', source: 'Investing.com' },
// New 6 sources (free RSS, no API keys)
{ url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance' },
{ url: 'https://www.forexlive.com/feed/news', source: 'ForexLive' },
{ url: 'https://www.actionforex.com/feed/', source: 'Action Forex' },
{ url: 'https://www.fxempire.com/api/v1/en/articles/rss', source: 'FX Empire' },
{ url: 'https://www.nasdaq.com/feed/rssoutbound', source: 'Nasdaq' },
{ url: 'https://www.forexcrunch.com/feed/', source: 'Forex Crunch' },
];

// Fetch all 12 feeds in parallel for speed
const results = await Promise.allSettled(
feeds.map(async (feed) => {
try {
const response = await fetch(feed.url, {
headers: { 'User-Agent': 'FXNewsBias/1.0' },
signal: AbortSignal.timeout(5000)
});
if (!response.ok) {
console.log(`Skipped ${feed.source}: HTTP ${response.status}`);
return [];
}
const text = await response.text();
const items = parseRSS(text, feed.source);
console.log(`${feed.source}: fetched ${items.length} items`);
return items.slice(0, 5);
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

console.log(`Total news collected: ${allNews.length}`);
return allNews.slice(0, 60);
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

Respond ONLY in this exact JSON format:
{
"USD": {"score": 42, "bias": "Bearish", "drivers": ["Weak NFP data", "Fed dovish tone", "Trade deficit widening"]},
"EUR": {"score": 71, "bias": "Bullish", "drivers": ["ECB hawkish stance", "Germany CPI beat", "Strong eurozone data"]},
"GBP": {"score": 38, "bias": "Bearish", "drivers": ["UK unemployment rising", "BOE dovish pivot", "Weak retail sales"]},
"JPY": {"score": 78, "bias": "Bullish", "drivers": ["Safe-haven demand", "BOJ hawkish shift", "Risk-off sentiment"]},
"AUD": {"score": 35, "bias": "Bearish", "drivers": ["China PMI miss", "Iron ore prices drop", "Risk-off mode"]},
"CAD": {"score": 65, "bias": "Bullish", "drivers": ["Oil price surge", "Strong jobs data", "Trade balance positive"]},
"CHF": {"score": 72, "bias": "Bullish", "drivers": ["Safe-haven flows", "Swiss inflation stable", "Geopolitical tensions"]},
"NZD": {"score": 40, "bias": "Bearish", "drivers": ["RBNZ dovish signal", "China slowdown impact", "Dairy prices weak"]}
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
const forexKeywords = ['fed','federal reserve','rate','interest','ecb','boe','boj','snb','rba','boc','rbnz','pboc','central bank','nfp','non-farm','payroll','inflation','cpi','ppi','gdp','recession','tariff','trade war','sanctions','opec','dollar','euro','sterling','pound','yen','yuan','franc','aussie','kiwi','loonie','currency','currencies','forex','fx','exchange rate','treasury','bond yield','jobless','unemployment','employment','pmi','retail sales','trade balance','gold','oil','crude','wti','brent','xau','usd','eur','gbp','jpy','chf','aud','cad','nzd'];
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
