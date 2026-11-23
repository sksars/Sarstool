import { CATEGORIES, TOOLS, getIconSvg } from './tools/registry.js';
import { STORAGE_KEYS, escapeHtml, showToast } from './tools/utils.js';
import { renderPhotoTool } from './tools/photo-tools.js';
import { renderQrTool } from './tools/qr-tools.js';
import { renderBarcodeTool } from './tools/barcode-tools.js';
import { renderFileTool } from './tools/file-tools.js';
import { renderLinkTool } from './tools/link-tools.js';
import { renderMediaTool } from './tools/media-tools.js';
import { renderYoutubeTool } from './tools/youtube-tools.js';
import { renderInfoPage } from './tools/pages.js';
import { initOptionalFirebase, logOptionalEvent, renderFirebaseSettingsModal } from './tools/firebase-optional.js';

function loadJsonArray(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const appState = {
  activeCategory: 'all',
  searchQuery: '',
  favorites: loadJsonArray(STORAGE_KEYS.FAVORITES),
  recents: loadJsonArray(STORAGE_KEYS.RECENTS),
  activeToolId: null,
  activePageId: null,
};

// DOM References
const catalogView = document.getElementById('catalog-view');
const toolView = document.getElementById('tool-view');
const pageView = document.getElementById('page-view');
const categoryTabsEl = document.getElementById('category-tabs');
const toolsGridEl = document.getElementById('tools-grid');
const recentsSectionEl = document.getElementById('recents-section');
const recentsGridEl = document.getElementById('recents-grid');
const searchInputEl = document.getElementById('global-search-input');
const catalogHeadingEl = document.getElementById('catalog-heading');
const catalogCountEl = document.getElementById('catalog-count');
const favCountInlineEl = document.getElementById('fav-count-inline');
const toolMountEl = document.getElementById('tool-mount');
const pageMountEl = document.getElementById('page-mount');
const modalRootEl = document.getElementById('modal-root');

// 1. Theme Initialization & Toggle
function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.getElementById('theme-icon-sun').classList.toggle('hidden', !isDark);
  document.getElementById('theme-icon-moon').classList.toggle('hidden', isDark);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', isDark ? '#0B1120' : '#0F52BA');
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
}

const savedTheme =
  localStorage.getItem(STORAGE_KEYS.THEME) ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(savedTheme);

document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
  applyTheme(next);
});

// 2. PWA Service Worker, Install Prompt, and Online/Offline Indicator
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

let deferredPrompt = null;
const installBtn = document.getElementById('pwa-install-btn');
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());

if (!isStandalone && isIOS) {
  installBtn.classList.remove('hidden');
  installBtn.textContent = 'Install App';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isStandalone) {
    installBtn.classList.remove('hidden');
  }
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installBtn.classList.add('hidden');
  showToast('FlyAI Tools installed to your device!', 'success');
});

