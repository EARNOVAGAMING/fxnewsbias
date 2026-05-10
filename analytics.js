// FXNewsBias - Complete Analytics Event Tracking
// Version 1.0

document.addEventListener('DOMContentLoaded', function() {

  // ============================================
  // 📏 SCROLL DEPTH TRACKING (25/50/75/100%)
  // ============================================
  const scrollMilestones = [25, 50, 75, 100];
  const scrollFired = {};
  let scrollTimer = null;
  function checkScrollDepth() {
    const docHeight = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight, document.documentElement.offsetHeight
    );
    const winHeight = window.innerHeight;
    const scrolled = window.scrollY + winHeight;
    const percent = Math.min(100, Math.round((scrolled / docHeight) * 100));
    scrollMilestones.forEach(m => {
      if (percent >= m && !scrollFired[m]) {
        scrollFired[m] = true;
        if (typeof gtag !== 'undefined') {
          gtag('event', 'scroll_depth', {
            page_name: pageName,
            depth_percent: m
          });
        }
      }
    });
  }
  window.addEventListener('scroll', () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { checkScrollDepth(); scrollTimer = null; }, 250);
  }, { passive: true });

  // ============================================
  // ⏱️ ENGAGED TIME TRACKING (30s milestone)
  // ============================================
  let engaged30Fired = false;
  setTimeout(() => {
    if (!engaged30Fired && document.visibilityState === 'visible') {
      engaged30Fired = true;
      if (typeof gtag !== 'undefined') {
        gtag('event', 'engaged_30s', { page_name: pageName });
      }
    }
  }, 30000);

  // ============================================
  // PAGE NAME MAPPER
  // ============================================
  const pageMap = {
    '/': 'Dashboard',
    '/currencies': 'Currencies',
    '/pairs': 'Pairs',
    '/news': 'News',
    '/calendar': 'Calendar',
    '/community': 'Community',
    '/history': 'History_Pro',
    '/report': 'Report_Pro',
    '/login': 'Login',
    '/register': 'Register',
    '/profile': 'Profile',
    '/about': 'About',
    '/how': 'How_It_Works',
    '/contact': 'Contact',
    '/disclaimer': 'Disclaimer',
    '/privacy': 'Privacy',
    '/terms': 'Terms'
  };
  const pageName = pageMap[window.location.pathname] || window.location.pathname;

  // ============================================
  // HELPER FUNCTION
  // ============================================
  function track(eventName, params) {
    if (typeof gtag !== 'undefined') {
      gtag('event', eventName, { page_name: pageName, ...params });
    }
  }

  // ============================================
  // 🔴 CONVERSION EVENTS
  // ============================================

  // Pro Upgrade Button Clicked
  document.querySelectorAll('a[href*="buy.stripe.com"]').forEach(btn => {
    btn.addEventListener('click', () => {
      track('pro_upgrade_clicked', {
        button_text: btn.textContent.trim().substring(0, 50),
        source_page: pageName
      });
    });
  });

  // Telegram Subscribe Clicked
  document.querySelectorAll('a[href*="t.me"]').forEach(btn => {
    btn.addEventListener('click', () => {
      track('telegram_subscribe_clicked', {
        source_page: pageName
      });
    });
  });

  // Google Login Clicked
  document.querySelectorAll('button[onclick*="loginWithGoogle"]').forEach(btn => {
    btn.addEventListener('click', () => {
      track('google_login_clicked', {
        source_page: pageName
      });
    });
  });

  // ============================================
  // 🟡 AUTH EVENTS
  // ============================================

  // Login Button Clicked
  const loginBtn = document.querySelector('a[href="/login"]');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      track('login_button_clicked');
    });
  }

  // Register Button Clicked
  const registerBtn = document.querySelector('a[href="/register"]');
  if (registerBtn) {
    registerBtn.addEventListener('click', () => {
      track('register_button_clicked');
    });
  }

  // Forgot Password Clicked
  const forgotBtn = document.querySelector('a[onclick*="handleForgotPassword"]');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', () => {
      track('password_reset_requested');
    });
  }

  // Logout Clicked
  document.addEventListener('click', function(e) {
    if (e.target && e.target.textContent.trim() === 'Logout') {
      track('logout_clicked');
    }
  });

  // ============================================
  // 🟡 COOKIE CONSENT EVENTS
  // ============================================
  const cookieAccept = document.getElementById('cookie-accept');
  if (cookieAccept) {
    cookieAccept.addEventListener('click', () => {
      track('cookie_accepted');
    });
  }
  const cookieDecline = document.getElementById('cookie-decline');
  if (cookieDecline) {
    cookieDecline.addEventListener('click', () => {
      track('cookie_declined');
    });
  }

  // ============================================
  // 🟢 NAVIGATION EVENTS
  // ============================================

  // Nav Links
  document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', () => {
      track('nav_link_clicked', {
        destination: link.textContent.trim()
      });
    });
  });

  // Mobile Burger Menu
  const burger = document.querySelector('.burger');
  if (burger) {
    burger.addEventListener('click', () => {
      track('mobile_menu_opened');
    });
  }

  // Footer Links
  document.querySelectorAll('footer a').forEach(link => {
    link.addEventListener('click', () => {
      track('footer_link_clicked', {
        link_text: link.textContent.trim()
      });
    });
  });

  // ============================================
  // 📊 INDEX / DASHBOARD PAGE
  // ============================================
  if (pageName === 'Dashboard') {

    // Sentiment cards clicked
    document.querySelectorAll('.sent-card').forEach(card => {
      card.addEventListener('click', () => {
        const curr = card.getAttribute('data-currency');
        track('currency_card_clicked', { currency: curr });
      });
    });

    // News items clicked
    document.querySelectorAll('.news-item').forEach(item => {
      item.addEventListener('click', () => {
        const title = item.querySelector('.news-title');
        track('news_item_clicked', {
          title: title ? title.textContent.trim().substring(0, 100) : 'unknown'
        });
      });
    });

    // Hot pairs clicked
    document.querySelectorAll('#hot-pairs .session-row').forEach(row => {
      row.addEventListener('click', () => {
        const pair = row.querySelector('span');
        track('hot_pair_clicked', {
          pair: pair ? pair.textContent.trim() : 'unknown'
        });
      });
    });

    // Sentiment loaded successfully
    window.trackSentimentLoaded = function(mood) {
      track('sentiment_data_loaded', { market_mood: mood });
    };
  }

  // ============================================
  // 💱 CURRENCIES PAGE
  // ============================================
  if (pageName === 'Currencies') {

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        track('currency_filter_used', {
          filter: btn.textContent.trim()
        });
      });
    });

    // Currency cards
    document.querySelectorAll('.curr-card').forEach(card => {
      card.addEventListener('click', () => {
        const curr = card.querySelector('h3');
        track('currency_card_clicked', {
          currency: curr ? curr.textContent.trim() : 'unknown'
        });
      });
    });

    // Deep dive clicked
    document.querySelectorAll('.curr-arrow').forEach(link => {
      link.addEventListener('click', () => {
        track('currency_deep_dive_clicked');
      });
    });
  }

  // ============================================
  // 📈 PAIRS PAGE
  // ============================================
  if (pageName === 'Pairs') {

    // Tab switched
    document.querySelectorAll('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        track('pairs_tab_switched', {
          tab: tab.textContent.trim()
        });
      });
    });

    // Pair row clicked
    document.addEventListener('click', function(e) {
      const row = e.target.closest('.pair-row');
      if (row) {
        const pair = row.querySelector('.pair-name');
        track('pair_row_clicked', {
          pair: pair ? pair.textContent.trim().substring(0, 20) : 'unknown'
        });
      }
    });

    // Comment posted
    window.trackPairCommentPosted = function(bias) {
      track('pairs_comment_posted', { bias: bias });
    };

    // Comment liked
    window.trackPairCommentLiked = function() {
      track('pairs_comment_liked');
    };
  }

  // ============================================
  // 📰 NEWS PAGE
  // ============================================
  if (pageName === 'News') {

    // Category tabs
    document.querySelectorAll('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        track('news_filter_used', {
          filter: tab.textContent.trim()
        });
      });
    });

    // News cards clicked
    document.addEventListener('click', function(e) {
      const card = e.target.closest('.news-card');
      if (card) {
        const title = card.querySelector('.news-title');
        track('news_article_clicked', {
          title: title ? title.textContent.trim().substring(0, 100) : 'unknown'
        });
      }
    });

    // Trending clicked
    document.addEventListener('click', function(e) {
      const trending = e.target.closest('.trending-item');
      if (trending) {
        const title = trending.querySelector('.trending-title');
        track('news_trending_clicked', {
          title: title ? title.textContent.trim().substring(0, 100) : 'unknown'
        });
      }
    });

    // Source filter clicked
    document.querySelectorAll('.source-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        const name = tag.querySelector('.source-name');
        track('news_source_filtered', {
          source: name ? name.textContent.trim() : 'unknown'
        });
      });
    });

    // Featured story clicked
    const featured = document.querySelector('.featured');
    if (featured) {
      featured.addEventListener('click', () => {
        track('news_featured_clicked');
      });
    }
  }

  // ============================================
  // 📅 CALENDAR PAGE
  // ============================================
  if (pageName === 'Calendar') {
    track('calendar_page_viewed');

    const iframe = document.querySelector('.cal-embed iframe');
    if (iframe) {
      iframe.addEventListener('load', () => {
        track('calendar_iframe_loaded');
      });
    }
  }

  // ============================================
  // 👥 COMMUNITY PAGE
  // ============================================
  if (pageName === 'Community') {

    // Write post button
    const writeBtn = document.getElementById('write-post-btn');
    if (writeBtn) {
      writeBtn.addEventListener('click', () => {
        track('community_write_post_clicked');
      });
    }

    // Filter tabs
    document.querySelectorAll('.cat-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        track('community_filter_used', {
          filter: tab.textContent.trim()
        });
      });
    });

    // Post submitted
    window.trackCommunityPostCreated = function(bias) {
      track('community_post_created', { bias: bias || 'none' });
    };

    // Post liked
    window.trackCommunityPostLiked = function() {
      track('community_post_liked');
    };

    // Post saved
    window.trackCommunityPostSaved = function() {
      track('community_post_saved');
    };

    // Image uploaded in post
    window.trackCommunityImageUploaded = function() {
      track('community_post_image_uploaded');
    };

    // Post deleted
    window.trackCommunityPostDeleted = function() {
      track('community_post_deleted');
    };
  }

  // ============================================
  // 📊 HISTORY PAGE (Pro)
  // ============================================
  if (pageName === 'History_Pro') {

    // Currency tab switched
    document.querySelectorAll('.curr-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        track('history_currency_changed', {
          currency: tab.getAttribute('data-curr')
        });
      });
    });

    // Range changed
    document.querySelectorAll('.range-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        track('history_range_changed', {
          range: tab.getAttribute('data-days') + 'D'
        });
      });
    });

    // Pro gate seen vs content seen
    window.trackProGateViewed = function() {
      track('pro_gate_viewed', { feature: 'History' });
    };
    window.trackProContentViewed = function() {
      track('pro_content_viewed', { feature: 'History' });
    };
  }

  // ============================================
  // 📄 REPORT PAGE (Pro)
  // ============================================
  if (pageName === 'Report_Pro') {

    // PDF downloaded
    const downloadBtn = document.querySelector('.download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        track('report_pdf_downloaded');
      });
    }

    // Pro gate seen vs content seen
    window.trackProGateViewed = function() {
      track('pro_gate_viewed', { feature: 'Report' });
    };
    window.trackProContentViewed = function() {
      track('pro_content_viewed', { feature: 'Report' });
    };
  }

  // ============================================
  // 👤 PROFILE PAGE
  // ============================================
  if (pageName === 'Profile') {

    // Username edit clicked
    window.trackUsernameEditClicked = function() {
      track('username_edit_clicked');
    };

    // Username saved
    window.trackUsernameSaved = function() {
      track('username_updated');
    };

    // Profile picture updated
    window.trackProfilePictureUpdated = function() {
      track('profile_picture_updated');
    };

    // Upgrade from profile
    document.querySelectorAll('a[href*="buy.stripe.com"]').forEach(btn => {
      btn.addEventListener('click', () => {
        track('pro_upgrade_clicked', {
          source_page: 'Profile',
          button_text: btn.textContent.trim().substring(0, 50)
        });
      });
    });
  }

});

// ============================================
// 🔴 GLOBAL TRACKING FUNCTIONS
// Called from firebase.js and other scripts
// ============================================

window.trackLoginSuccess = function(method) {
  if (typeof gtag !== 'undefined') {
    gtag('event', 'login_success', {
      method: method || 'email'
    });
  }
};

window.trackLoginFailed = function(reason) {
  if (typeof gtag !== 'undefined') {
    gtag('event', 'login_failed', {
      reason: reason || 'unknown'
    });
  }
};

window.trackRegisterSuccess = function() {
  if (typeof gtag !== 'undefined') {
    gtag('event', 'register_success');
  }
};

window.trackRegisterFailed = function(reason) {
  if (typeof gtag !== 'undefined') {
    gtag('event', 'register_failed', {
      reason: reason || 'unknown'
    });
  }
};