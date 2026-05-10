import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const mobileNavStyle = document.createElement('style');
mobileNavStyle.textContent = `
  @media(max-width:900px){
    .user-menu-name { display: none !important; }
    #user-menu { gap: 6px !important; }
  }
`;
document.head.appendChild(mobileNavStyle);

const firebaseConfig = {
  apiKey: "AIzaSyD88nfD-GSk2icxgPMqOHOuLjCM19Zzso4",
  authDomain: "fxnewsbias.firebaseapp.com",
  projectId: "fxnewsbias",
  storageBucket: "fxnewsbias.firebasestorage.app",
  messagingSenderId: "414710041736",
  appId: "1:414710041736:web:00e79ccc58fdb94e98633d"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const SB_URL = 'https://vtbmtxtgtdprpbilragm.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ym10eHRndGRwcnBiaWxyYWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NDA0NzMsImV4cCI6MjA5MzExNjQ3M30.brlTWgFgTw0536PO_fXWgrGzSkqAMhOojlUA-UwlMnA';

async function checkSentimentAlerts(navActions) {
  if (!navActions) return;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/sentiment?order=id.desc&limit=8`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    const data = await res.json();
    if (!data || data.length === 0) return;

    const current = {};
    data.forEach(d => { current[d.currency] = d.bias; });

    const lastRaw = localStorage.getItem('fxnb_last_sentiment');
    localStorage.setItem('fxnb_last_sentiment', JSON.stringify(current));
    if (!lastRaw) return;

    const last = JSON.parse(lastRaw);
    const changes = [];
    Object.keys(current).forEach(cur => {
      if (last[cur] && last[cur] !== current[cur]) {
        changes.push({ currency: cur, from: last[cur], to: current[cur] });
      }
    });
    if (changes.length === 0) return;

    const seenKey = changes.map(c => c.currency + c.from + c.to).sort().join('|');
    if (localStorage.getItem('fxnb_alerts_seen') === seenKey) return;

    renderBell(navActions, changes, seenKey);
  } catch(e) {}
}

function biasPill(bias) {
  const bg = bias === 'Bullish' ? '#dcfce7' : bias === 'Bearish' ? '#fee2e2' : '#fef3c7';
  const color = bias === 'Bullish' ? '#166534' : bias === 'Bearish' ? '#991b1b' : '#92400e';
  return `<span style="font-size:11px;padding:2px 8px;border-radius:5px;background:${bg};color:${color};font-weight:700;">${bias}</span>`;
}

function renderBell(navActions, changes, seenKey) {
  const existing = document.getElementById('nav-bell');
  if (existing) existing.remove();

  const bell = document.createElement('div');
  bell.id = 'nav-bell';
  bell.style.cssText = 'position:relative;display:inline-flex;align-items:center;';

  bell.innerHTML = `
    <button id="bell-btn" aria-label="Sentiment alerts" style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px 6px;line-height:1;position:relative;">
      🔔
      <span id="bell-badge" style="position:absolute;top:-1px;right:-2px;background:#ef4444;color:#fff;font-size:9px;font-weight:700;border-radius:999px;min-width:16px;height:16px;line-height:16px;text-align:center;padding:0 3px;pointer-events:none;">${changes.length}</span>
    </button>
    <div id="bell-dropdown" style="display:none;position:absolute;top:calc(100% + 10px);right:0;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.13);width:270px;z-index:9999;overflow:hidden;">
      <div style="padding:10px 14px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:.06em;border-bottom:1px solid #f1f5f9;">SENTIMENT CHANGES</div>
      ${changes.map(c => `
        <div style="padding:10px 14px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #f8fafc;">
          <span style="font-weight:700;font-size:13px;min-width:38px;color:#0f172a;">${c.currency}</span>
          ${biasPill(c.from)}
          <span style="color:#cbd5e1;font-size:13px;">→</span>
          ${biasPill(c.to)}
        </div>
      `).join('')}
      <div style="padding:9px 14px;font-size:11px;color:#94a3b8;text-align:center;">Since your last visit</div>
    </div>
  `;

  bell.querySelector('#bell-btn').addEventListener('click', e => {
    e.stopPropagation();
    const dd = document.getElementById('bell-dropdown');
    const opening = dd.style.display === 'none';
    dd.style.display = opening ? 'block' : 'none';
    if (opening) {
      localStorage.setItem('fxnb_alerts_seen', seenKey);
      const badge = document.getElementById('bell-badge');
      if (badge) badge.style.display = 'none';
    }
  });

  document.addEventListener('click', e => {
    if (!bell.contains(e.target)) {
      const dd = document.getElementById('bell-dropdown');
      if (dd) dd.style.display = 'none';
    }
  });

  const userMenu = document.getElementById('user-menu');
  if (userMenu) navActions.insertBefore(bell, userMenu);
  else navActions.appendChild(bell);
}

async function checkProStatus(email) {
  try {
    if (!email) return false;
    const docId = email.replace(/[.#$[\]@]/g, '_');
    const docRef = doc(db, 'subscriptions', docId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().isPro === true) return true;
    return false;
  } catch(e) {
    console.log('Pro check error:', e);
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  const loginBtn = document.querySelector('a[href="/login"]');
  const registerBtn = document.querySelector('a[href="/register"]');
  const navActions = document.querySelector('.nav-actions');
  const proGate = document.getElementById('pro-gate');
  const proContent = document.getElementById('pro-content');

  if (user) {
    localStorage.setItem('fxnb_logged_in', 'true');
    if (loginBtn) loginBtn.style.display = 'none';
    if (registerBtn) registerBtn.style.display = 'none';
    // Add Profile link to topbar
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight && !document.getElementById('topbar-profile-link')) {
      const profileLink = document.createElement('a');
      profileLink.id = 'topbar-profile-link';
      profileLink.href = '/profile';
      profileLink.textContent = '👤 Profile';
      profileLink.style.cssText = 'color:#94a3b8;text-decoration:none;';
      topbarRight.insertBefore(profileLink, topbarRight.firstChild);
    }

    const isPro = await checkProStatus(user.email);

    const existingMenu = document.getElementById('user-menu');
    if (existingMenu) existingMenu.remove();

    if (navActions) {
      const userMenu = document.createElement('div');
      userMenu.id = 'user-menu';
      userMenu.style.cssText = 'display:flex;align-items:center;gap:10px;';
      userMenu.innerHTML = `
        <span style="font-size:13px;font-weight:600;color:#1a1a1a;">
          👤 ${user.displayName || user.email.split('@')[0]}
        </span>
        ${isPro ? '<span style="background:#f59e0b;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">⭐ PRO</span>' : ''}
        <button onclick="logoutUser()" style="padding:8px 16px;border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;border:1px solid #d1d5db;background:transparent;color:#1a1a1a;">Logout</button>
      `;
      navActions.appendChild(userMenu);
    }

    window.userIsPro = isPro;
    window.userEmail = user.email;

    checkSentimentAlerts(navActions);

    if (proGate && proContent) {
      if (isPro) {
        proGate.style.display = 'none';
        proContent.style.display = 'block';
        setTimeout(() => {
          if (typeof window.initProPage === 'function') {
            try {
              window.initProPage();
            } catch(e) {
              console.log('initProPage error:', e);
            }
          }
        }, 300);
      } else {
        proGate.style.display = 'block';
        proContent.style.display = 'none';
      }
    }

    if (isPro) {
  document.querySelectorAll('.ad-slot').forEach(ad => ad.style.display = 'none');
  const banner = document.getElementById('pro-banner');
  if (banner) banner.style.display = 'none';

  // Add Pro tabs to nav
  const navUl = document.querySelector('nav ul');
  if (navUl && !document.getElementById('pro-history-link')) {
    const historyLink = document.createElement('li');
    historyLink.id = 'pro-history-link';
    historyLink.innerHTML = '<a href="/history" style="color:#f59e0b;">📊 History</a>';
    navUl.appendChild(historyLink);

    const reportLink = document.createElement('li');
    reportLink.id = 'pro-report-link';
    reportLink.innerHTML = '<a href="/report" style="color:#f59e0b;font-weight:600;">📄 Report</a>';
    navUl.appendChild(reportLink);
  }
}

  } else {
    localStorage.removeItem('fxnb_logged_in');
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (registerBtn) registerBtn.style.display = 'inline-block';
    // Remove Profile link
    const profileLink = document.getElementById('topbar-profile-link');
    if (profileLink) profileLink.remove();
    const userMenu = document.getElementById('user-menu');
    if (userMenu) userMenu.remove();
    const bell = document.getElementById('nav-bell');
    if (bell) bell.remove();
    window.userIsPro = false;
    window.userEmail = null;

    if (proGate && proContent) {
      proGate.style.display = 'block';
      proContent.style.display = 'none';
    }
  }
});

window.loginUser = async function(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    showMessage('Login successful! Welcome back!', 'success');
    if (window.trackLoginSuccess) window.trackLoginSuccess('email');
    setTimeout(() => window.location.href = '/', 1000);
    return result;
  } catch (error) {
    let msg = 'Login failed. Please try again.';
    if (error.code === 'auth/user-not-found') msg = 'No account found with this email.';
    if (error.code === 'auth/wrong-password') msg = 'Incorrect password. Please try again.';
    if (error.code === 'auth/invalid-email') msg = 'Invalid email address.';
    if (error.code === 'auth/too-many-requests') msg = 'Too many attempts. Please try again later.';
    if (error.code === 'auth/invalid-credential') msg = 'Invalid email or password.';
    showMessage(msg, 'error');
    if (window.trackLoginFailed) window.trackLoginFailed(error.code);
    throw error;
  }
};

window.registerUser = async function(email, password, username) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName: username });
    const docId = email.replace(/[.#$[\]@]/g, '_');
    await setDoc(doc(db, 'users', docId), {
      username: username,
      email: email,
      photoURL: null,
      createdAt: new Date().toISOString(),
      isPro: false
    });
    showMessage('Account created! Welcome to FXNewsBias!', 'success');
    if (window.trackRegisterSuccess) window.trackRegisterSuccess();
    setTimeout(() => window.location.href = '/', 1500);
    return result;
  } catch (error) {
    let msg = 'Registration failed. Please try again.';
    if (error.code === 'auth/email-already-in-use') msg = 'Email already registered. Please login instead.';
    if (error.code === 'auth/weak-password') msg = 'Password too weak. Use at least 6 characters.';
    if (error.code === 'auth/invalid-email') msg = 'Invalid email address.';
    showMessage(msg, 'error');
    throw error;
  }
};

window.loginWithGoogle = async function() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    // Create or update Firestore profile for Google users
    const docId = user.email.replace(/[.#$[\]@]/g, '_');
    const docRef = doc(db, 'users', docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      // First time — create full profile
      await setDoc(docRef, {
        username: user.displayName || user.email.split('@')[0],
        email: user.email,
        photoURL: user.photoURL || null,
        createdAt: new Date().toISOString(),
        isPro: false
      });
    } else {
      // Returning Google user — just sync latest photoURL in case it changed
      await setDoc(docRef, { photoURL: user.photoURL || null }, { merge: true });
    }

    showMessage('Logged in with Google! Welcome!', 'success');
    if (window.trackLoginSuccess) window.trackLoginSuccess('google');
    setTimeout(() => window.location.href = '/', 1000);
    return result;
  } catch (error) {
    showMessage('Google login failed. Please try again.', 'error');
    throw error;
  }
};

window.logoutUser = async function() {
  try {
    await signOut(auth);
    showMessage('Logged out successfully!', 'success');
    setTimeout(() => window.location.href = '/', 500);
  } catch (error) {
    showMessage('Logout failed. Please try again.', 'error');
  }
};

window.getCurrentUser = function() { return auth.currentUser; };

window.resetPassword = async function(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    showMessage('Reset email sent! Check your inbox.', 'success');
  } catch(e) {
    showMessage('Error: ' + e.message, 'error');
  }
};

window.checkProStatus = async function(email) {
  const targetEmail = email || (auth.currentUser ? auth.currentUser.email : null);
  return await checkProStatus(targetEmail);
};

function showMessage(msg, type) {
  const existing = document.getElementById('auth-message');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'auth-message';
  el.style.cssText = `position:fixed;top:20px;right:20px;padding:14px 20px;border-radius:8px;font-size:14px;font-weight:600;z-index:9999;font-family:'Inter',sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.15);${type === 'success' ? 'background:#d1fae5;color:#065f46;border:1px solid #10b981;' : 'background:#fee2e2;color:#991b1b;border:1px solid #ef4444;'}`;
  el.textContent = type === 'success' ? '✅ ' + msg : '❌ ' + msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
