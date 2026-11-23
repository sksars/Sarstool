// Optional Firebase Authentication & Analytics integration
// Never exposes hardcoded keys. Activates only when a user or site owner
// provides their Firebase Web Config via localStorage or window.FLYAI_FIREBASE_CONFIG.

import { STORAGE_KEYS, escapeHtml, showToast } from './utils.js';

let firebaseState = {
  initialized: false,
  user: null,
  auth: null,
  analytics: null,
  app: null,
};

export function getSavedFirebaseConfig() {
  if (window.FLYAI_FIREBASE_CONFIG && window.FLYAI_FIREBASE_CONFIG.apiKey) {
    return window.FLYAI_FIREBASE_CONFIG;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FIREBASE_CFG);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function initOptionalFirebase() {
  const cfg = getSavedFirebaseConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId) return firebaseState;
  if (firebaseState.initialized) return firebaseState;

  try {
    const appMod = await import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
    const authMod = await import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');

    const app = appMod.getApps().length ? appMod.getApps()[0] : appMod.initializeApp(cfg);
    const auth = authMod.getAuth(app);
    firebaseState.app = app;
    firebaseState.auth = auth;
    firebaseState.initialized = true;

    authMod.onAuthStateChanged(auth, (user) => {
      firebaseState.user = user;
      window.dispatchEvent(new CustomEvent('flyai:auth-changed', { detail: user }));
    });

    if (cfg.measurementId) {
      try {
        const analyticsMod = await import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js');
        firebaseState.analytics = analyticsMod.getAnalytics(app);
      } catch {
        // Analytics optional
      }
    }
  } catch (err) {
    console.warn('Optional Firebase initialization skipped:', err.message);
  }
  return firebaseState;
}

export function logOptionalEvent(eventName, params = {}) {
  if (!firebaseState.analytics) return;
  import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js')
    .then((m) => m.logEvent(firebaseState.analytics, eventName, params))
    .catch(() => {});
}

export function renderFirebaseSettingsModal(container, onClose) {
  const saved = getSavedFirebaseConfig();
  container.innerHTML = `
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="fb-modal-title">
      <div class="modal-card">
        <div class="modal-header">
          <h2 id="fb-modal-title">Optional Cloud Account &amp; Firebase</h2>
          <button type="button" class="icon-btn modal-close-btn" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <p class="muted-text">
            All FlyAI Tools work immediately without signing in. If you deploy your own copy on Firebase Hosting, you can optionally connect your Firebase Web Config below for Google Sign-In and Analytics.
          </p>
          <div id="fb-auth-status" class="info-box"></div>
          <div class="field-group">
            <label for="fb-config-json">Firebase Web Config (JSON)</label>
            <textarea id="fb-config-json" rows="6" class="input-mono" placeholder='{"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}'>${saved ? escapeHtml(JSON.stringify(saved, null, 2)) : ''}</textarea>
          </div>
          <div class="btn-row">
            <button type="button" id="fb-save-btn" class="btn btn-primary">Connect Config</button>
            <button type="button" id="fb-clear-btn" class="btn btn-secondary">Disconnect</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const close = () => onClose && onClose();
  container.querySelector('.modal-close-btn').addEventListener('click', close);
  container.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) close();
  });

  const statusBox = container.querySelector('#fb-auth-status');
  const updateStatus = async () => {
    if (!firebaseState.initialized) {
      statusBox.innerHTML = '<span>No Firebase project connected. Running in 100% local privacy mode.</span>';
      return;
    }
    if (firebaseState.user) {
      statusBox.innerHTML = `
        <div class="flex-between">
          <span>Signed in as <strong>${escapeHtml(firebaseState.user.email || firebaseState.user.displayName || 'User')}</strong></span>
          <button type="button" id="fb-signout-btn" class="btn btn-secondary btn-sm">Sign Out</button>
        </div>
      `;
      statusBox.querySelector('#fb-signout-btn').addEventListener('click', async () => {
        const authMod = await import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
        await authMod.signOut(firebaseState.auth);
        showToast('Signed out', 'info');
        updateStatus();
      });
    } else {
      statusBox.innerHTML = `
        <div class="flex-between">
          <span>Firebase connected. Sign in optionally with Google:</span>
          <button type="button" id="fb-signin-btn" class="btn btn-primary btn-sm">Sign In with Google</button>
        </div>
      `;
      statusBox.querySelector('#fb-signin-btn').addEventListener('click', async () => {
        try {
          const authMod = await import(/* @vite-ignore */ 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');
          const provider = new authMod.GoogleAuthProvider();
          await authMod.signInWithPopup(firebaseState.auth, provider);
          showToast('Signed in successfully', 'success');
          updateStatus();
        } catch (err) {
          showToast('Sign-in failed: ' + err.message, 'error');
        }
      });
    }
  };
  updateStatus();

  container.querySelector('#fb-save-btn').addEventListener('click', async () => {
    const raw = container.querySelector('#fb-config-json').value.trim();
    if (!raw) {
      showToast('Paste a valid Firebase JSON config object first.', 'error');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.apiKey || !parsed.projectId) {
        throw new Error('Config must contain apiKey and projectId.');
      }
      localStorage.setItem(STORAGE_KEYS.FIREBASE_CFG, JSON.stringify(parsed));
      firebaseState.initialized = false;
      await initOptionalFirebase();
      showToast('Firebase config connected!', 'success');
      updateStatus();
    } catch (err) {
      showToast('Invalid JSON: ' + err.message, 'error');
    }
  });

  container.querySelector('#fb-clear-btn').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEYS.FIREBASE_CFG);
    firebaseState = { initialized: false, user: null, auth: null, analytics: null, app: null };
    container.querySelector('#fb-config-json').value = '';
    showToast('Firebase config removed.', 'info');
    updateStatus();
  });
}
