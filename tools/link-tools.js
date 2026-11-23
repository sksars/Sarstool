import { jsPDF } from 'jspdf';
import {
  createProgressController,
  escapeHtml,
  formatBytes,
  showToast,
  triggerDownload,
} from './utils.js';

export function renderLinkTool(container, tool) {
  let activeMode = tool.mode || 'image';
  let fetchedBlob = null;
  let fetchedName = 'downloaded-file';

  container.innerHTML = `
    <div class="tool-stack">
      <div class="segmented-tabs" role="tablist" aria-label="Link Tool Type">
        <button type="button" class="seg-btn ${activeMode === 'image' ? 'active' : ''}" data-lmode="image">Image URL</button>
        <button type="button" class="seg-btn ${activeMode === 'video' ? 'active' : ''}" data-lmode="video">Video URL</button>
        <button type="button" class="seg-btn ${activeMode === 'audio' ? 'active' : ''}" data-lmode="audio">Audio URL</button>
        <button type="button" class="seg-btn ${activeMode === 'pdf' ? 'active' : ''}" data-lmode="pdf">URL / HTML to PDF</button>
      </div>

      <div class="panel-section">
        <div class="field-group">
          <label for="link-url-input" id="link-url-label">Public Direct Media URL</label>
          <div class="input-action-row">
            <input type="url" id="link-url-input" placeholder="https://example.com/photo.jpg" />
            <button type="button" id="link-fetch-btn" class="btn btn-primary">Inspect &amp; Load</button>
          </div>
          <p class="field-hint" id="link-mode-hint"></p>
        </div>

        <div id="link-html-fallback" class="field-group hidden">
          <label for="link-raw-html">Or Paste Page Text / HTML Content to Export as PDF</label>
          <textarea id="link-raw-html" rows="6" placeholder="Paste article text or HTML here if the remote website blocks cross-origin (CORS) fetching..."></textarea>
          <div class="btn-row">
            <button type="button" id="link-convert-text-pdf" class="btn btn-secondary">Convert Pasted Content to PDF</button>
          </div>
        </div>

        <div id="link-progress"></div>
      </div>

      <div id="link-result-card" class="panel-section hidden">
        <div class="meta-grid" id="link-meta-grid"></div>
        <div id="link-preview-box" class="preview-stage"></div>
        <div id="link-cors-note" class="info-box hidden"></div>
        <div class="btn-row" id="link-actions-row">
          <button type="button" id="link-download-btn" class="btn btn-primary">Download File</button>
          <a id="link-open-tab" class="btn btn-secondary" target="_blank" rel="noopener noreferrer">Open Direct Link</a>
        </div>
      </div>
    </div>
  `;

  const urlInput = container.querySelector('#link-url-input');
  const labelEl = container.querySelector('#link-url-label');
  const hintEl = container.querySelector('#link-mode-hint');
  const htmlFallback = container.querySelector('#link-html-fallback');
  const rawHtmlInput = container.querySelector('#link-raw-html');
  const resultCard = container.querySelector('#link-result-card');
  const metaGrid = container.querySelector('#link-meta-grid');
  const previewBox = container.querySelector('#link-preview-box');
  const corsNote = container.querySelector('#link-cors-note');
  const dlBtn = container.querySelector('#link-download-btn');
  const openTab = container.querySelector('#link-open-tab');
  const progress = createProgressController(container.querySelector('#link-progress'));

  function updateModeUI() {
    fetchedBlob = null;
    resultCard.classList.add('hidden');
    corsNote.classList.add('hidden');
    htmlFallback.classList.toggle('hidden', activeMode !== 'pdf');

    if (activeMode === 'image') {
      labelEl.textContent = 'Direct Image URL (JPG, PNG, WEBP, SVG, GIF)';
      urlInput.placeholder = 'https://example.com/image.png';
      hintEl.textContent = 'Also test with our local sample: ' + window.location.origin + '/assets/sample-studio.jpg';
      if (!urlInput.value) urlInput.value = window.location.origin + '/assets/sample-studio.jpg';
    } else if (activeMode === 'video') {
      labelEl.textContent = 'Direct Public Video URL (MP4, WebM)';
      urlInput.placeholder = 'https://example.com/clip.mp4';
      hintEl.textContent = 'Supports direct public video file URLs. Does not bypass DRM or third-party platform protections.';
    } else if (activeMode === 'audio') {
      labelEl.textContent = 'Direct Public Audio URL (MP3, WAV, OGG)';
      urlInput.placeholder = 'https://example.com/track.mp3';
      hintEl.textContent = 'Supports direct public audio file links with browser metadata preview.';
    } else {
      labelEl.textContent = 'Public Web Page URL (CORS-Permitted) or HTML';
      urlInput.placeholder = 'https://example.com/article.html';
      hintEl.textContent = 'Fetches permitted URLs directly or converts pasted text/HTML into a clean multi-page PDF.';
    }
  }

  function guessFilename(urlStr, contentType) {
    try {
      const u = new URL(urlStr);
      const last = u.pathname.split('/').filter(Boolean).pop();
      if (last && last.includes('.')) return decodeURIComponent(last);
    } catch {
      // ignore
    }
    const extMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
      'audio/ogg': 'ogg',
      'application/pdf': 'pdf',
    };
    const ext = extMap[(contentType || '').split(';')[0].trim()] || 'bin';
    return `flyai-link-file.${ext}`;
  }

  function renderTextToPdf(title, text) {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 16;
    const maxW = pdf.internal.pageSize.getWidth() - margin * 2;
    const pageH = pdf.internal.pageSize.getHeight();
    let y = 20;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    const titleLines = pdf.splitTextToSize(title, maxW);
    pdf.text(titleLines, margin, y);
    y += titleLines.length * 7 + 4;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    const lines = pdf.splitTextToSize(text.trim() || 'Empty document', maxW);
    for (const line of lines) {
      if (y > pageH - 18) {
        pdf.addPage();
        y = 20;
      }
      pdf.text(line, margin, y);
      y += 5.5;
    }
    return pdf.output('blob');
  }

  async function inspectUrl() {
    const urlStr = urlInput.value.trim();
    if (!urlStr) {
      showToast('Enter a valid http:// or https:// URL first.', 'error');
      return;
    }
    let parsed;
    try {
      parsed = new URL(urlStr);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP/HTTPS URLs are supported.');
    } catch (err) {
      showToast('Invalid URL: ' + err.message, 'error');
      return;
    }

    fetchedBlob = null;
    resultCard.classList.remove('hidden');
    corsNote.classList.add('hidden');
    openTab.href = parsed.href;
    previewBox.innerHTML = '';
    metaGrid.innerHTML = '';
    progress.start('Fetching URL headers & stream...');

    try {
      const response = await fetch(parsed.href);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLen = parseInt(response.headers.get('content-length') || '0', 10);

      const reader = response.body?.getReader();
      let chunks = [];
      let received = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (contentLen > 0) {
            progress.update((received / contentLen) * 100, `Downloading ${formatBytes(received)} / ${formatBytes(contentLen)}`);
          } else {
            progress.update(65, `Downloaded ${formatBytes(received)}...`);
          }
        }
        fetchedBlob = new Blob(chunks, { type: contentType.split(';')[0] });
      } else {
        fetchedBlob = await response.blob();
      }

      fetchedName = guessFilename(parsed.href, contentType);

      if (activeMode === 'pdf' && !contentType.includes('pdf')) {
        const htmlText = await fetchedBlob.text();
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        doc.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
        const cleanText = (doc.body?.textContent || htmlText).replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        const title = doc.title || parsed.hostname;
        fetchedBlob = renderTextToPdf(title, cleanText);
        fetchedName = (parsed.hostname || 'webpage') + '.pdf';
      }

      progress.finish('Loaded');
      metaGrid.innerHTML = `
        <div class="meta-item"><span class="meta-k">File Name</span><span class="meta-v">${escapeHtml(fetchedName)}</span></div>
        <div class="meta-item"><span class="meta-k">Size</span><span class="meta-v tabular-nums">${escapeHtml(formatBytes(fetchedBlob.size))}</span></div>
        <div class="meta-item"><span class="meta-k">Format / MIME</span><span class="meta-v">${escapeHtml(fetchedBlob.type || contentType)}</span></div>
      `;

      const objUrl = URL.createObjectURL(fetchedBlob);
      if (activeMode === 'image') {
        previewBox.innerHTML = `<img src="${objUrl}" alt="${escapeHtml(fetchedName)}" class="preview-media" />`;
      } else if (activeMode === 'video') {
        previewBox.innerHTML = `<video src="${objUrl}" controls class="preview-media"></video>`;
      } else if (activeMode === 'audio') {
        previewBox.innerHTML = `<audio src="${objUrl}" controls class="w-full"></audio>`;
      } else {
        previewBox.innerHTML = `<div class="info-box">PDF generated cleanly (${formatBytes(fetchedBlob.size)}). Click Download File to save.</div>`;
      }
      dlBtn.disabled = false;
    } catch (err) {
      progress.hide();
      // Fallback: media tags can still preview cross-origin URLs even if fetch() is blocked by CORS
      fetchedName = guessFilename(parsed.href, '');
      metaGrid.innerHTML = `
        <div class="meta-item"><span class="meta-k">File Name</span><span class="meta-v">${escapeHtml(fetchedName)}</span></div>
        <div class="meta-item"><span class="meta-k">Access Status</span><span class="meta-v">Cross-Origin (CORS) Restricted</span></div>
      `;
      corsNote.classList.remove('hidden');
      corsNote.innerHTML = `
        <strong>Remote Server CORS Notice:</strong> ${escapeHtml(err.message)}. The remote server does not expose CORS headers for direct browser blob reading. You can still preview supported media below or open the direct link in a new tab to save it.
      `;
      if (activeMode === 'image') {
        previewBox.innerHTML = `<img src="${escapeHtml(parsed.href)}" referrerpolicy="no-referrer" alt="Remote preview" class="preview-media" />`;
      } else if (activeMode === 'video') {
        previewBox.innerHTML = `<video src="${escapeHtml(parsed.href)}" controls class="preview-media"></video>`;
      } else if (activeMode === 'audio') {
        previewBox.innerHTML = `<audio src="${escapeHtml(parsed.href)}" controls class="w-full"></audio>`;
      } else {
        previewBox.innerHTML = `<div class="info-box">Paste the page's text or HTML in the box above to convert it locally to PDF.</div>`;
      }
      dlBtn.disabled = true;
    }
  }

  container.querySelectorAll('[data-lmode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeMode = btn.dataset.lmode;
      container.querySelectorAll('[data-lmode]').forEach((b) => b.classList.toggle('active', b === btn));
      urlInput.value = '';
      updateModeUI();
    });
  });

  container.querySelector('#link-fetch-btn').addEventListener('click', inspectUrl);

  dlBtn.addEventListener('click', () => {
    if (!fetchedBlob) return;
    triggerDownload(fetchedBlob, fetchedName, { toolName: tool.name, toolId: tool.id });
  });

  container.querySelector('#link-convert-text-pdf').addEventListener('click', () => {
    const raw = rawHtmlInput.value.trim();
    if (!raw) {
      showToast('Paste HTML or text content first.', 'error');
      return;
    }
    let clean = raw;
    if (/<[a-z][\s\S]*>/i.test(raw)) {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      doc.querySelectorAll('script, style').forEach((el) => el.remove());
      clean = (doc.body?.textContent || raw).replace(/\n{3,}/g, '\n\n').trim();
    }
    const blob = renderTextToPdf('FlyAI URL / Document Export', clean);
    triggerDownload(blob, 'flyai-webpage.pdf', { toolName: tool.name, toolId: tool.id });
  });

  updateModeUI();
}
