import { STORAGE_KEYS, escapeHtml, showToast } from './utils.js';

const SUGGESTED_QUERIES = [
  'web development tutorial',
  'creative commons nature 4k',
  'lofi coding beats',
  'photography lighting setup',
  'javascript canvas animation',
  'acoustic guitar instrumental',
];

function parseIsoDuration(iso) {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  if (h > 0) return `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${min}:${String(s).padStart(2, '0')}`;
}

function extractYouTubeId(input) {
  const str = (input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  try {
    const u = new URL(str);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace('/', '').slice(0, 11);
    }
    if (u.searchParams.get('v')) {
      return u.searchParams.get('v').slice(0, 11);
    }
    const parts = u.pathname.split('/').filter(Boolean);
    const embedIdx = parts.indexOf('embed');
    if (embedIdx !== -1 && parts[embedIdx + 1]) return parts[embedIdx + 1].slice(0, 11);
    const shortsIdx = parts.indexOf('shorts');
    if (shortsIdx !== -1 && parts[shortsIdx + 1]) return parts[shortsIdx + 1].slice(0, 11);
  } catch {
    // ignore
  }
  return null;
}

function getYtFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.YT_FAVS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveYtFavorites(list) {
  localStorage.setItem(STORAGE_KEYS.YT_FAVS, JSON.stringify(list));
}

