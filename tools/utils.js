// Shared utility helpers for FlyAI Tools (Pure Vanilla JavaScript)

export const STORAGE_KEYS = {
  THEME: 'flyai_theme',
  FAVORITES: 'flyai_favorites',
  RECENTS: 'flyai_recents',
  HISTORY: 'flyai_download_history',
  YT_API_KEY: 'flyai_yt_api_key',
  YT_FAVS: 'flyai_yt_favorites',
  FIREBASE_CFG: 'flyai_firebase_config',
};

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : val < 10 ? 2 : 1)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 220);
  }, 3400);
}

export function validateFile(file, { maxMB = 100, acceptPrefixes = [], acceptExts = [] } = {}) {
  if (!file) return 'No file selected.';
  if (file.size === 0) return 'The selected file is empty (0 bytes).';
  const maxBytes = maxMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `File "${file.name}" (${formatBytes(file.size)}) exceeds the ${maxMB} MB browser memory limit.`;
  }
  if (acceptPrefixes.length || acceptExts.length) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const mimeOk = acceptPrefixes.some((p) => file.type.startsWith(p));
    const extOk = acceptExts.includes(ext);
    if (!mimeOk && !extOk) {
      return `Unsupported file type for "${file.name}". Expected: ${[...acceptPrefixes, ...acceptExts].join(', ')}`;
    }
  }
  return null;
}

export function addDownloadHistory(entry) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
    const list = raw ? JSON.parse(raw) : [];
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      filename: entry.filename,
      toolName: entry.toolName || 'FlyAI Tool',
      toolId: entry.toolId || '',
      size: entry.size || 0,
      format: entry.format || '',
      timestamp: new Date().toISOString(),
    };
    const next = [item, ...list].slice(0, 50);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('flyai:history-updated'));
  } catch {
    // Ignore storage quota errors
  }
}

export function getDownloadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearDownloadHistory() {
  localStorage.removeItem(STORAGE_KEYS.HISTORY);
  window.dispatchEvent(new CustomEvent('flyai:history-updated'));
}

export function triggerDownload(blobOrUrl, filename, meta = {}) {
  const isBlob = blobOrUrl instanceof Blob;
  const url = isBlob ? URL.createObjectURL(blobOrUrl) : blobOrUrl;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (isBlob) {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  addDownloadHistory({
    filename,
    toolName: meta.toolName || 'Utility Export',
    toolId: meta.toolId || '',
    size: isBlob ? blobOrUrl.size : meta.size || 0,
    format: filename.split('.').pop()?.toUpperCase() || '',
  });
  showToast(`Downloaded ${filename}`, 'success');
}

export function createDropzone(container, options = {}) {
  const {
    accept = '*',
    multiple = false,
    title = 'Drop your file here or click to browse',
    hint = '100% browser-side processing — files never leave your device',
    sampleUrl = null,
    sampleLabel = 'Load Sample Studio Photo',
    onFiles,
  } = options;

  const inputId = 'dz-' + Math.random().toString(36).slice(2, 8);
  container.innerHTML = `
    <div class="dropzone" tabindex="0" role="button" aria-label="${escapeHtml(title)}">
      <input id="${inputId}" type="file" accept="${escapeHtml(accept)}" ${multiple ? 'multiple' : ''} class="sr-only" />
      <div class="dropzone-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div class="dropzone-title">${escapeHtml(title)}</div>
      <div class="dropzone-hint">${escapeHtml(hint)}</div>
      <div class="dropzone-actions">
        <button type="button" class="btn btn-primary dz-browse-btn">Select ${multiple ? 'Files' : 'File'}</button>
        ${sampleUrl ? `<button type="button" class="btn btn-secondary dz-sample-btn">${escapeHtml(sampleLabel)}</button>` : ''}
      </div>
    </div>
  `;

  const dz = container.querySelector('.dropzone');
  const input = container.querySelector(`#${inputId}`);
  const browseBtn = container.querySelector('.dz-browse-btn');
  const sampleBtn = container.querySelector('.dz-sample-btn');

  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    input.click();
  });

  dz.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    input.click();
  });

  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => {
    if (input.files && input.files.length > 0) {
      onFiles(Array.from(input.files));
      input.value = '';
    }
  });

  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dropzone-active');
  });

  dz.addEventListener('dragleave', () => {
    dz.classList.remove('dropzone-active');
  });

  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dropzone-active');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onFiles(multiple ? Array.from(files) : [files[0]]);
    }
  });

  if (sampleBtn && sampleUrl) {
    sampleBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      sampleBtn.disabled = true;
      sampleBtn.textContent = 'Loading...';
      try {
        const res = await fetch(sampleUrl);
        const blob = await res.blob();
        const file = new File([blob], 'sample-studio.jpg', { type: blob.type || 'image/jpeg' });
        onFiles([file]);
      } catch (err) {
        showToast('Could not load sample file: ' + err.message, 'error');
      } finally {
        sampleBtn.disabled = false;
        sampleBtn.textContent = sampleLabel;
      }
    });
  }
}

