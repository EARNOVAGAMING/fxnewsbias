/* FXNewsBias — Web Push service worker (V1).
 *
 * DELIBERATELY PUSH-ONLY. There is NO `fetch` handler in this file and one
 * must never be added without a separate review: FXNB serves request-time
 * data (pair/currency sentiment blocks, guide live-bias strips, SSR session
 * scorecard, refreshed dateModified) plus SEO-critical HTML. A caching
 * service worker would serve stale versions of exactly that content.
 *
 * No offline shell. No Workbox. No API/price/sentiment caching.
 *
 * Push is payload-less: the push event carries no data, the worker wakes and
 * reads the already-public /insight/articles.json artifact for the newest
 * session insight. Nothing secret is transmitted or stored here.
 */

const FALLBACK = {
  title: 'FXNewsBias',
  body: 'A new session insight has been published.',
  url: '/insight/',
};

function truncate(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut) + '…';
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let n = { ...FALLBACK };
    try {
      // Cache-busted: the article is committed seconds before the push fires.
      const r = await fetch(`/insight/articles.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) {
        const articles = await r.json();
        const a = Array.isArray(articles) ? articles[0] : null;
        if (a && a.slug && a.headline) {
          n = {
            title: truncate(a.headline, 80),
            body: truncate(a.summary, 90),
            url: `/insight/${a.slug}`,
          };
        }
      }
    } catch (_) {
      // Network unavailable on wake — fall through to the generic notification
      // rather than showing nothing (browsers surface a default "site updated
      // in the background" message if a push event ends without one).
    }
    await self.registration.showNotification(n.title, {
      body: n.body,
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      tag: 'fxnb-session-insight',   // one live session notification per device
      renotify: true,
      data: { url: n.url },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/insight/';
  event.waitUntil((async () => {
    // Focus an already-open FXNB tab if one is on the target page, else open it.
    // (This is click routing, not active-client suppression — V1 always shows
    // the notification regardless of whether the site is open.)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.includes(target) && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow(target);
  })());
});
