#!/usr/bin/env node
/**
 * GA4 Analytics Dashboard — fxnewsbias.com
 * Usage:
 *   node scripts/ga4.mjs          → today
 *   node scripts/ga4.mjs 7        → last 7 days
 *   node scripts/ga4.mjs 30       → last 30 days
 *   node scripts/ga4.mjs pages    → top pages only
 *   node scripts/ga4.mjs sources  → traffic sources only
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load .env ────────────────────────────────────────────────────────────────
const envPath = resolve(new URL('.', import.meta.url).pathname, '../.env');
const env = {};
try {
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim();
  });
} catch { console.error('Could not read .env'); process.exit(1); }

const CLIENT_ID     = env.GA4_CLIENT_ID;
const CLIENT_SECRET = env.GA4_CLIENT_SECRET;
const REFRESH_TOKEN = env.GA4_REFRESH_TOKEN;
const PROPERTY_ID   = '536862201'; // fxnewsbias.com

if (!CLIENT_ID || !REFRESH_TOKEN) {
  console.error('Missing GA4_CLIENT_ID / GA4_REFRESH_TOKEN in .env');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  const d = await r.json();
  if (!d.access_token) { console.error('Token error:', d); process.exit(1); }
  return d.access_token;
}

async function ga4(token, body) {
  const r = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) }
  );
  const d = await r.json();
  if (d.error) { console.error('GA4 error:', d.error.message); process.exit(1); }
  return d;
}

const sumMetric = (rows, idx) =>
  (rows || []).reduce((s, r) => s + parseFloat(r.metricValues[idx]?.value || 0), 0);

function fmtDur(secs) {
  return `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s`;
}

function bar(val, max, width = 20) {
  return '█'.repeat(Math.max(1, Math.round((val / max) * width)));
}

// ── Args ─────────────────────────────────────────────────────────────────────
const arg    = process.argv[2] || 'today';
const days   = parseInt(arg) || null;
const filter = isNaN(arg) ? arg : null;

let startDate, endDate, label;
const today = new Date().toISOString().slice(0, 10);
const fmt   = d => d.toISOString().slice(0, 10);

if (days) {
  const from = new Date(); from.setDate(from.getDate() - days + 1);
  startDate = fmt(from); endDate = today; label = `Last ${days} days`;
} else {
  startDate = today; endDate = today; label = 'Today';
}

// ── Main ─────────────────────────────────────────────────────────────────────
const token = await getAccessToken();

const [overview, sources, pages, countries, devices, hourly] = await Promise.all([
  // Overview totals
  ga4(token, {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'sessions' }, { name: 'activeUsers' }, { name: 'newUsers' },
      { name: 'screenPageViews' }, { name: 'averageSessionDuration' },
      { name: 'bounceRate' }, { name: 'engagedSessions' },
    ],
    dimensions: [],
  }),
  // Traffic sources
  ga4(token, {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  }),
  // Top pages
  ga4(token, {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'averageSessionDuration' }],
    dimensions: [{ name: 'pagePath' }],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 15,
  }),
  // Countries
  ga4(token, {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
    dimensions: [{ name: 'country' }],
    orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
    limit: 10,
  }),
  // Devices
  ga4(token, {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'sessions' }],
    dimensions: [{ name: 'deviceCategory' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  }),
  // Hourly (today only)
  startDate === today ? ga4(token, {
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: 'sessions' }],
    dimensions: [{ name: 'hour' }],
    orderBys: [{ dimension: { dimensionName: 'hour' } }],
  }) : Promise.resolve({ rows: [] }),
]);

// ── Print ────────────────────────────────────────────────────────────────────
const W = 58;
const line  = '─'.repeat(W);
const dline = '═'.repeat(W);

const ovRows = overview.rows?.[0]?.metricValues || [];
const sess    = parseInt(ovRows[0]?.value || 0);
const users   = parseInt(ovRows[1]?.value || 0);
const newU    = parseInt(ovRows[2]?.value || 0);
const pvs     = parseInt(ovRows[3]?.value || 0);
const dur     = parseFloat(ovRows[4]?.value || 0);
const br      = parseFloat(ovRows[5]?.value || 0);
const engaged = parseInt(ovRows[6]?.value || 0);

const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });

console.log(`\n${'═'.repeat(W)}`);
console.log(`  📊 FXNEWSBIAS.COM — GA4  |  ${label}`);
console.log(`  Pulled at ${now} MYT`);
console.log(dline);
console.log(`  Sessions          ${sess.toLocaleString().padStart(8)}    Engaged     ${engaged.toLocaleString().padStart(6)}`);
console.log(`  Active Users      ${users.toLocaleString().padStart(8)}    New Users   ${newU.toLocaleString().padStart(6)}`);
console.log(`  Pageviews         ${pvs.toLocaleString().padStart(8)}    Avg Session  ${fmtDur(dur)}`);
console.log(`  Bounce Rate       ${(br * 100).toFixed(1).padStart(7)}%`);

if (filter !== 'pages' && filter !== 'sources') {
  // Traffic sources
  console.log(`\n  TRAFFIC SOURCES`);
  console.log('  ' + line);
  const srcIcon = { 'Organic Search': '🔍', Direct: '🔗', 'Organic Social': '📱', Email: '📧', Referral: '🌐', '(other)': '•' };
  const srcRows = sources.rows || [];
  const maxSrc = Math.max(...srcRows.map(r => parseInt(r.metricValues[0].value)), 1);
  for (const row of srcRows) {
    const src  = row.dimensionValues[0].value;
    const s    = parseInt(row.metricValues[0].value);
    const u    = parseInt(row.metricValues[1].value);
    const icon = srcIcon[src] || '•';
    console.log(`  ${icon} ${src.padEnd(24)} ${String(s).padStart(4)} sess  ${String(u).padStart(4)} users  ${bar(s, maxSrc, 12)}`);
  }

  // Countries
  console.log(`\n  BY COUNTRY`);
  console.log('  ' + line);
  const ctryRows = countries.rows || [];
  const maxCtry  = Math.max(...ctryRows.map(r => parseInt(r.metricValues[0].value)), 1);
  for (const row of ctryRows) {
    const ctry = row.dimensionValues[0].value;
    const u    = parseInt(row.metricValues[0].value);
    console.log(`  ${String(u).padStart(4)}  ${ctry.padEnd(22)} ${bar(u, maxCtry, 14)}`);
  }

  // Devices
  console.log(`\n  BY DEVICE`);
  console.log('  ' + line);
  for (const row of (devices.rows || [])) {
    const dev  = row.dimensionValues[0].value;
    const s    = parseInt(row.metricValues[0].value);
    const icon = dev === 'mobile' ? '📱' : dev === 'desktop' ? '💻' : '📟';
    console.log(`  ${icon} ${dev.padEnd(12)} ${String(s).padStart(4)} sessions`);
  }
}

// Top pages
console.log(`\n  TOP PAGES`);
console.log('  ' + line);
const pgRows = pages.rows || [];
const maxPg  = Math.max(...pgRows.map(r => parseInt(r.metricValues[0].value)), 1);
for (const row of pgRows) {
  const path = row.dimensionValues[0].value;
  const pv   = parseInt(row.metricValues[0].value);
  const u    = parseInt(row.metricValues[1].value);
  const dur2 = parseFloat(row.metricValues[2].value);
  if (!pv) continue;
  const label2 = path.length > 38 ? path.slice(0, 35) + '…' : path;
  console.log(`  ${String(pv).padStart(4)}  ${label2.padEnd(38)} ${fmtDur(dur2)}`);
}

// Hourly (today only)
if (hourly.rows?.length) {
  console.log(`\n  HOURLY  (UTC)`);
  console.log('  ' + line);
  const hrMap = {};
  for (const row of hourly.rows) {
    hrMap[row.dimensionValues[0].value] = parseInt(row.metricValues[0].value);
  }
  const maxHr = Math.max(...Object.values(hrMap), 1);
  for (let h = 0; h <= 23; h++) {
    const key = String(h).padStart(2, '0');
    const val = hrMap[key] || 0;
    if (!val) continue;
    console.log(`  ${key}:00  ${String(val).padStart(3)}  ${bar(val, maxHr, 24)}`);
  }
}

console.log(`\n${'═'.repeat(W)}\n`);