export function createProgressController(container) {
  container.innerHTML = `
    <div class="progress-wrap hidden">
      <div class="progress-header">
        <span class="progress-label">Processing...</span>
        <span class="progress-pct tabular-nums">0%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
    </div>
  `;
  const wrap = container.querySelector('.progress-wrap');
  const label = container.querySelector('.progress-label');
  const pct = container.querySelector('.progress-pct');
  const fill = container.querySelector('.progress-fill');

  return {
    start(text = 'Processing...') {
      wrap.classList.remove('hidden');
      label.textContent = text;
      pct.textContent = '0%';
      fill.style.width = '0%';
    },
    update(value, text) {
      const clamped = Math.max(0, Math.min(100, Math.round(value)));
      wrap.classList.remove('hidden');
      if (text) label.textContent = text;
      pct.textContent = `${clamped}%`;
      fill.style.width = `${clamped}%`;
    },
    finish(text = 'Completed') {
      label.textContent = text;
      pct.textContent = '100%';
      fill.style.width = '100%';
      setTimeout(() => wrap.classList.add('hidden'), 1200);
    },
    hide() {
      wrap.classList.add('hidden');
    },
  };
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unable to decode "${file.name}" as an image.`));
    };
    img.src = url;
  });
}

export async function detectMagicFormat(file) {
  const slice = file.slice(0, 64);
  const buf = await slice.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const hex = Array.from(bytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
  const ascii = Array.from(bytes.slice(0, 16))
    .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
    .join('');

  let detected = 'Unknown / Binary';
  let mime = file.type || 'application/octet-stream';
  let ext = 'bin';

  const starts = (...sig) => sig.every((v, i) => bytes[i] === v);

  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    detected = 'PNG Image (Portable Network Graphics)';
    mime = 'image/png';
    ext = 'png';
  } else if (starts(0xff, 0xd8, 0xff)) {
    detected = 'JPEG Image';
    mime = 'image/jpeg';
    ext = 'jpg';
  } else if (starts(0x47, 0x49, 0x46, 0x38)) {
    detected = 'GIF Image (GIF87a/89a)';
    mime = 'image/gif';
    ext = 'gif';
  } else if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    detected = 'WEBP Image';
    mime = 'image/webp';
    ext = 'webp';
  } else if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
    detected = 'WAV Audio (RIFF WAVE)';
    mime = 'audio/wav';
    ext = 'wav';
  } else if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) {
    detected = 'PDF Document';
    mime = 'application/pdf';
    ext = 'pdf';
  } else if (starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06)) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.docx')) {
      detected = 'Microsoft Word Document (DOCX / OOXML ZIP)';
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      ext = 'docx';
    } else if (lowerName.endsWith('.xlsx')) {
      detected = 'Microsoft Excel Workbook (XLSX / OOXML ZIP)';
      mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      ext = 'xlsx';
    } else {
      detected = 'ZIP Archive (or Office OOXML Container)';
      mime = 'application/zip';
      ext = 'zip';
    }
  } else if (starts(0x49, 0x44, 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    detected = 'MP3 Audio (MPEG-1/2 Audio Layer III)';
    mime = 'audio/mpeg';
    ext = 'mp3';
  } else if (starts(0x66, 0x4c, 0x61, 0x43)) {
    detected = 'FLAC Lossless Audio';
    mime = 'audio/flac';
    ext = 'flac';
  } else if (starts(0x4f, 0x67, 0x67, 0x53)) {
    detected = 'OGG Media Container';
    mime = 'audio/ogg';
    ext = 'ogg';
  } else if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    detected = 'MP4 / ISO Base Media Video';
    mime = 'video/mp4';
    ext = 'mp4';
  } else if (starts(0x1a, 0x45, 0xdf, 0xa3)) {
    detected = 'WebM / Matroska Video';
    mime = 'video/webm';
    ext = 'webm';
  } else if (starts(0x42, 0x4d)) {
    detected = 'BMP Bitmap Image';
    mime = 'image/bmp';
    ext = 'bmp';
  } else if (ascii.trim().startsWith('<svg') || ascii.trim().startsWith('<?xml')) {
    detected = 'XML / SVG Vector Document';
    mime = 'image/svg+xml';
    ext = 'svg';
  } else {
    const textSample = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(textSample)) {
      detected = 'Plain Text / UTF-8 Source';
      mime = 'text/plain';
      ext = 'txt';
    }
  }

  return { detected, mime, ext, hex, ascii };
}

export async function computeSha256(file) {
  if (!crypto?.subtle) return 'Unavailable in non-secure context';
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
