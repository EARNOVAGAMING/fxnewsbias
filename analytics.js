// FXNewsBias - Global Analytics Event Tracking

document.addEventListener('DOMContentLoaded', function() {

  // ============================================
  // PAGE VIEW WITH PAGE NAME
  // ============================================
  const pageMap = {
    '/': 'Dashboard',
    '/index.html': 'Dashboard',
    '/currencies.html': 'Currencies',
    '/pairs.html': 'Pairs',
    '/news.html': 'News',
    '/calendar.html': 'Calendar',
    '/community.html': 'Community',
    '/history.html': 'History (Pro)',
    '/report.html': 'Report (Pro)',
    '/login.html': 'Login',
    '/register.html': 'Register',
    '/profile.html': 'Profile',
    '/about.html': 'About',
    '/how.html': 'How It Works',
    '/contact.html': 'Contact'
  };
  const pageName = pageMap[window.location.pathname] || window.location.pathname;
  gtag('event', 'page_viewed', { page_name: pageName });

  // ============================================
  // PRO UPGRADE CLICKED (conversion — most important)
  // ============================================
  document.querySelectorAll('a[href*="buy.stripe.com"]').forEach(btn => {
    btn.addEventListener('click', () => {
      gtag('event', 'pro_upgrade_clicked', {
        page_name: pageName,
        button_text: btn.textContent.trim().substring(0, 50)
      });
    });
  });

  // ============================================
  // TELEGRAM SUBSCRIBE CLICKED
  // ============================================
  document.querySelectorAll('a[href*="t.me"]').forEach(btn => {
    btn.addEventListener('click', () => {
      gtag('event', 'telegram_subscribe_clicked', {
        page_name: pageName
      });
    });
  });

  // ============================================
  // NAV LINKS CLICKED
  // ============================================
  document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', () => {
      gtag('event', 'nav_link_clicked', {
        page_name: pageName,
        destination: link.textContent.trim()
      });
    });
  });

  // ============================================
  // LOGIN / REGISTER BUTTONS CLICKED
  // ============================================
  const loginBtn = document.querySelector('a[href="/login.html"]');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      gtag('event', 'login_button_clicked', { page_name: pageName });
    });
  }

  const registerBtn = document.querySelector('a[href="/register.html"]');
  if (registerBtn) {
    registerBtn.addEventListener('click', () => {
      gtag('event', 'register_button_clicked', { page_name: pageName });
    });
  }

  // ============================================
  // LOGOUT CLICKED
  // ============================================
  document.addEventListener('click', function(e) {
    if (e.target && e.target.textContent === 'Logout') {
      gtag('event', 'logout_clicked', { page_name: pageName });
    }
  });

  // ============================================
  // BURGER MENU OPENED (mobile usage tracking)
  // ============================================
  const burger = document.querySelector('.burger');
  if (burger) {
    burger.addEventListener('click', () => {
      gtag('event', 'mobile_menu_opened', { page_name: pageName });
    });
  }

  // ============================================
  // FOOTER LINKS CLICKED
  // ============================================
  document.querySelectorAll('footer a').forEach(link => {
    link.addEventListener('click', () => {
      gtag('event', 'footer_link_clicked', {
        page_name: pageName,
        link_text: link.textContent.trim()
      });
    });
  });

  // ============================================
  // COMMUNITY PAGE SPECIFIC
  // ============================================
  if (window.location.pathname.includes('community')) {
    // Write post button
    const writeBtn = document.getElementById('write-post-btn');
    if (writeBtn) {
      writeBtn.addEventListener('click', () => {
        gtag('event', 'community_write_post_clicked', { page_name: pageName });
      });
    }
    // Filter tabs
    document.querySelectorAll('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        gtag('event', 'community_filter_used', {
          filter: tab.textContent.trim()
        });
      });
    });
  }

  // ============================================
  // NEWS PAGE SPECIFIC
  // ============================================
  if (window.location.pathname.includes('news')) {
    // Category tabs
    document.querySelectorAll('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        gtag('event', 'news_filter_used', {
          filter: tab.textContent.trim()
        });
      });
    });
    // News article clicked
    document.querySelectorAll('.news-card').forEach(card => {
      card.addEventListener('click', () => {
        const title = card.querySelector('.news-title');
        gtag('event', 'news_article_clicked', {
          article_title: title ? title.textContent.trim().substring(0, 100) : 'unknown'
        });
      });
    });
  }

  // ============================================
  // CURRENCIES PAGE SPECIFIC
  // ============================================
  if (window.location.pathname.includes('currencies')) {
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        gtag('event', 'currency_filter_used', {
          filter: btn.textContent.trim()
        });
      });
    });
    // Currency card clicked
    document.querySelectorAll('.curr-card').forEach(card => {
      card.addEventListener('click', () => {
        const curr = card.querySelector('h3');
        gtag('event', 'currency_card_clicked', {
          currency: curr ? curr.textContent.trim() : 'unknown'
        });
      });
    });
  }

  // ============================================
  // PAIRS PAGE SPECIFIC
  // ============================================
  if (window.location.pathname.includes('pairs')) {
    // Tab switched
    document.querySelectorAll('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        gtag('event', 'pairs_tab_switched', {
          tab: tab.textContent.trim()
        });
      });
    });
    // Pair row clicked
    document.addEventListener('click', function(e) {
      const row = e.target.closest('.pair-row');
      if (row) {
        const pair = row.querySelector('.pair-name');
        gtag('event', 'pair_row_clicked', {
          pair: pair ? pair.textContent.trim().substring(0, 20) : 'unknown'
        });
      }
    });
  }

  // ============================================
  // CALENDAR PAGE SPECIFIC
  // ============================================
  if (window.location.pathname.includes('calendar')) {
    gtag('event', 'calendar_page_viewed');
    const iframe = document.querySelector('.cal-embed iframe');
    if (iframe) {
      iframe.addEventListener('load', () => {
        gtag('event', 'calendar_iframe_loaded');
      });
    }
  }

  // ============================================
  // HISTORY PAGE SPECIFIC (Pro)
  // ============================================
  if (window.location.pathname.includes('history')) {
    document.querySelectorAll('.curr-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        gtag('event', 'history_currency_changed', {
          currency: tab.getAttribute('data-curr')
        });
      });
    });
    document.querySelectorAll('.range-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        gtag('event', 'history_range_changed', {
          range: tab.getAttribute('data-days') + 'D'
        });
      });
    });
  }

  // ============================================
  // REPORT PAGE SPECIFIC (Pro)
  // ============================================
  if (window.location.pathname.includes('report')) {
    const downloadBtn = document.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        gtag('event', 'report_pdf_downloaded');
      });
    }
  }

});

// ============================================
// LOGIN / REGISTER SUCCESS (called from firebase.js)
// ============================================
window.trackLoginSuccess = function(method) {
  gtag('event', 'login_success', { method: method || 'email' });
};
window.trackRegisterSuccess = function() {
  gtag('event', 'register_success');
};
window.trackLoginFailed = function() {
  gtag('event', 'login_failed');
};