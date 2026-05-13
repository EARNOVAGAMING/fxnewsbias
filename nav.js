// FXNewsBias - Animated mobile drawer (FXStreet-style)
(function () {

  if (!document.getElementById('fxnb-nav-styles')) {
    const css = `
      .logo{display:inline-flex;align-items:center;gap:10px;line-height:1;text-decoration:none;}
      .logo img{height:38px;width:auto;display:block;flex:0 0 auto;}
      .logo .logo-word{display:none!important;font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#f8fafc;
        font-style:normal;white-space:nowrap;}
      .logo .logo-word em{color:#3b82f6;font-style:normal;}
      @media(max-width:640px){
        .logo{gap:8px;}
        .logo img{height:30px;}
        .logo .logo-word{font-size:16px;}
      }
      @media(max-width:380px){
        .logo .logo-word{display:none;}
      }
      nav ul.fxnb-mobile li.fxnb-drawer-logo .logo-word{display:none;}
      .burger{background:none;border:none;cursor:pointer;width:40px;height:40px;
        padding:0;position:relative;z-index:1002;-webkit-tap-highlight-color:transparent;
        font-size:0;line-height:0;color:transparent;}
      .burger-box{position:relative;width:24px;height:18px;margin:0 auto;display:block;}
      .burger-line{position:absolute;left:0;width:100%;height:2px;background:#f1f5f9;
        border-radius:2px;transition:transform .35s cubic-bezier(.65,.05,.36,1),
        opacity .2s ease,top .35s cubic-bezier(.65,.05,.36,1);}
      .burger-line:nth-child(1){top:0;}
      .burger-line:nth-child(2){top:8px;}
      .burger-line:nth-child(3){top:16px;}
      .burger.is-open .burger-line:nth-child(1){top:8px;transform:rotate(45deg);}
      .burger.is-open .burger-line:nth-child(2){opacity:0;transform:translateX(-12px);}
      .burger.is-open .burger-line:nth-child(3){top:8px;transform:rotate(-45deg);}

      .nav-backdrop{position:fixed;inset:0;background:rgba(15,23,42,0);
        pointer-events:none;z-index:1000;transition:background .3s ease;}
      .nav-backdrop.is-open{background:rgba(15,23,42,.55);pointer-events:auto;}

      /* Drawer extras (CTA, Upgrade, Social, Footer, auth mirror)
         are mobile-only - hide everywhere by default so they don't appear in
         the desktop horizontal nav. The mobile media query re-shows them. */
      nav ul .fxnb-extra{display:none !important;}

      /* Hamburger drawer enabled at all viewports */
        nav ul.fxnb-mobile .fxnb-extra{display:block !important;}
        nav ul.fxnb-mobile .fxnb-social{display:flex !important;}
        nav ul.fxnb-mobile .fxnb-auth-user{display:flex !important;}
        .burger{display:flex !important;align-items:center;justify-content:center;}

        .nav-actions > a.btn,
        .nav-actions > #user-menu{display:none !important;}

        nav ul.fxnb-mobile li.fxnb-drawer-logo{padding:18px 16px 14px;display:flex;
          justify-content:center;align-items:center;background:linear-gradient(180deg,#0b1222,#0f172a);
          border-bottom:1px solid rgba(255,255,255,.08);}
        nav ul.fxnb-mobile li.fxnb-drawer-logo img{max-height:48px;width:auto;display:block;
          filter:drop-shadow(0 2px 6px rgba(0,0,0,.4));}
        nav ul.fxnb-mobile li.fxnb-drawer-logo:hover{background:linear-gradient(180deg,#0b1222,#0f172a);}

        nav ul.fxnb-mobile{position:fixed;top:0;right:0;height:100vh;width:min(86vw,360px);
          background:#0f172a;flex-direction:column;align-items:stretch;gap:0;padding:56px 0 0;
          margin:0;list-style:none;box-shadow:-12px 0 40px rgba(0,0,0,.4);
          transform:translateX(100%);transition:transform .42s cubic-bezier(.65,.05,.36,1);
          z-index:1001;overflow-y:auto;display:flex;color:#e2e8f0;
          -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
        nav ul.fxnb-mobile.is-open{transform:translateX(0);}
        nav ul.fxnb-mobile li{opacity:0;transform:translateX(20px);
          transition:opacity .3s ease,transform .3s ease;border-bottom:1px solid rgba(255,255,255,.06);
          list-style:none;}
        nav ul.fxnb-mobile.is-open li{opacity:1;transform:translateX(0);}
        nav ul.fxnb-mobile.is-open li:nth-child(1){transition-delay:.06s;}
        nav ul.fxnb-mobile.is-open li:nth-child(2){transition-delay:.10s;}
        nav ul.fxnb-mobile.is-open li:nth-child(3){transition-delay:.14s;}
        nav ul.fxnb-mobile.is-open li:nth-child(4){transition-delay:.18s;}
        nav ul.fxnb-mobile.is-open li:nth-child(5){transition-delay:.22s;}
        nav ul.fxnb-mobile.is-open li:nth-child(6){transition-delay:.26s;}
        nav ul.fxnb-mobile.is-open li:nth-child(7){transition-delay:.30s;}
        nav ul.fxnb-mobile.is-open li:nth-child(8){transition-delay:.34s;}
        nav ul.fxnb-mobile.is-open li:nth-child(9){transition-delay:.38s;}
        nav ul.fxnb-mobile.is-open li:nth-child(n+10){transition-delay:.42s;}

        nav ul.fxnb-mobile a,
        nav ul.fxnb-mobile button{display:block;width:100%;padding:15px 24px;font-size:15px;
          font-weight:600;color:#e2e8f0;text-decoration:none;text-align:left;background:none;
          border:none;cursor:pointer;transition:background .15s ease,color .15s ease,
          padding-left .2s ease;font-family:inherit;}
        nav ul.fxnb-mobile a:hover,nav ul.fxnb-mobile a:active,
        nav ul.fxnb-mobile button:hover,nav ul.fxnb-mobile button:active{
          background:rgba(37,99,235,.12);color:#60a5fa;padding-left:30px;}

        /* TOP CTA - Join Telegram */
        nav ul.fxnb-mobile li.fxnb-top-cta{padding:14px 16px;
          border-bottom:1px solid rgba(255,255,255,.06);background:#0f172a;}
        nav ul.fxnb-mobile li.fxnb-top-cta a{display:flex;align-items:center;gap:10px;
          padding:12px 14px;background:linear-gradient(135deg,#1e3a8a,#2563eb);
          border:1px solid rgba(96,165,250,.4);border-radius:10px;color:#fff;font-size:13px;
          font-weight:700;line-height:1.3;}
        nav ul.fxnb-mobile li.fxnb-top-cta a:hover,
        nav ul.fxnb-mobile li.fxnb-top-cta a:active{padding-left:14px;
          background:linear-gradient(135deg,#1d4ed8,#3b82f6);color:#fff;}
        nav ul.fxnb-mobile li.fxnb-top-cta a span{color:#fff !important;}
        nav ul.fxnb-mobile li.fxnb-top-cta a span span{color:#bfdbfe !important;}
        nav ul.fxnb-mobile li.fxnb-top-cta .cta-icon{font-size:22px;flex:0 0 auto;}
        nav ul.fxnb-mobile li.fxnb-top-cta .cta-arrow{margin-left:auto;font-size:18px;
          color:#fff;}

        /* AUTH section divider */
        nav ul.fxnb-mobile li.fxnb-auth-divider{border-top:8px solid #020617;
          border-bottom:none;padding:0;height:0;margin-top:8px;}
        nav ul.fxnb-mobile li.fxnb-auth-user{padding:16px 24px;background:rgba(255,255,255,.04);
          font-size:14px;font-weight:600;color:#f8fafc;display:flex;align-items:center;
          gap:8px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,.06);}
        nav ul.fxnb-mobile li.fxnb-auth-user .pro-badge{background:#f59e0b;color:#0f172a;
          font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;}
        nav ul.fxnb-mobile li.fxnb-auth-login a{color:#60a5fa;}
        nav ul.fxnb-mobile li.fxnb-auth-register a{color:#fff;background:#2563eb;}
        nav ul.fxnb-mobile li.fxnb-auth-register a:hover,
        nav ul.fxnb-mobile li.fxnb-auth-register a:active{background:#1d4ed8;color:#fff;}
        nav ul.fxnb-mobile li.fxnb-auth-logout button{color:#fca5a5;}
        nav ul.fxnb-mobile li.fxnb-auth-logout button:hover,
        nav ul.fxnb-mobile li.fxnb-auth-logout button:active{color:#f87171;
          background:rgba(239,68,68,.1);}

        /* BOTTOM section: Upgrade, Social, Footer */
        nav ul.fxnb-mobile li.fxnb-bottom-divider{border-top:8px solid #020617;
          border-bottom:none;padding:0;height:0;}

        nav ul.fxnb-mobile li.fxnb-upgrade{padding:16px;
          border-bottom:1px solid rgba(255,255,255,.06);}
        nav ul.fxnb-mobile li.fxnb-upgrade a{display:flex;align-items:center;justify-content:center;
          gap:8px;padding:14px 16px;background:linear-gradient(135deg,#f59e0b,#fbbf24);
          color:#0f172a;font-size:15px;font-weight:700;border-radius:10px;text-align:center;
          box-shadow:0 4px 12px rgba(245,158,11,.3);}
        nav ul.fxnb-mobile li.fxnb-upgrade a:hover,
        nav ul.fxnb-mobile li.fxnb-upgrade a:active{padding-left:16px;color:#0f172a;
          background:linear-gradient(135deg,#d97706,#f59e0b);}

        nav ul.fxnb-mobile li.fxnb-social{padding:14px 24px;display:flex;gap:10px;
          border-bottom:1px solid rgba(255,255,255,.06);}
        nav ul.fxnb-mobile li.fxnb-social a{flex:1;display:flex;align-items:center;
          justify-content:center;gap:6px;padding:10px 8px;background:rgba(255,255,255,.05);
          border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#cbd5e1;font-size:12px;
          font-weight:600;}
        nav ul.fxnb-mobile li.fxnb-social a:hover,
        nav ul.fxnb-mobile li.fxnb-social a:active{padding-left:8px;
          background:rgba(37,99,235,.15);color:#60a5fa;border-color:rgba(96,165,250,.4);}

        nav ul.fxnb-mobile li.fxnb-footer{padding:16px 24px 20px;border-bottom:none;
          background:#020617;}
        nav ul.fxnb-mobile li.fxnb-footer .links{display:flex;flex-wrap:wrap;gap:6px 12px;
          margin-bottom:10px;}
        nav ul.fxnb-mobile li.fxnb-footer .links a{padding:0;color:#94a3b8;font-size:12px;
          font-weight:500;width:auto;display:inline;}
        nav ul.fxnb-mobile li.fxnb-footer .links a:hover,
        nav ul.fxnb-mobile li.fxnb-footer .links a:active{padding-left:0;background:none;
          color:#60a5fa;}
        nav ul.fxnb-mobile li.fxnb-footer .copy{color:#64748b;font-size:11px;}

        body.fxnb-nav-locked{overflow:hidden;}
        body.fxnb-nav-locked header{z-index:1003 !important;}
    `;
    const style = document.createElement('style');
    style.id = 'fxnb-nav-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Affiliate / external URLs (kept here so they're easy to update)
  const TELEGRAM_URL  = 'https://t.me/fxnewsbias_alerts';
  const STRIPE_UPGRADE_URL = 'https://buy.stripe.com/00wfZjcoa2LzdDNaIS0RG00';
  const CONTACT_EMAIL = 'contact@fxnewsbias.com';

  function init() {
    const burger = document.querySelector('.burger');
    const navMenu = document.querySelector('nav ul');
    if (!burger || !navMenu) return;

    if (!burger.querySelector('.burger-box')) {
      burger.innerHTML = '<span class="burger-box">' +
        '<span class="burger-line"></span><span class="burger-line"></span>' +
        '<span class="burger-line"></span></span>';
      burger.setAttribute('aria-label', 'Toggle navigation menu');
      burger.setAttribute('aria-expanded', 'false');
    }

    navMenu.classList.add('fxnb-mobile');

    let backdrop = document.querySelector('.nav-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'nav-backdrop';
      document.body.appendChild(backdrop);
    }

    function buildAuthItems() {
      const items = [];
      const navActions = document.querySelector('.nav-actions');
      if (!navActions) return items;

      const userMenu = document.getElementById('user-menu');
      if (userMenu) {
        const nameSpan = userMenu.querySelector('span');
        const proBadge = userMenu.querySelectorAll('span')[1];
        const logoutBtn = userMenu.querySelector('button');

        if (nameSpan) {
          const li = document.createElement('li');
          li.className = 'fxnb-extra fxnb-auth-user';
          li.innerHTML = nameSpan.innerHTML +
            (proBadge ? '<span class="pro-badge">' + (proBadge.textContent.trim() || 'PRO') + '</span>' : '');
          items.push(li);
        }
        const profileLi = document.createElement('li');
        profileLi.className = 'fxnb-extra fxnb-auth-profile';
        profileLi.innerHTML = '<a href="/profile">👤 My Profile</a>';
        items.push(profileLi);

        if (logoutBtn) {
          const li = document.createElement('li');
          li.className = 'fxnb-extra fxnb-auth-logout';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'Logout';
          btn.addEventListener('click', function () {
            closeMenu();
            if (typeof window.logoutUser === 'function') window.logoutUser();
          });
          li.appendChild(btn);
          items.push(li);
        }
      } else {
        if (navActions.querySelector('a[href="/login"]')) {
          const li = document.createElement('li');
          li.className = 'fxnb-extra fxnb-auth-login';
          li.innerHTML = '<a href="/login">→ Login</a>';
          items.push(li);
        }
        if (navActions.querySelector('a[href="/register"]')) {
          const li = document.createElement('li');
          li.className = 'fxnb-extra fxnb-auth-register';
          li.innerHTML = '<a href="/register">Create Account</a>';
          items.push(li);
        }
      }
      return items;
    }

    function rebuildDrawerExtras() {
      // Wipe everything we previously injected
      navMenu.querySelectorAll('.fxnb-extra').forEach(el => el.remove());

      // -------- TOP CTA: Telegram --------
      const topCta = document.createElement('li');
      topCta.className = 'fxnb-extra fxnb-top-cta';
      topCta.innerHTML =
        `<a href="${TELEGRAM_URL}" target="_blank" rel="noopener noreferrer">
           <span class="cta-icon">📱</span>
           <span>Free FX alerts<br><span style="font-size:11px;font-weight:500;">on Telegram every 3 hours</span></span>
           <span class="cta-arrow">›</span>
         </a>`;
      navMenu.insertBefore(topCta, navMenu.firstChild);

      // -------- DRAWER LOGO (very top, above CTA) --------
      const drawerLogo = document.createElement('li');
      drawerLogo.className = 'fxnb-extra fxnb-drawer-logo';
      drawerLogo.innerHTML = '<a href="/" aria-label="FXNB Home" style="padding:0;background:none;"><img src="/logo-fxnb.png" alt="FXNB"></a>';
      navMenu.insertBefore(drawerLogo, navMenu.firstChild);

      // -------- AUTH section --------
      const authDivider = document.createElement('li');
      authDivider.className = 'fxnb-extra fxnb-auth-divider';
      navMenu.appendChild(authDivider);
      buildAuthItems().forEach(li => navMenu.appendChild(li));

      // -------- BOTTOM section --------
      const bottomDivider = document.createElement('li');
      bottomDivider.className = 'fxnb-extra fxnb-bottom-divider';
      navMenu.appendChild(bottomDivider);

      // Upgrade to PRO (hide if user already PRO)
      if (!window.userIsPro) {
        const upg = document.createElement('li');
        upg.className = 'fxnb-extra fxnb-upgrade';
        upg.innerHTML =
          `<a href="${STRIPE_UPGRADE_URL}" target="_blank" rel="noopener noreferrer">
             ⭐ Upgrade to PRO — $9.99/mo
           </a>`;
        navMenu.appendChild(upg);
      }

      // Social row
      const social = document.createElement('li');
      social.className = 'fxnb-extra fxnb-social';
      social.innerHTML =
        `<a href="${TELEGRAM_URL}" target="_blank" rel="noopener noreferrer">📱 Telegram</a>
         <a href="mailto:${CONTACT_EMAIL}">✉ Email</a>`;
      navMenu.appendChild(social);

      // Mini footer
      const footer = document.createElement('li');
      footer.className = 'fxnb-extra fxnb-footer';
      const yr = new Date().getFullYear();
      footer.innerHTML =
        `<div class="links">
           <a href="/about">About</a>
           <a href="/how">How it works</a>
           <a href="/contact">Contact</a>
           <a href="/privacy">Privacy</a>
           <a href="/terms">Terms</a>
           <a href="/disclaimer">Disclaimer</a>
         </div>
         <div class="copy">© ${yr} FXNewsBias · All rights reserved</div>`;
      navMenu.appendChild(footer);
    }

    function openMenu() {
      rebuildDrawerExtras();
      burger.classList.add('is-open');
      navMenu.classList.add('is-open');
      backdrop.classList.add('is-open');
      document.body.classList.add('fxnb-nav-locked');
      burger.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      burger.classList.remove('is-open');
      navMenu.classList.remove('is-open');
      backdrop.classList.remove('is-open');
      document.body.classList.remove('fxnb-nav-locked');
      burger.setAttribute('aria-expanded', 'false');
    }

    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (navMenu.classList.contains('is-open')) closeMenu(); else openMenu();
    });
    backdrop.addEventListener('click', closeMenu);
    navMenu.addEventListener('click', function (e) {
      const link = e.target.closest('a');
      if (link) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navMenu.classList.contains('is-open')) closeMenu();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900 && navMenu.classList.contains('is-open')) closeMenu();
    });

    window.addEventListener('userLoaded', rebuildDrawerExtras);
    rebuildDrawerExtras();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
