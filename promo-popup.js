/* FXNewsBias: unified subscribe + 7-day Pro trial pop-out.
   Self-contained, no dependencies. Self-gates so it only shows to logged-out
   visitors on content pages, and remembers dismissal for 7 days. */
(function () {
  try {
    var path = (location.pathname.replace(/\/+$/, '') || '/').toLowerCase();
    var BLOCK = ['/login', '/register', '/profile', '/admin', '/forecast-admin', '/auth-action'];
    if (BLOCK.indexOf(path) !== -1) return;                       // not on auth/account pages
    if (localStorage.getItem('fxnb_logged_in') === 'true') return; // not for logged-in users

    var KEY = 'fxnb_promo_dismissed';
    var last = parseInt(localStorage.getItem(KEY) || '0', 10);
    if (last && (Date.now() - last) < 7 * 864e5) return;          // 7-day cooldown

    var TRIAL_URL = '/pricing';
    var built = false;

    function remember() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} }

    function build() {
      if (built || document.getElementById('fxnb-promo')) return;
      built = true;

      var css = document.createElement('style');
      css.textContent =
        '#fxnb-promo{position:fixed;z-index:2000;right:24px;bottom:24px;width:360px;max-width:calc(100vw - 32px);' +
        'background:#0f172a;color:#e2e8f0;border:1px solid rgba(96,165,250,.25);border-radius:16px;' +
        'box-shadow:0 20px 50px rgba(0,0,0,.45);padding:22px;font-family:Inter,-apple-system,sans-serif;' +
        'transform:translateY(16px);opacity:0;transition:transform .25s ease,opacity .25s ease;}' +
        '#fxnb-promo.in{transform:translateY(0);opacity:1;}' +
        '#fxnb-promo .fxnb-x{position:absolute;top:12px;right:14px;background:none;border:none;color:#64748b;' +
        'font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;}#fxnb-promo .fxnb-x:hover{color:#e2e8f0;}' +
        '#fxnb-promo .fxnb-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;' +
        'text-transform:uppercase;color:#93c5fd;background:rgba(37,99,235,.15);padding:4px 10px;border-radius:20px;margin-bottom:10px;}' +
        '#fxnb-promo h3{font-size:18px;font-weight:800;color:#f8fafc;margin:0 0 6px;line-height:1.3;}' +
        '#fxnb-promo p{font-size:13px;color:#94a3b8;margin:0 0 16px;line-height:1.55;}' +
        '#fxnb-promo .fxnb-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;' +
        'padding:12px;background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;' +
        'cursor:pointer;text-decoration:none;transition:background .2s ease;}#fxnb-promo .fxnb-primary:hover{background:#1d4ed8;}' +
        '#fxnb-promo .fxnb-secondary{display:block;text-align:center;width:100%;margin-top:10px;padding:10px;' +
        'background:transparent;color:#cbd5e1;border:1px solid rgba(255,255,255,.14);border-radius:10px;' +
        'font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:border-color .2s,color .2s;}' +
        '#fxnb-promo .fxnb-secondary:hover{border-color:rgba(96,165,250,.5);color:#fff;}' +
        '#fxnb-promo .fxnb-later{display:block;margin:12px auto 0;background:none;border:none;color:#64748b;' +
        'font-size:12px;cursor:pointer;}#fxnb-promo .fxnb-later:hover{color:#94a3b8;text-decoration:underline;}' +
        '@media(max-width:520px){#fxnb-promo{right:12px;left:12px;bottom:12px;width:auto;}}';
      document.head.appendChild(css);

      var box = document.createElement('div');
      box.id = 'fxnb-promo';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Subscribe to daily forex sentiment');
      box.innerHTML =
        '<button class="fxnb-x" aria-label="Close">&times;</button>' +
        '<span class="fxnb-badge">Free daily digest</span>' +
        '<h3>Never miss a sentiment shift</h3>' +
        '<p>Get the daily forex sentiment digest free by email. No credit card, '
        + 'takes one tap.</p>' +
        '<a class="fxnb-primary" href="/register">Create your free account</a>' +
        '<a class="fxnb-secondary" href="' + TRIAL_URL + '" target="_blank" rel="noopener">Or start a 7-day Pro trial, API included</a>' +
        '<button class="fxnb-later">Maybe later</button>';
      document.body.appendChild(box);
      requestAnimationFrame(function () { box.classList.add('in'); });

      function close() { remember(); box.classList.remove('in'); setTimeout(function () { box.remove(); }, 250); }
      box.querySelector('.fxnb-x').addEventListener('click', close);
      box.querySelector('.fxnb-later').addEventListener('click', close);
      box.querySelector('.fxnb-primary').addEventListener('click', function () {
        remember(); if (typeof gtag !== 'undefined') gtag('event', 'promo_signup_click', { source_page: path });
      });
      box.querySelector('.fxnb-secondary').addEventListener('click', function () {
        remember(); if (typeof gtag !== 'undefined') gtag('event', 'promo_trial_click', { source_page: path });
      });
    }

    var timer = setTimeout(build, 12000); // show after 12s…
    function onScroll() {                  // …or at 45% scroll, whichever is first
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (h > 0 && (window.scrollY / h) > 0.45) { clearTimeout(timer); build(); window.removeEventListener('scroll', onScroll); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  } catch (e) { /* fail silently, never block the page */ }
})();
