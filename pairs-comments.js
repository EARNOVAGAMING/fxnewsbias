import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, limit, onSnapshot, doc, getDoc, setDoc, deleteDoc, updateDoc, increment, serverTimestamp, getDocs } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD88nfD-GSk2icxgPMqOHOuLjCM19Zzso4",
  authDomain: "fxnewsbias.firebaseapp.com",
  projectId: "fxnewsbias",
  storageBucket: "fxnewsbias.firebasestorage.app",
  messagingSenderId: "414710041736",
  appId: "1:414710041736:web:00e79ccc58fdb94e98633d"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let userProfile = null;
let selectedBias = 'Neutral';
let userLikes = new Set();
let lastComments = [];
let currentPairFilter = 'all';

const textarea = document.getElementById('comment-textarea');
const postBtn = document.getElementById('post-comment-btn');
const biasSelector = document.getElementById('bias-selector');
const userAvatar = document.getElementById('user-comment-avatar');
const commentList = document.getElementById('comment-list');
const commentsCount = document.getElementById('comments-count');

function timeAgoComment(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

function showToast(msg, type) {
  const existing = document.getElementById('comment-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'comment-toast';
  el.style.cssText = 'position:fixed;top:20px;right:20px;padding:14px 20px;border-radius:8px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-size:13px;' + (type === 'success' ? 'background:#d1fae5;color:#065f46;border:1px solid #10b981;' : 'background:#fee2e2;color:#991b1b;border:1px solid #ef4444;');
  el.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

document.querySelectorAll('.bias-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.bias-btn').forEach(b => {
      b.classList.remove('active-bull', 'active-bear', 'active-neut');
    });
    if (btn.dataset.bias === 'Bullish') btn.classList.add('active-bull');
    else if (btn.dataset.bias === 'Bearish') btn.classList.add('active-bear');
    else btn.classList.add('active-neut');
    selectedBias = btn.dataset.bias;
  });
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    try {
      const docId = user.email.replace(/[.#$[\]@]/g, '_');
      const userDoc = await getDoc(doc(db, 'users', docId));
      if (userDoc.exists()) userProfile = userDoc.data();
    } catch(e) {}

    const username = user.displayName || (userProfile && userProfile.username) || user.email.split('@')[0];
    if (textarea) {
      textarea.disabled = false;
      textarea.placeholder = 'Share your view (mention pair like EUR/USD)... Min 10 characters';
    }
    if (postBtn) {
      postBtn.disabled = false;
      postBtn.textContent = 'Post View';
      postBtn.style.opacity = '1';
      postBtn.style.cursor = 'pointer';
    }
    if (biasSelector) biasSelector.style.display = 'flex';

    if (userAvatar) {
      if (userProfile && userProfile.photoURL) {
        userAvatar.innerHTML = `<img src="${userProfile.photoURL}" alt="">`;
        userAvatar.style.padding = '0';
      } else {
        userAvatar.textContent = username[0].toUpperCase();
        userAvatar.style.background = 'linear-gradient(135deg,#2563eb,#60a5fa)';
        userAvatar.style.color = '#fff';
        userAvatar.style.border = 'none';
      }
    }

    try {
      const likesQuery = query(collection(db, 'likes'), where('userEmail', '==', user.email));
      const likesSnap = await getDocs(likesQuery);
      likesSnap.forEach(d => userLikes.add(d.data().itemId));
      if (lastComments.length) renderComments(filterByPair(lastComments));
    } catch(e) {}
  } else {
    if (textarea) {
      textarea.disabled = true;
      textarea.placeholder = '🔒 Login to share your view';
    }
    if (postBtn) {
      postBtn.disabled = true;
      postBtn.textContent = '🔒 Login to Post';
      postBtn.style.opacity = '0.6';
      postBtn.style.cursor = 'not-allowed';
    }
    if (biasSelector) biasSelector.style.display = 'none';
    if (userAvatar) userAvatar.textContent = '👤';
  }
});

if (postBtn) {
  postBtn.addEventListener('click', async () => {
    if (!currentUser) { window.location.href = '/login'; return; }
    const text = textarea.value.trim();
    if (!text) { showToast('Please write something!', 'error'); return; }
    if (text.length < 10) { showToast('Comment too short (min 10 chars)', 'error'); return; }
    if (text.length > 1000) { showToast('Comment too long (max 1000 chars)', 'error'); return; }

    postBtn.disabled = true;
    postBtn.textContent = 'Posting...';

    try {
      const username = currentUser.displayName || (userProfile && userProfile.username) || currentUser.email.split('@')[0];
      await addDoc(collection(db, 'comments'), {
        text: text,
        bias: selectedBias,
        authorEmail: currentUser.email,
        authorName: username,
        authorPhoto: (userProfile && userProfile.photoURL) || null,
        section: 'pairs',
        pair: currentPairFilter !== 'all' ? currentPairFilter : null,
        createdAt: serverTimestamp(),
        likes: 0
      });
      textarea.value = '';
      selectedBias = 'Neutral';
      document.querySelectorAll('.bias-btn').forEach(b => {
        b.classList.remove('active-bull', 'active-bear', 'active-neut');
      });
      showToast('Posted!', 'success');
    } catch(e) {
      showToast('Error posting: ' + e.message, 'error');
    } finally {
      postBtn.disabled = false;
      postBtn.textContent = 'Post View';
    }
  });
}

