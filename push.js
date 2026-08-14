/* FXNewsBias — Web Push opt-in (V1).
 * Registered users only. Permission is requested ONLY on an explicit click.
 * Never auto-prompts on page load. */
(function () {
  'use strict';
  var CRON = 'https://fxnewsbias-cron.dineshsanther123gf.workers.dev';

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  // iOS/iPadOS only allow push from an installed (Home Screen) PWA.
  function iosNeedsInstall() {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var standalone = window.navigator.standalone === true ||
                     window.matchMedia('(display-mode: standalone)').matches;
    return ios && !standalone;
  }
  function b64uToUint8(base64) {
    var s = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function idToken() {
    try {
      var u = window.getCurrentUser && window.getCurrentUser();
      if (u && u.getIdToken) return u.getIdToken();
    } catch (_) {}
    return Promise.resolve(null);
  }
  function post(path, body) {
    return fetch(CRON + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  function getRegistration() {
    return navigator.serviceWorker.getRegistration('/sw.js')
      .then(function (reg) { return reg || navigator.serviceWorker.register('/sw.js', { scope: '/' }); });
  }

  function currentSubscription() {
    if (!supported()) return Promise.resolve(null);
    return getRegistration()
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .catch(function () { return null; });
  }

  // Explicit user action required — called from the profile toggle only.
  function enable() {
    if (!supported()) return Promise.reject(new Error('unsupported'));
    if (iosNeedsInstall()) return Promise.reject(new Error('ios-install-required'));
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') throw new Error('permission-' + perm);
      return fetch(CRON + '/api/push/public-key').then(function (r) { return r.json(); });
    }).then(function (j) {
      if (!j || !j.key) throw new Error('no-vapid-key');
      return getRegistration().then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToUint8(j.key) });
      });
    }).then(function (sub) {
      return idToken().then(function (tk) {
        if (!tk) throw new Error('not-signed-in');
        return post('/api/push/subscribe', {
          idToken: tk, subscription: sub.toJSON(), userAgent: navigator.userAgent,
        });
      });
    }).then(function (res) {
      if (res && res.error) throw new Error(res.error);
      return true;
    });
  }

  // Unsubscribes the browser and deactivates server-side. Leaves email
  // alerts, Pro status and push_log history untouched.
  function disable() {
    return currentSubscription().then(function (sub) {
      if (!sub) return true;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().catch(function () { return false; }).then(function () {
        return idToken();
      }).then(function (tk) {
        if (!tk) return true;
        return post('/api/push/unsubscribe', { idToken: tk, endpoint: endpoint });
      }).then(function () { return true; });
    });
  }

  function status() {
    return currentSubscription().then(function (sub) {
      return idToken().then(function (tk) {
        if (!tk) return { signedIn: false, subscribed: false };
        return post('/api/push/status', { idToken: tk, endpoint: sub ? sub.endpoint : null })
          .then(function (r) {
            return {
              signedIn: true,
              subscribed: !!(sub && r && r.subscribed),
              devices: (r && r.devices) || 0,
              permission: (window.Notification && Notification.permission) || 'default',
            };
          });
      });
    });
  }

  window.FXNBPush = {
    supported: supported, iosNeedsInstall: iosNeedsInstall,
    enable: enable, disable: disable, status: status,
  };
})();