installBtn.addEventListener('click', async () => {
  if (deferredPrompt) {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    }
    return;
  }
  if (isIOS) {
    modalRootEl.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <div class="modal-card">
          <div class="modal-header">
            <h2>Install on iPhone / iPad</h2>
            <button type="button" class="icon-btn" id="ios-close">✕</button>
          </div>
          <div class="modal-body">
            <p>1. Tap the <strong>Share</strong> button in Safari's toolbar.</p>
            <p>2. Scroll down and tap <strong>Add to Home Screen</strong>.</p>
            <button type="button" id="ios-ok" class="btn btn-primary">Got It</button>
          </div>
        </div>
      </div>
    `;
    const close = () => (modalRootEl.innerHTML = '');
    modalRootEl.querySelector('#ios-close').addEventListener('click', close);
    modalRootEl.querySelector('#ios-ok').addEventListener('click', close);
  }
});

const offlineBanner = document.getElementById('offline-banner');
function updateOnlineState() {
  offlineBanner.classList.toggle('hidden', navigator.onLine);
}
window.addEventListener('online', updateOnlineState);
window.addEventListener('offline', updateOnlineState);
updateOnlineState();

// 3. Favorites & Recents
function toggleFavorite(toolId) {
  const idx = appState.favorites.indexOf(toolId);
  if (idx >= 0) {
    appState.favorites.splice(idx, 1);
    showToast('Removed from favorites', 'info');
  } else {
    appState.favorites.unshift(toolId);
    showToast('Pinned to favorites', 'success');
  }
  localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(appState.favorites));
  favCountInlineEl.textContent = appState.favorites.length;
  renderCatalog();
  updateActiveToolFavButton();
}

function recordRecent(toolId) {
  appState.recents = [toolId, ...appState.recents.filter((id) => id !== toolId)].slice(0, 8);
  localStorage.setItem(STORAGE_KEYS.RECENTS, JSON.stringify(appState.recents));
  renderRecents();
}

function renderRecents() {
  const valid = appState.recents.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean);
  recentsSectionEl.classList.toggle('hidden', valid.length === 0);
  recentsGridEl.innerHTML = valid
    .map(
      (t) => `
      <button type="button" class="recent-chip" data-open-tool="${escapeHtml(t.id)}">
        ${getIconSvg(t.icon, 16)}
        <span>${escapeHtml(t.name)}</span>
      </button>
    `
    )
    .join('');
}

// 4. Category Tabs & Tool Catalog Rendering
function renderCategoryTabs() {
  categoryTabsEl.innerHTML = CATEGORIES.map(
    (c) => `
    <button type="button" role="tab" class="cat-tab ${appState.activeCategory === c.id ? 'active' : ''}" data-cat="${escapeHtml(c.id)}">
      ${escapeHtml(c.name)}
    </button>
  `
  ).join('');

  document.querySelectorAll('.nav-link[data-nav-cat]').forEach((a) => {
    a.classList.toggle('active', a.dataset.navCat === appState.activeCategory && !appState.activeToolId && !appState.activePageId);
  });
}

function renderCatalog() {
  favCountInlineEl.textContent = appState.favorites.length;
  const q = appState.searchQuery.trim().toLowerCase();
  const cat = appState.activeCategory;

  const filtered = TOOLS.filter((t) => {
    const catOk = cat === 'all' || t.category === cat;
    if (!catOk) return false;
    if (!q) return true;
    const hay = `${t.name} ${t.desc} ${t.category} ${t.keywords.join(' ')}`.toLowerCase();
    return hay.includes(q);
  });

  const catObj = CATEGORIES.find((c) => c.id === cat);
  catalogHeadingEl.textContent = q ? `Search Results for "${appState.searchQuery.trim()}"` : catObj?.name || 'All Tools';
  catalogCountEl.textContent = `${filtered.length} tool${filtered.length === 1 ? '' : 's'}`;

  if (!filtered.length) {
    toolsGridEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1">No tools matched "${escapeHtml(appState.searchQuery)}". Try searching "QR", "PDF", "Background", "MP3", or "YouTube".</div>`;
    return;
  }

  toolsGridEl.innerHTML = filtered
    .map((t) => {
      const isFav = appState.favorites.includes(t.id);
      const catName = CATEGORIES.find((c) => c.id === t.category)?.short || t.category;
      return `
        <article class="tool-card" data-open-tool="${escapeHtml(t.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(t.name)}">
          <div class="tool-card-top">
            <div class="tool-icon-box">${getIconSvg(t.icon, 20)}</div>
            <button type="button" class="fav-btn ${isFav ? 'active' : ''}" data-fav-toggle="${escapeHtml(t.id)}" aria-label="${isFav ? 'Remove from favorites' : 'Pin to favorites'}">
              ${isFav ? '★' : '☆'}
            </button>
          </div>
          <h3>${escapeHtml(t.name)}</h3>
          <p>${escapeHtml(t.desc)}</p>
          <div class="tool-card-meta">${escapeHtml(catName)} · Browser-side</div>
        </article>
      `;
    })
    .join('');
}

// 5. Tool & Page Routing
function showCatalogView() {
  appState.activeToolId = null;
  appState.activePageId = null;
  catalogView.classList.remove('hidden');
  toolView.classList.add('hidden');
  pageView.classList.add('hidden');
  renderCategoryTabs();
  renderRecents();
  renderCatalog();
  updateMobileNavHighlight();
}

function updateActiveToolFavButton() {
  const btn = document.getElementById('active-tool-fav-btn');
  if (!btn || !appState.activeToolId) return;
  const isFav = appState.favorites.includes(appState.activeToolId);
  btn.textContent = isFav ? '★ Saved' : '☆ Save Tool';
}