function filterByPair(comments) {
  if (currentPairFilter === 'all') return comments;
  return comments.filter(c => (c.pair || 'all') === currentPairFilter);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderComments(comments) {
  if (!commentList) return;
  if (!comments.length) {
    commentList.innerHTML = '<div class="empty-comments">No comments yet. Be the first to share your view!</div>';
    return;
  }
  const colors = [{bg:'#dbeafe',color:'#1e40af'},{bg:'#fef3c7',color:'#92400e'},{bg:'#d1fae5',color:'#065f46'},{bg:'#fee2e2',color:'#991b1b'},{bg:'#e0e7ff',color:'#4338ca'},{bg:'#fce7f3',color:'#9d174d'}];
  commentList.innerHTML = comments.map(c => {
    const date = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate() : new Date();
    const time = timeAgoComment(date);
    const initial = (c.authorName || 'U')[0].toUpperCase();
    const colorIdx = (c.authorName || 'U').charCodeAt(0) % colors.length;
    const col = colors[colorIdx];
    const biasClass = c.bias === 'Bullish' ? 'bias-bull' : c.bias === 'Bearish' ? 'bias-bear' : 'bias-neut';
    const biasShow = c.bias && c.bias !== 'Neutral' ? `<span class="comment-bias ${biasClass}">${c.bias}</span>` : '';
    const liked = userLikes.has(c.id);
    const isOwn = currentUser && currentUser.email === c.authorEmail;
    const avatarHtml = c.authorPhoto ?
      `<div class="comment-avatar" style="padding:0;"><img src="${escapeHtml(c.authorPhoto)}" alt=""></div>` :
      `<div class="comment-avatar" style="background:${col.bg};color:${col.color};border:none;">${initial}</div>`;
    return `
      <div class="comment" data-id="${c.id}">
        ${avatarHtml}
        <div class="comment-content">
          <div class="comment-meta">
            <span class="comment-user">${escapeHtml(c.authorName || 'Anonymous')}</span>
            ${biasShow}
            <span class="comment-time">${time}</span>
            ${isOwn ? `<span class="delete-btn" data-delete="${c.id}">🗑️ Delete</span>` : ''}
          </div>
          <div class="comment-text">${escapeHtml(c.text)}</div>
          <div class="comment-actions">
            <span class="comment-action like-btn ${liked ? 'liked' : ''}" data-id="${c.id}">👍 ${c.likes || 0}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!currentUser) { window.location.href = '/login'; return; }
      await toggleLike(btn.dataset.id);
    });
  });
  document.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      try {
        await deleteDoc(doc(db, 'comments', btn.dataset.delete));
        showToast('Comment deleted', 'success');
      } catch(e) { showToast('Error deleting', 'error'); }
    });
  });
}

async function toggleLike(commentId) {
  if (!currentUser) return;
  const userDocId = currentUser.email.replace(/[.#$[\]@]/g, '_');
  const likeId = `${userDocId}_${commentId}`;
  const likeRef = doc(db, 'likes', likeId);
  const commentRef = doc(db, 'comments', commentId);
  try {
    const likeDoc = await getDoc(likeRef);
    if (likeDoc.exists()) {
      await deleteDoc(likeRef);
      await updateDoc(commentRef, { likes: increment(-1) });
      userLikes.delete(commentId);
    } else {
      await setDoc(likeRef, { userEmail: currentUser.email, itemId: commentId, itemType: 'comment', createdAt: serverTimestamp() });
      await updateDoc(commentRef, { likes: increment(1) });
      userLikes.add(commentId);
    }
  } catch(e) {}
}

const commentsQuery = query(collection(db, 'comments'), where('section', '==', 'pairs'), limit(100));

onSnapshot(commentsQuery, (snapshot) => {
  const comments = [];
  snapshot.forEach(d => comments.push({ id: d.id, ...d.data() }));
  comments.sort((a, b) => {
    const aTime = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const bTime = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return bTime - aTime;
  });
  lastComments = comments;
  const filtered = filterByPair(comments);
  renderComments(filtered);
  if (commentsCount) commentsCount.textContent = filtered.length + ' comments';
  const pf = document.getElementById('pair-filter');
  if (pf && !pf.dataset.bound) {
    pf.dataset.bound = '1';
    pf.addEventListener('change', e => {
      currentPairFilter = e.target.value;
      const filtered = filterByPair(lastComments);
      renderComments(filtered);
      if (commentsCount) commentsCount.textContent = filtered.length + ' comments';
    });
  }
}, (err) => {
  if (commentList) commentList.innerHTML = '<div class="empty-comments">Error: ' + err.message + '</div>';
});
