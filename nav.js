// FXNewsBias - Navigation hamburger menu (animated, mobile-safe)
(function () {

  // Inject styles once - every page that uses nav.js inherits the polish
  // without needing to edit each HTML file's <style> block.
  if (!document.getElementById('fxnb-nav-styles')) {
    const css = `
      .burger{background:none;border:none;cursor:pointer;width:40px;height:40px;
        padding:0;position:relative;z-index:1002;-webkit-tap-highlight-color:transparent;
        font-size:0;line-height:0;color:transparent;}
      .burger-box{position:relative;width:24px;height:18px;margin:0 auto;display:block;}
      .burger-line{position:absolute;left:0;width:100%;height:2px;background:#0f172a;
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

      @media(max-width:900px){
        .burger{display:flex !important;align-items:center;justify-content:center;}

        /* Hide login/register/user-menu buttons in the header on mobile -
           they're mirrored into the drawer instead so they don't overlap the burger. */
        .nav-actions > a.btn,
        .nav-actions > #user-menu{display:none !important;}

        nav ul.fxnb-mobile{position:fixed;top:0;right:0;height:100vh;width:min(82vw,340px);
          background:#fff;flex-direction:column;align-items:stretch;gap:0;padding:80px 0 24px;
          margin:0;list-style:none;box-shadow:-12px 0 40px rgba(0,0,0,.12);
          transform:translateX(100%);transition:transform .42s cubic-bezier(.65,.05,.36,1);
          z-index:1001;overflow-y:auto;display:flex;
          -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
        nav ul.fxnb-mobile.is-open{transform:translateX(0);}
        nav ul.fxnb-mobile li{opacity:0;transform:translateX(20px);
          transition:opacity .3s ease,transform .3s ease;border-bottom:1px solid #f1f5f9;
          list-style:none;}
        nav ul.fxnb-mobile.is-open li{opacity:1;transform:translateX(0);}
        nav ul.fxnb-mobile.is-open li:nth-child(1){transition-delay:.10s;}
        nav ul.fxnb-mobile.is-open li:nth-child(2){transition-delay:.14s;}
        nav ul.fxnb-mobile.is-open li:nth-child(3){transition-delay:.18s;}
        nav ul.fxnb-mobile.is-open li:nth-child(4){transition-delay:.22s;}
        nav ul.fxnb-mobile.is-open li:nth-child(5){transition-delay:.26s;}
        nav ul.fxnb-mobile.is-open li:nth-child(6){transition-delay:.30s;}
        nav ul.fxnb-mobile.is-open li:nth-child(7){transition-delay:.34s;}
        nav ul.fxnb-mobile.is-open li:nth-child(8){transition-delay:.38s;}
        nav ul.fxnb-mobile.is-open li:nth-child(9){transition-delay:.42s;}
        nav ul.fxnb-mobile.is-open li:nth-child(n+10){transition-delay:.46s;}
        nav ul.fxnb-mobile a,
        nav ul.fxnb-mobile button{display:block;width:100%;padding:16px 24px;font-size:15px;
          font-weight:600;color:#1a1a1a;text-decoration:none;text-align:left;background:none;
          border:none;cursor:pointer;transition:background .15s ease,color .15s ease,
          padding-left .2s ease;font-family:inherit;}
        nav ul.fxnb-mobile a:hover,nav ul.fxnb-mobile a:active,
        nav ul.fxnb-mobile button:hover,nav ul.fxnb-mobile button:active{
          background:#f8fafc;color:#2563eb;padding-left:30px;}

        /* Auth section at the bottom of the drawer - visually separated */
        nav ul.fxnb-mobile li.fxnb-auth-divider{border-top:8px solid #f8fafc;
          border-bottom:none;padding:0;height:0;margin-top:8px;}
        nav ul.fxnb-mobile li.fxnb-auth-user{padding:16px 24px;background:#f8fafc;
          font-size:14px;font-weight:600;color:#0f172a;display:flex;align-items:center;
          gap:8px;flex-wrap:wrap;}
        nav ul.fxnb-mobile li.fxnb-auth-user .pro-badge{background:#f59e0b;color:#fff;
          font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;}
        nav ul.fxnb-mobile li.fxnb-auth-login a{color:#2563eb;}
        nav ul.fxnb-mobile li.fxnb-auth-register a{color:#fff;background:#2563eb;}
        nav ul.fxnb-mobile li.fxnb-auth-register a:hover,
        nav ul.fxnb-mobile li.fxnb-auth-register a:active{background:#1d4ed8;color:#fff;}
        nav ul.fxnb-mobile li.fxnb-auth-logout button{color:#ef4444;}

        body.fxnb-nav-locked{overflow:hidden;}
        /* Lift the header (which contains the drawer) above the backdrop so
           taps reach the drawer items instead of the invisible overlay. */
        body.fxnb-nav-locked header{z-index:1003 !important;}
      }
    `;
    const style = document.createElement('style');
    style.id = 'fxnb-nav-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function init() {
    let burger = document.querySelector('.burger');
    const navMenu = document.querySelector('nav ul');
    if (!burger || !navMenu) return;

    // Replace simple text burger with three animated lines that morph to X.
    if (!burger.querySelector('.burger-box')) {
      burger.innerHTML = '<span class="burger-box">' +
        '<span class="burger-line"></span>' +
        '<span class="burger-line"></span>' +
        '<span class="burger-line"></span>' +
        '</span>';
      burger.setAttribute('aria-label', 'Toggle navigation menu');
      burger.setAttribute('aria-expanded', 'false');
    }

    navMenu.classList.add('fxnb-mobile');

    // Backdrop element (created once, reused).
    let backdrop = document.querySelector('.nav-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'nav-backdrop';
      document.body.appendChild(backdrop);
    }

    // Mirror auth buttons (Login/Register or user-menu Logout) into the drawer
    // so they're never adjacent to the burger and can't be tapped by accident.
    function syncAuthIntoDrawer() {
      // Remove any previous mirrored items first
      navMenu.querySelectorAll('.fxnb-auth-item').forEach(el => el.remove());

      const navActions = document.querySelector('.nav-actions');
      if (!navActions) return;

      const divider = document.createElement('li');
      divider.className = 'fxnb-auth-item fxnb-auth-divider';

      const items = [];

      // Logged-in case: user-menu exists with name + optional PRO badge + Logout
      const userMenu = document.getElementById('user-menu');
      if (userMenu) {
        const nameSpan = userMenu.querySelector('span');
        const proBadge = userMenu.querySelectorAll('span')[1];
        const logoutBtn = userMenu.querySelector('button');

        if (nameSpan) {
          const li = document.createElement('li');
          li.className = 'fxnb-auth-item fxnb-auth-user';
          li.innerHTML = nameSpan.innerHTML +
            (proBadge ? '<span class="pro-badge">' + (proBadge.textContent.trim() || 'PRO') + '</span>' : '');
          items.push(li);
        }
        // Profile shortcut for logged-in users
        const profileLi = document.createElement('li');
        profileLi.className = 'fxnb-auth-item fxnb-auth-profile';
        profileLi.innerHTML = '<a href="/profile">👤 My Profile</a>';
        items.push(profileLi);

        if (logoutBtn) {
          const li = document.createElement('li');
          li.className = 'fxnb-auth-item fxnb-auth-logout';
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
        // Logged-out case: mirror Login + Register links
        const loginLink = navActions.querySelector('a[href="/login"]');
        const registerLink = navActions.querySelector('a[href="/register"]');
        if (loginLink) {
          const li = document.createElement('li');
          li.className = 'fxnb-auth-item fxnb-auth-login';
          li.innerHTML = '<a href="/login">→ Login</a>';
          items.push(li);
        }
        if (registerLink) {
          const li = document.createElement('li');
          li.className = 'fxnb-auth-item fxnb-auth-register';
          li.innerHTML = '<a href="/register">Create Account</a>';
          items.push(li);
        }
      }

      if (items.length) {
        navMenu.appendChild(divider);
        items.forEach(li => navMenu.appendChild(li));
      }
    }

    function openMenu() {
      syncAuthIntoDrawer();   // refresh in case auth state changed since last open
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

    // Close on link clicks (delegated so newly-added auth items work too).
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

    // Re-sync when firebase signals a user has loaded/changed.
    window.addEventListener('userLoaded', syncAuthIntoDrawer);
    // Initial sync (in case user was already loaded before nav init).
    syncAuthIntoDrawer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
