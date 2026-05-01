import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

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

// ============================================
// CHECK PRO STATUS FROM FIRESTORE
// ============================================
async function checkProStatus(email) {
  try {
    if (!email) return false;
    const docId = email.replace(/[.#$[\]@]/g, '_');
    const docRef = doc(db, 'subscriptions', docId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().isPro === true) {
      return true;
    }
    return false;
  } catch(e) {
    console.log('Pro check error:', e);
    return false;
  }
}

// ============================================
// SINGLE AUTH STATE LISTENER
// ============================================
onAuthStateChanged(auth, async (user) => {
  const loginBtn = document.querySelector('a[href="/login.html"]');
  const registerBtn = document.querySelector('a[href="/register.html"]');
  const navActions = document.querySelector('.nav-actions');

  if (user) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (registerBtn) registerBtn.style.display = 'none';

    const isPro = await checkProStatus(user.email);

    // Update nav
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

    // Handle Pro pages
    const proGate = document.getElementById('pro-gate');
    const proContent = document.getElementById('pro-content');

    if (proGate && proContent) {
      if (isPro) {
        proGate.style.display = 'none';
        proContent.style.display = 'block';
        // Call page functions after short delay to ensure DOM is ready
        setTimeout(() => {
          if (typeof window.initProPage === 'function') {
            window.initProPage();
          }
        }, 100);
      } else {
        proGate.style.display = 'block';
        proContent.style.display = 'none';
      }
    }

    // Hide ads for Pro users
    if (isPro) {
      document.querySelectorAll('.ad-slot').forEach(ad => ad.style.display = 'none');
      const banner = document.getElementById('pro-banner');
      if (banner) banner.style.display = 'none';
    }

  } else {
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (registerBtn) registerBtn.style.display = 'inline-block';
    const userMenu = document.getElementById('user-menu');
    if (userMenu) userMenu.remove();
    window.userIsPro = false;
    window.userEmail = null;

    // Show pro gate if on pro page
    const proGate = document.getElementById('pro-gate');
    const proContent = document.getElementById('pro-content');
    if (isPro) {
        proGate.style.display = 'none';
        proContent.style.display = 'block';
        setTimeout(() => {
          if (typeof window.initProPage === 'function') {
            try {
              window.initProPage();
              alert('initProPage ran successfully!');
            } catch(e) {
              alert('initProPage error: ' + e.message);
            }
          } else {
            alert('initProPage not defined!');
          }
        }, 500);
    }
});

// ============================================
// LOGIN
// ============================================
window.loginUser = async function(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    showMessage('Login successful! Welcome back!', 'success');
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
    throw error;
  }
};

// ============================================
// REGISTER
// ============================================
window.registerUser = async function(email, password, username) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName: username });
    showMessage('Account created! Welcome to FXNewsBias!', 'success');
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

// ============================================
// GOOGLE LOGIN
// ============================================
window.loginWithGoogle = async function() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    showMessage('Logged in with Google! Welcome!', 'success');
    setTimeout(() => window.location.href = '/', 1000);
    return result;
  } catch (error) {
    showMessage('Google login failed. Please try again.', 'error');
    throw error;
  }
};

// ============================================
// LOGOUT
// ============================================
window.logoutUser = async function() {
  try {
    await signOut(auth);
    showMessage('Logged out successfully!', 'success');
    setTimeout(() => window.location.href = '/', 500);
  } catch (error) {
    showMessage('Logout failed. Please try again.', 'error');
  }
};

// ============================================
// GET CURRENT USER
// ============================================
window.getCurrentUser = function() {
  return auth.currentUser;
};

// ============================================
// CHECK PRO STATUS (public)
// ============================================
window.checkProStatus = async function(email) {
  const targetEmail = email || (auth.currentUser ? auth.currentUser.email : null);
  return await checkProStatus(targetEmail);
};

// ============================================
// SHOW MESSAGE
// ============================================
function showMessage(msg, type) {
  const existing = document.getElementById('auth-message');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'auth-message';
  el.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 14px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    z-index: 9999;
    font-family: 'Inter', sans-serif;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    ${type === 'success'
      ? 'background:#d1fae5;color:#065f46;border:1px solid #10b981;'
      : 'background:#fee2e2;color:#991b1b;border:1px solid #ef4444;'}
  `;
  el.textContent = type === 'success' ? '✅ ' + msg : '❌ ' + msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