export function renderYoutubeTool(container, tool) {
  let activeMode = tool.mode || 'videos'; // videos | channels | playlists | inspector
  let apiKey = localStorage.getItem(STORAGE_KEYS.YT_API_KEY) || '';
  let activePlayer = null; // { kind: 'video'|'playlist', id, title, channelTitle, description }

  container.innerHTML = `
    <div class="tool-stack">
      <div class="segmented-tabs" role="tablist" aria-label="YouTube Tool Mode">
        <button type="button" class="seg-btn ${activeMode === 'videos' ? 'active' : ''}" data-ytmode="videos">Search Videos</button>
        <button type="button" class="seg-btn ${activeMode === 'channels' ? 'active' : ''}" data-ytmode="channels">Search Channels</button>
        <button type="button" class="seg-btn ${activeMode === 'playlists' ? 'active' : ''}" data-ytmode="playlists">Search Playlists</button>
        <button type="button" class="seg-btn ${activeMode === 'inspector' ? 'active' : ''}" data-ytmode="inspector">Link Inspector (No Key)</button>
      </div>

      <div class="panel-section" id="yt-api-bar">
        <div class="flex-between">
          <div>
            <strong>Official YouTube Data API v3</strong>
            <p class="field-hint">Enter your own free Google Cloud YouTube Data API v3 key (stored locally in your browser only — never uploaded or exposed in code).</p>
          </div>
          <button type="button" id="yt-toggle-key-panel" class="btn btn-secondary btn-sm">${apiKey ? 'API Key Configured' : 'Configure API Key'}</button>
        </div>
        <div id="yt-key-panel" class="hidden" style="margin-top:0.85rem">
          <div class="input-action-row">
            <input type="password" id="yt-key-input" value="${escapeHtml(apiKey)}" placeholder="AIzaSy... (Google Cloud YouTube Data API v3 Key)" autocomplete="off" />
            <button type="button" id="yt-save-key" class="btn btn-primary btn-sm">Save Locally</button>
            <button type="button" id="yt-clear-key" class="btn btn-secondary btn-sm">Clear</button>
          </div>
          <p class="field-hint">Get a free key in Google Cloud Console → Enable "YouTube Data API v3" → Create API Key. Official viewing &amp; embedded player comply strictly with YouTube Terms.</p>
        </div>
      </div>

      <div id="yt-search-panel" class="panel-section ${activeMode === 'inspector' ? 'hidden' : ''}">
        <form id="yt-search-form" class="input-action-row">
          <input type="search" id="yt-query" list="yt-suggestions" placeholder="Search YouTube keywords..." />
          <datalist id="yt-suggestions">
            ${SUGGESTED_QUERIES.map((q) => `<option value="${escapeHtml(q)}"></option>`).join('')}
          </datalist>
          <button type="submit" class="btn btn-primary">Search</button>
        </form>
        <div class="filter-inline-row">
          <div class="suggestion-row" id="yt-quick-chips">
            ${SUGGESTED_QUERIES.slice(0, 4)
              .map((q) => `<button type="button" class="btn btn-secondary btn-xs yt-suggest-btn" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
              .join('')}
          </div>
          <label class="checkbox-row" id="yt-cc-wrap">
            <input type="checkbox" id="yt-cc-only" />
            <span>Creative Commons only (Creator-permitted)</span>
          </label>
        </div>
      </div>

      <div id="yt-inspector-panel" class="panel-section ${activeMode === 'inspector' ? '' : 'hidden'}">
        <div class="field-group">
          <label for="yt-direct-url">YouTube Video URL or 11-char Video ID (Works without API Key via Official oEmbed)</label>
          <div class="input-action-row">
            <input type="text" id="yt-direct-url" placeholder="https://www.youtube.com/watch?v=aqz-KE-bpKQ" value="https://www.youtube.com/watch?v=aqz-KE-bpKQ" />
            <button type="button" id="yt-inspect-btn" class="btn btn-primary">Load Video</button>
          </div>
        </div>
      </div>

      <div id="yt-player-card" class="panel-section hidden">
        <div class="yt-embed-wrap">
          <iframe id="yt-iframe" title="Official YouTube Player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
        </div>
        <div id="yt-player-meta" style="margin-top:1rem"></div>
      </div>

      <div id="yt-results-grid" class="yt-results-grid"></div>

      <div class="panel-section">
        <div class="flex-between">
          <h3 class="section-subtitle">Saved Favorite Video Links (Local)</h3>
          <span id="yt-fav-count" class="tabular-nums muted-text">0 saved</span>
        </div>
        <div id="yt-favs-list" class="yt-favs-list"></div>
      </div>
    </div>
  `;

  const keyPanel = container.querySelector('#yt-key-panel');
  const toggleKeyBtn = container.querySelector('#yt-toggle-key-panel');
  const keyInput = container.querySelector('#yt-key-input');
  const searchPanel = container.querySelector('#yt-search-panel');
  const inspectorPanel = container.querySelector('#yt-inspector-panel');
  const ccWrap = container.querySelector('#yt-cc-wrap');
  const ccOnly = container.querySelector('#yt-cc-only');
  const queryInput = container.querySelector('#yt-query');
  const resultsGrid = container.querySelector('#yt-results-grid');
  const playerCard = container.querySelector('#yt-player-card');
  const iframe = container.querySelector('#yt-iframe');
  const playerMeta = container.querySelector('#yt-player-meta');
  const favListEl = container.querySelector('#yt-favs-list');
  const favCountEl = container.querySelector('#yt-fav-count');

  function renderFavorites() {
    const favs = getYtFavorites();
    favCountEl.textContent = `${favs.length} saved`;
    if (!favs.length) {
      favListEl.innerHTML = `<div class="empty-state">No saved favorite videos yet. Load or search a video and click "Save Favorite".</div>`;
      return;
    }
    favListEl.innerHTML = favs
      .map(
        (f) => `
        <div class="yt-fav-row">
          <img src="${escapeHtml(f.thumb)}" alt="${escapeHtml(f.title)}" class="yt-fav-thumb" referrerpolicy="no-referrer" />
          <div class="yt-fav-info">
            <div class="yt-fav-title">${escapeHtml(f.title)}</div>
            <div class="muted-text">${escapeHtml(f.channelTitle || 'YouTube')}</div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn btn-primary btn-sm yt-play-fav" data-id="${escapeHtml(f.id)}">Watch</button>
            <a href="https://www.youtube.com/watch?v=${encodeURIComponent(f.id)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Open</a>
            <button type="button" class="btn btn-secondary btn-sm yt-rm-fav" data-id="${escapeHtml(f.id)}">Remove</button>
          </div>
        </div>
      `
      )
      .join('');

    favListEl.querySelectorAll('.yt-play-fav').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = favs.find((x) => x.id === btn.dataset.id);
        if (item) openVideoPlayer(item);
      });
    });

    favListEl.querySelectorAll('.yt-rm-fav').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = getYtFavorites().filter((x) => x.id !== btn.dataset.id);
        saveYtFavorites(next);
        renderFavorites();
        showToast('Removed from YouTube favorites.', 'info');
      });
    });
  }

  function toggleFavorite(video) {
    const favs = getYtFavorites();
    const exists = favs.some((f) => f.id === video.id);
    const next = exists ? favs.filter((f) => f.id !== video.id) : [video, ...favs];
    saveYtFavorites(next);
    renderFavorites();
    showToast(exists ? 'Removed from favorites.' : 'Saved video to local favorites!', 'success');
  }

  function openVideoPlayer(item) {
    activePlayer = item;
    playerCard.classList.remove('hidden');
    if (item.kind === 'playlist') {
      iframe.src = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(item.id)}`;
    } else {
      iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(item.id)}`;
    }
    const ytUrl =
      item.kind === 'playlist'
        ? `https://www.youtube.com/playlist?list=${encodeURIComponent(item.id)}`
        : `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`;

    const isFav = item.kind !== 'playlist' && getYtFavorites().some((f) => f.id === item.id);

    playerMeta.innerHTML = `
      <div class="flex-between">
        <div>
          <h3 style="margin:0">${escapeHtml(item.title)}</h3>
          <p class="muted-text" style="margin:0.25rem 0 0">${escapeHtml(item.channelTitle || '')}${item.duration ? ' · ' + escapeHtml(item.duration) : ''}</p>
        </div>
        <div class="btn-row">
          ${
            item.kind !== 'playlist'
              ? `<button type="button" id="yt-player-fav-btn" class="btn btn-secondary btn-sm">${isFav ? 'Saved ★' : 'Save Favorite ☆'}</button>`
              : ''
          }
          <a href="${escapeHtml(ytUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">Open on YouTube</a>
        </div>
      </div>
      ${item.description ? `<p class="yt-desc">${escapeHtml(item.description)}</p>` : ''}
      ${
        item.kind !== 'playlist'
          ? `
            <div class="btn-row" style="margin-top:0.75rem">
              <a href="https://i.ytimg.com/vi/${encodeURIComponent(item.id)}/maxresdefault.jpg" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Official HD Thumbnail</a>
              <button type="button" id="yt-copy-embed" class="btn btn-secondary btn-sm">Copy Embed Code</button>
            </div>
          `
          : ''
      }
    `;

    playerMeta.querySelector('#yt-player-fav-btn')?.addEventListener('click', () => {
      toggleFavorite({
        id: item.id,
        title: item.title,
        channelTitle: item.channelTitle,
        thumb: `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`,
      });
      openVideoPlayer(item);
    });

    playerMeta.querySelector('#yt-copy-embed')?.addEventListener('click', async () => {
      const code = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${item.id}" title="${escapeHtml(item.title)}" frameborder="0" allowfullscreen></iframe>`;
      await navigator.clipboard?.writeText(code);
      showToast('Official embed code copied.', 'success');
    });

    playerCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function inspectDirectVideo() {
    const raw = container.querySelector('#yt-direct-url').value.trim();
    const vidId = extractYouTubeId(raw);
    if (!vidId) {
      showToast('Enter a valid YouTube watch URL, youtu.be link, or 11-character ID.', 'error');
      return;
    }
    const watchUrl = `https://www.youtube.com/watch?v=${vidId}`;
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`);
      if (!res.ok) throw new Error('Video info unavailable or private.');
      const data = await res.json();
      openVideoPlayer({
        kind: 'video',
        id: vidId,
        title: data.title || 'YouTube Video',
        channelTitle: data.author_name || 'YouTube Channel',
        description: 'Loaded via official YouTube oEmbed endpoint. Use YouTube Data API v3 search tabs for full keyword discovery and durations.',
      });
    } catch (err) {
      openVideoPlayer({
        kind: 'video',
        id: vidId,
        title: `YouTube Video (${vidId})`,
        channelTitle: 'YouTube',
        description: `oEmbed metadata unavailable (${err.message}); official embedded player loaded directly.`,
      });
    }
  }

  async function runApiSearch(query) {
    const q = (query || '').trim();
    if (!q) {
      showToast('Enter search keywords.', 'error');
      return;
    }
    if (!apiKey) {
      keyPanel.classList.remove('hidden');
      resultsGrid.innerHTML = `<div class="info-box">Paste your free Google Cloud YouTube Data API v3 key above to search videos, channels, and playlists—or switch to <strong>Link Inspector (No Key)</strong> to watch and inspect any YouTube URL immediately.</div>`;
      return;
    }

    resultsGrid.innerHTML = `<div class="info-box">Searching YouTube Data API v3...</div>`;
    const typeMap = { videos: 'video', channels: 'channel', playlists: 'playlist' };
    const searchType = typeMap[activeMode] || 'video';
    const params = new URLSearchParams({
      part: 'snippet',
      maxResults: '12',
      q,
      type: searchType,
      key: apiKey,
    });
    if (searchType === 'video' && ccOnly.checked) {
      params.set('videoLicense', 'creativeCommon');
    }

    try {
      const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || `HTTP ${res.status}`);
      }
      const items = json.items || [];
      if (!items.length) {
        resultsGrid.innerHTML = `<div class="empty-state">No results found for "${escapeHtml(q)}".</div>`;
        return;
      }

      // Fetch exact ISO durations for video results
      let durationMap = {};
      if (searchType === 'video') {
        const ids = items.map((i) => i.id?.videoId).filter(Boolean);
        if (ids.length) {
          const dRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${encodeURIComponent(ids.join(','))}&key=${encodeURIComponent(apiKey)}`
          );
          if (dRes.ok) {
            const dJson = await dRes.json();
            for (const v of dJson.items || []) {
              durationMap[v.id] = parseIsoDuration(v.contentDetails?.duration);
            }
          }
        }
      }

      resultsGrid.innerHTML = items
        .map((item) => {
          const sn = item.snippet || {};
          const thumb = sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || '';
          const videoId = item.id?.videoId;
          const channelId = item.id?.channelId;
          const playlistId = item.id?.playlistId;
          const dur = videoId ? durationMap[videoId] || '' : '';
          const href = videoId
            ? `https://www.youtube.com/watch?v=${videoId}`
            : channelId
            ? `https://www.youtube.com/channel/${channelId}`
            : `https://www.youtube.com/playlist?list=${playlistId}`;

          return `
            <article class="yt-card">
              <div class="yt-thumb-wrap">
                <img src="${escapeHtml(thumb)}" alt="${escapeHtml(sn.title)}" referrerpolicy="no-referrer" loading="lazy" />
                ${dur ? `<span class="yt-duration tabular-nums">${escapeHtml(dur)}</span>` : ''}
              </div>
              <div class="yt-card-body">
                <h4>${escapeHtml(sn.title)}</h4>
                <div class="muted-text">${escapeHtml(sn.channelTitle || '')}</div>
                <p class="yt-card-desc">${escapeHtml(sn.description || '')}</p>
                <div class="btn-row">
                  ${
                    videoId
                      ? `<button type="button" class="btn btn-primary btn-sm yt-watch-btn" data-kind="video" data-id="${escapeHtml(videoId)}" data-title="${escapeHtml(sn.title)}" data-channel="${escapeHtml(sn.channelTitle)}" data-dur="${escapeHtml(dur)}" data-desc="${escapeHtml(sn.description)}" data-thumb="${escapeHtml(thumb)}">Play</button>`
                      : playlistId
                      ? `<button type="button" class="btn btn-primary btn-sm yt-watch-btn" data-kind="playlist" data-id="${escapeHtml(playlistId)}" data-title="${escapeHtml(sn.title)}" data-channel="${escapeHtml(sn.channelTitle)}" data-desc="${escapeHtml(sn.description)}">Play Playlist</button>`
                      : ''
                  }
                  <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Open on YouTube</a>
                  ${
                    videoId
                      ? `<button type="button" class="btn btn-secondary btn-sm yt-save-btn" data-id="${escapeHtml(videoId)}" data-title="${escapeHtml(sn.title)}" data-channel="${escapeHtml(sn.channelTitle)}" data-thumb="${escapeHtml(thumb)}">☆ Save</button>`
                      : ''
                  }
                </div>
              </div>
            </article>
          `;
        })
        .join('');

      resultsGrid.querySelectorAll('.yt-watch-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          openVideoPlayer({
            kind: btn.dataset.kind,
            id: btn.dataset.id,
            title: btn.dataset.title,
            channelTitle: btn.dataset.channel,
            duration: btn.dataset.dur,
            description: btn.dataset.desc,
          });
        });
      });

      resultsGrid.querySelectorAll('.yt-save-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          toggleFavorite({
            id: btn.dataset.id,
            title: btn.dataset.title,
            channelTitle: btn.dataset.channel,
            thumb: btn.dataset.thumb,
          });
        });
      });
    } catch (err) {
      resultsGrid.innerHTML = `<div class="error-banner">YouTube API Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  container.querySelectorAll('[data-ytmode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeMode = btn.dataset.ytmode;
      container.querySelectorAll('[data-ytmode]').forEach((b) => b.classList.toggle('active', b === btn));
      searchPanel.classList.toggle('hidden', activeMode === 'inspector');
      inspectorPanel.classList.toggle('hidden', activeMode !== 'inspector');
      ccWrap.classList.toggle('hidden', activeMode !== 'videos');
      resultsGrid.innerHTML = '';
    });
  });

  toggleKeyBtn.addEventListener('click', () => keyPanel.classList.toggle('hidden'));

  container.querySelector('#yt-save-key').addEventListener('click', () => {
    const val = keyInput.value.trim();
    if (!val) return showToast('Enter an API key first.', 'error');
    apiKey = val;
    localStorage.setItem(STORAGE_KEYS.YT_API_KEY, val);
    toggleKeyBtn.textContent = 'API Key Configured';
    keyPanel.classList.add('hidden');
    showToast('YouTube API key saved locally.', 'success');
  });

  container.querySelector('#yt-clear-key').addEventListener('click', () => {
    apiKey = '';
    keyInput.value = '';
    localStorage.removeItem(STORAGE_KEYS.YT_API_KEY);
    toggleKeyBtn.textContent = 'Configure API Key';
    showToast('YouTube API key cleared.', 'info');
  });

  container.querySelector('#yt-search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runApiSearch(queryInput.value);
  });

  container.querySelectorAll('.yt-suggest-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      queryInput.value = btn.dataset.q;
      runApiSearch(btn.dataset.q);
    });
  });

  container.querySelector('#yt-inspect-btn').addEventListener('click', inspectDirectVideo);

  renderFavorites();
  if (activeMode === 'inspector') {
    inspectDirectVideo();
  }
}
