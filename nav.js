// FXNewsBias - Navigation hamburger menu (animated)
(function () {

  // Inject styles once, so every page that uses nav.js inherits the polish
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
        backdrop-filter:blur(0);pointer-events:none;z-index:1000;
        transition:background .3s ease,backdrop-filter .3s ease;}
      .nav-backdrop.is-open{background:rgba(15,23,42,.45);backdrop-filter:blur(4px);
        pointer-events:auto;}

      @media(max-width:900px){
        .burger{display:flex !important;align-items:center;justify-content:center;}
        nav ul.fxnb-mobile{position:fixed;top:0;right:0;height:100vh;width:min(82vw,340px);
          background:#fff;flex-direction:column;align-items:stretch;gap:0;padding:80px 0 24px;
          margin:0;list-style:none;box-shadow:-12px 0 40px rgba(0,0,0,.12);
          transform:translateX(100%);transition:transform .42s cubic-bezier(.65,.05,.36,1);
          z-index:1001;overflow-y:auto;display:flex;}
        nav ul.fxnb-mobile.is-open{transform:translateX(0);}
        nav ul.fxnb-mobile li{opacity:0;transform:translateX(20px);
          transition:opacity .3s ease,transform .3s ease;border-bottom:1px solid #f1f5f9;}
        nav ul.fxnb-mobile.is-open li{opacity:1;transform:translateX(0);}
        nav ul.fxnb-mobile.is-open li:nth-child(1){transition-delay:.12s;}
        nav ul.fxnb-mobile.is-open li:nth-child(2){transition-delay:.17s;}
        nav ul.fxnb-mobile.is-open li:nth-child(3){transition-delay:.22s;}
        nav ul.fxnb-mobile.is-open li:nth-child(4){transition-delay:.27s;}
        nav ul.fxnb-mobile.is-open li:nth-child(5){transition-delay:.32s;}
        nav ul.fxnb-mobile.is-open li:nth-child(6){transition-delay:.37s;}
        nav ul.fxnb-mobile.is-open li:nth-child(7){transition-delay:.42s;}
        nav ul.fxnb-mobile.is-open li:nth-child(8){transition-delay:.47s;}
        nav ul.fxnb-mobile.is-open li:nth-child(n+9){transition-delay:.5s;}
        nav ul.fxnb-mobile a{display:block;padding:16px 24px;font-size:15px;font-weight:600;
          color:#1a1a1a;text-decoration:none;transition:background .15s ease,color .15s ease,
          padding-left .2s ease;}
        nav ul.fxnb-mobile a:hover,nav ul.fxnb-mobile a:active{background:#f8fafc;color:#2563eb;
          padding-left:30px;}
        body.fxnb-nav-locked{overflow:hidden;}
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

    // Replace the simple ☰ text with three animated lines so we can morph to an X.
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

    function openMenu() {
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

    navMenu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });

    // ESC closes the menu (keyboard / external keyboard users).
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navMenu.classList.contains('is-open')) closeMenu();
    });

    // Close if the viewport grows past mobile breakpoint while open.
    window.addEventListener('resize', function () {
      if (window.innerWidth > 900 && navMenu.classList.contains('is-open')) closeMenu();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