function openTool(toolId, pushHash = true) {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) return showCatalogView();

  appState.activeToolId = tool.id;
  appState.activePageId = null;
  recordRecent(tool.id);

  if (pushHash) {
    window.location.hash = `#tool/${tool.id}`;
  }

  catalogView.classList.add('hidden');
  pageView.classList.add('hidden');
  toolView.classList.remove('hidden');

  const catObj = CATEGORIES.find((c) => c.id === tool.category);
  document.getElementById('active-tool-cat').textContent = catObj?.name || tool.category;
  document.getElementById('active-tool-icon').innerHTML = getIconSvg(tool.icon, 24);
  document.getElementById('active-tool-title').textContent = tool.name;
  document.getElementById('active-tool-desc').textContent = tool.desc;
  updateActiveToolFavButton();

  toolMountEl.innerHTML = '';

  if (tool.module === 'photo') renderPhotoTool(toolMountEl, tool);
  else if (tool.module === 'qr') renderQrTool(toolMountEl, tool);
  else if (tool.module === 'barcode') renderBarcodeTool(toolMountEl, tool);
  else if (tool.module === 'file') renderFileTool(toolMountEl, tool);
  else if (tool.module === 'link') renderLinkTool(toolMountEl, tool);
  else if (tool.module === 'media') renderMediaTool(toolMountEl, tool);
  else if (tool.module === 'youtube') renderYoutubeTool(toolMountEl, tool);

  logOptionalEvent('select_content', { content_type: 'tool', item_id: tool.id });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateMobileNavHighlight();
}

function openPage(pageId, pushHash = true) {
  appState.activeToolId = null;
  appState.activePageId = pageId;
  if (pushHash) {
    window.location.hash = `#page/${pageId}`;
  }
  catalogView.classList.add('hidden');
  toolView.classList.add('hidden');
  pageView.classList.remove('hidden');
  renderInfoPage(pageMountEl, pageId, appState);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateMobileNavHighlight();
}

function updateMobileNavHighlight() {
  document.querySelectorAll('.mb-nav-item').forEach((el) => {
    const key = el.dataset.mb;
    const active =
      (key === 'tools' && !appState.activePageId) ||
      (key === 'favorites' && appState.activePageId === 'favorites') ||
      (key === 'history' && appState.activePageId === 'history') ||
      (key === 'about' && ['about', 'contact', 'privacy', 'terms', 'disclaimer'].includes(appState.activePageId));
    el.classList.toggle('active', active);
  });
}

function handleHashChange() {
  const hash = window.location.hash || '#home';
  if (hash.startsWith('#tool/')) {
    openTool(hash.slice(6), false);
  } else if (hash.startsWith('#category/')) {
    const cat = hash.slice(10);
    appState.activeCategory = CATEGORIES.some((c) => c.id === cat) ? cat : 'all';
    showCatalogView();
  } else if (hash.startsWith('#page/')) {
    openPage(hash.slice(6), false);
  } else {
    showCatalogView();
  }
}

// 6. Global Event Delegation & Keyboard Shortcuts
document.addEventListener('click', (e) => {
  const favBtn = e.target.closest('[data-fav-toggle]');
  if (favBtn) {
    e.stopPropagation();
    toggleFavorite(favBtn.dataset.favToggle);
    if (appState.activePageId === 'favorites') {
      renderInfoPage(pageMountEl, 'favorites', appState);
    }
    return;
  }

  const toolCard = e.target.closest('[data-open-tool]');
  if (toolCard) {
    openTool(toolCard.dataset.openTool);
    return;
  }

  const catBtn = e.target.closest('[data-cat]');
  if (catBtn) {
    appState.activeCategory = catBtn.dataset.cat;
    window.location.hash = `#category/${appState.activeCategory}`;
    renderCategoryTabs();
    renderCatalog();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === '/' || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    if (appState.activeToolId || appState.activePageId) {
      window.location.hash = '#home';
    }
    searchInputEl.focus();
  }
  const focusedCard = document.activeElement?.closest?.('[data-open-tool]');
  if (focusedCard && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openTool(focusedCard.dataset.openTool);
  }
});

searchInputEl.addEventListener('input', () => {
  appState.searchQuery = searchInputEl.value;
  renderCatalog();
});

document.getElementById('clear-recents-btn').addEventListener('click', () => {
  appState.recents = [];
  localStorage.removeItem(STORAGE_KEYS.RECENTS);
  renderRecents();
});

document.getElementById('back-to-catalog').addEventListener('click', () => {
  window.location.hash = `#category/${appState.activeCategory}`;
});

document.getElementById('page-back-btn').addEventListener('click', () => {
  window.location.hash = '#home';
});

document.getElementById('active-tool-fav-btn').addEventListener('click', () => {
  if (appState.activeToolId) toggleFavorite(appState.activeToolId);
});

document.getElementById('open-firebase-modal-btn').addEventListener('click', () => {
  renderFirebaseSettingsModal(modalRootEl, () => {
    modalRootEl.innerHTML = '';
  });
});

document.getElementById('footer-year').textContent = new Date().getFullYear();

window.addEventListener('hashchange', handleHashChange);

// Boot
initOptionalFirebase();
handleHashChange();
