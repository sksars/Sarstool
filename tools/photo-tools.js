import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import {
  createDropzone,
  createProgressController,
  escapeHtml,
  formatBytes,
  loadImageFromFile,
  showToast,
  triggerDownload,
  validateFile,
} from './utils.js';

function runImageWorker(action, imageData, options, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/image-worker.js', import.meta.url), { type: 'module' });
    const copy = new Uint8ClampedArray(imageData.data);
    const transferable = new ImageData(copy, imageData.width, imageData.height);

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        onProgress?.(e.data.value);
      } else if (e.data.type === 'done') {
        worker.terminate();
        resolve(e.data.imageData);
      } else if (e.data.type === 'error') {
        worker.terminate();
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Image worker error'));
    };
    worker.postMessage({ id: 1, action, imageData: transferable, options }, [transferable.data.buffer]);
  });
}

function canvasToBlob(canvas, mime = 'image/png', quality = 0.92) {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

export function renderPhotoTool(container, tool) {
  const mode = tool.mode;

  // Multi-image tools: img-to-pdf, batch, format
  if (mode === 'img-to-pdf' || mode === 'batch' || mode === 'format') {
    renderMultiPhotoTool(container, tool, mode);
    return;
  }

  // Single-image interactive studio tools
  container.innerHTML = `
    <div class="tool-stack">
      <div id="ph-dropzone"></div>
      <div id="ph-progress"></div>
      <div id="ph-workspace" class="tool-workspace hidden"></div>
    </div>
  `;

  const dzEl = container.querySelector('#ph-dropzone');
  const wsEl = container.querySelector('#ph-workspace');
  const progress = createProgressController(container.querySelector('#ph-progress'));

  createDropzone(dzEl, {
    accept: 'image/*',
    multiple: false,
    title: `Drop a photo for ${tool.name}`,
    hint: 'Supports JPG, PNG, WEBP, GIF, BMP · Processed 100% locally on your device',
    sampleUrl: '/assets/sample-studio.jpg',
    sampleLabel: 'Load Sample Studio Photo',
    onFiles: async ([file]) => {
      const err = validateFile(file, { maxMB: 50, acceptPrefixes: ['image/'] });
      if (err) return showToast(err, 'error');
      try {
        const img = await loadImageFromFile(file);
        wsEl.classList.remove('hidden');
        mountSinglePhotoMode(wsEl, tool, mode, file, img, progress);
      } catch (e) {
        showToast(e.message, 'error');
      }
    },
  });
}

function renderMultiPhotoTool(container, tool, mode) {
  let queue = []; // { file, img, url }

  container.innerHTML = `
    <div class="tool-stack">
      <div id="phm-dropzone"></div>
      <div id="phm-progress"></div>
      <div id="phm-workspace" class="panel-section hidden"></div>
    </div>
  `;

  const dzEl = container.querySelector('#phm-dropzone');
  const wsEl = container.querySelector('#phm-workspace');
  const progress = createProgressController(container.querySelector('#phm-progress'));

  createDropzone(dzEl, {
    accept: 'image/*',
    multiple: true,
    title: mode === 'img-to-pdf' ? 'Drop one or more images to build a PDF' : 'Drop multiple images to process at once',
    sampleUrl: '/assets/sample-studio.jpg',
    sampleLabel: 'Add Sample Studio Photo',
    onFiles: async (files) => {
      for (const f of files) {
        const err = validateFile(f, { maxMB: 50, acceptPrefixes: ['image/'] });
        if (err) { showToast(err, 'error'); continue; }
        const img = await loadImageFromFile(f);
        queue.push({ file: f, img, url: URL.createObjectURL(f) });
      }
      if (queue.length) {
        wsEl.classList.remove('hidden');
        renderQueueUI();
      }
    },
  });

  function renderQueueUI() {
    if (!queue.length) {
      wsEl.classList.add('hidden');
      return;
    }

    const controlsHtml =
      mode === 'img-to-pdf'
        ? `
        <div class="grid-3">
          <div class="field-group">
            <label for="pdf-page-size">Page Size</label>
            <select id="pdf-page-size">
              <option value="a4" selected>A4 (210 × 297 mm)</option>
              <option value="letter">US Letter (8.5 × 11 in)</option>
              <option value="fit">Fit to Image Size</option>
            </select>
          </div>
          <div class="field-group">
            <label for="pdf-orient">Orientation</label>
            <select id="pdf-orient">
              <option value="portrait" selected>Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
          <div class="field-group">
            <label for="pdf-margin">Margin (mm)</label>
            <select id="pdf-margin">
              <option value="0">No Margin (Full Bleed)</option>
              <option value="10" selected>10 mm</option>
              <option value="20">20 mm</option>
            </select>
          </div>
        </div>
        <button type="button" id="phm-run-btn" class="btn btn-primary">Generate PDF (${queue.length} pages)</button>
      `
        : mode === 'format'
        ? `
        <div class="grid-3">
          <div class="field-group">
            <label for="fmt-target">Target Format</label>
            <select id="fmt-target">
              <option value="image/png">PNG (Lossless + Alpha)</option>
              <option value="image/jpeg">JPG (Compact Photo)</option>
              <option value="image/webp">WEBP (Modern Web)</option>
            </select>
          </div>
          <div class="field-group">
            <label for="fmt-quality">Quality (<span id="fmt-q-val" class="tabular-nums">92</span>%)</label>
            <input type="range" id="fmt-quality" min="20" max="100" value="92" />
          </div>
          <div class="field-group">
            <label for="fmt-bg">JPG Matte Background</label>
            <input type="color" id="fmt-bg" value="#ffffff" />
          </div>
        </div>
        <button type="button" id="phm-run-btn" class="btn btn-primary">Convert ${queue.length} Image(s)</button>
      `
        : `
        <div class="grid-4">
          <div class="field-group">
            <label for="bat-max-w">Max Width (px, 0 = keep)</label>
            <input type="number" id="bat-max-w" min="0" max="8000" value="1600" />
          </div>
          <div class="field-group">
            <label for="bat-fmt">Output Format</label>
            <select id="bat-fmt">
              <option value="image/jpeg">JPG</option>
              <option value="image/webp" selected>WEBP</option>
              <option value="image/png">PNG</option>
            </select>
          </div>
          <div class="field-group">
            <label for="bat-q">Quality (<span id="bat-q-val" class="tabular-nums">85</span>%)</label>
            <input type="range" id="bat-q" min="20" max="100" value="85" />
          </div>
          <div class="field-group">
            <label for="bat-wm">Watermark Text (Optional)</label>
            <input type="text" id="bat-wm" placeholder="e.g. © FlyAI Studio" />
          </div>
        </div>
        <button type="button" id="phm-run-btn" class="btn btn-primary">Process All &amp; Export ZIP</button>
      `;

    wsEl.innerHTML = `
      <div class="flex-between" style="margin-bottom:1rem">
        <strong>Queued Images (${queue.length})</strong>
        <button type="button" id="phm-clear" class="btn btn-secondary btn-sm">Clear Queue</button>
      </div>
      <div class="thumb-grid" style="margin-bottom:1.25rem">
        ${queue
          .map(
            (q, i) => `
          <div class="thumb-card">
            <img src="${q.url}" alt="${escapeHtml(q.file.name)}" />
            <div class="thumb-meta">
              <span class="truncate" title="${escapeHtml(q.file.name)}">${escapeHtml(q.file.name)}</span>
              <div class="btn-row">
                ${i > 0 ? `<button type="button" class="btn btn-secondary btn-xs phm-up" data-idx="${i}">↑</button>` : ''}
                <button type="button" class="btn btn-secondary btn-xs phm-rm" data-idx="${i}">✕</button>
              </div>
            </div>
          </div>
        `
          )
          .join('')}
      </div>
      ${controlsHtml}
      <div id="phm-out" style="margin-top:1rem"></div>
    `;

    wsEl.querySelector('#phm-clear').addEventListener('click', () => {
      queue = [];
      renderQueueUI();
    });
    wsEl.querySelectorAll('.phm-rm').forEach((b) => {
      b.addEventListener('click', () => {
        queue.splice(parseInt(b.dataset.idx, 10), 1);
        renderQueueUI();
      });
    });
    wsEl.querySelectorAll('.phm-up').forEach((b) => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.idx, 10);
        [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]];
        renderQueueUI();
      });
    });

    wsEl.querySelector('#fmt-quality')?.addEventListener('input', (e) => {
      wsEl.querySelector('#fmt-q-val').textContent = e.target.value;
    });
    wsEl.querySelector('#bat-q')?.addEventListener('input', (e) => {
      wsEl.querySelector('#bat-q-val').textContent = e.target.value;
    });

    wsEl.querySelector('#phm-run-btn').addEventListener('click', async () => {
      if (mode === 'img-to-pdf') {
        const pageSize = wsEl.querySelector('#pdf-page-size').value;
        const orient = wsEl.querySelector('#pdf-orient').value;
        const margin = parseInt(wsEl.querySelector('#pdf-margin').value, 10);
        progress.start('Building multi-page PDF...');
        let pdf = null;
        for (let i = 0; i < queue.length; i++) {
          const { img } = queue[i];
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0);
          const dataUrl = c.toDataURL('image/jpeg', 0.92);

          if (pageSize === 'fit') {
            const mmW = c.width * 0.264583;
            const mmH = c.height * 0.264583;
            if (!pdf) {
              pdf = new jsPDF({ unit: 'mm', format: [mmW, mmH], orientation: mmW > mmH ? 'l' : 'p' });
            } else {
              pdf.addPage([mmW, mmH], mmW > mmH ? 'l' : 'p');
            }
            pdf.addImage(dataUrl, 'JPEG', 0, 0, mmW, mmH);
          } else {
            if (!pdf) {
              pdf = new jsPDF({ unit: 'mm', format: pageSize, orientation: orient === 'landscape' ? 'l' : 'p' });
            } else {
              pdf.addPage(pageSize, orient === 'landscape' ? 'l' : 'p');
            }
            const pw = pdf.internal.pageSize.getWidth() - margin * 2;
            const ph = pdf.internal.pageSize.getHeight() - margin * 2;
            const scale = Math.min(pw / c.width, ph / c.height);
            const dw = c.width * scale;
            const dh = c.height * scale;
            pdf.addImage(dataUrl, 'JPEG', margin + (pw - dw) / 2, margin + (ph - dh) / 2, dw, dh);
          }
          progress.update(((i + 1) / queue.length) * 100);
        }
        progress.finish('PDF Ready');
        const blob = pdf.output('blob');
        triggerDownload(blob, 'flyai-images.pdf', { toolName: tool.name, toolId: tool.id });
        return;
      }

      // Batch or Format Conversion
      const isBatch = mode === 'batch';
      const mime = wsEl.querySelector(isBatch ? '#bat-fmt' : '#fmt-target').value;
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      const quality = parseInt(wsEl.querySelector(isBatch ? '#bat-q' : '#fmt-quality').value, 10) / 100;
      const bgFill = wsEl.querySelector('#fmt-bg')?.value || '#ffffff';
      const maxW = isBatch ? parseInt(wsEl.querySelector('#bat-max-w').value, 10) || 0 : 0;
      const wm = isBatch ? wsEl.querySelector('#bat-wm').value.trim() : '';

      progress.start('Processing images...');
      const results = [];
      for (let i = 0; i < queue.length; i++) {
        const { file, img } = queue[i];
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (maxW > 0 && w > maxW) {
          h = Math.round((h * maxW) / w);
          w = maxW;
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (mime === 'image/jpeg') {
          ctx.fillStyle = bgFill;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(img, 0, 0, w, h);
        if (wm) {
          const fontSize = Math.max(14, Math.round(w * 0.032));
          ctx.font = `600 ${fontSize}px sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.72)';
          ctx.strokeStyle = 'rgba(0,0,0,0.45)';
          ctx.lineWidth = Math.max(2, fontSize * 0.12);
          ctx.textAlign = 'right';
          ctx.strokeText(wm, w - 20, h - 20);
          ctx.fillText(wm, w - 20, h - 20);
        }
        const blob = await canvasToBlob(c, mime, quality);
        const name = file.name.replace(/\.[^.]+$/, '') + '.' + ext;
        results.push({ name, blob, origSize: file.size });
        progress.update(((i + 1) / queue.length) * 100);
      }
      progress.finish('Completed');

      if (isBatch || results.length > 1) {
        const zip = new JSZip();
        results.forEach((r) => zip.file(r.name, r.blob));
        const zblob = await zip.generateAsync({ type: 'blob' });
        wsEl.querySelector('#phm-out').innerHTML = `
          <div class="flex-between">
            <strong>Processed ${results.length} file(s) (${formatBytes(zblob.size)} ZIP)</strong>
            <button type="button" id="phm-dl-zip" class="btn btn-primary btn-sm">Download ZIP</button>
          </div>
        `;
        wsEl.querySelector('#phm-dl-zip').addEventListener('click', () => {
          triggerDownload(zblob, `flyai-batch-${ext}.zip`, { toolName: tool.name, toolId: tool.id });
        });
      } else if (results.length === 1) {
        const r = results[0];
        triggerDownload(r.blob, r.name, { toolName: tool.name, toolId: tool.id });
      }
    });
  }
}

function mountSinglePhotoMode(wsEl, tool, mode, file, img, progress) {
  const baseName = file.name.replace(/\.[^.]+$/, '');

  // Helper to render standard Controls + Canvas Preview layout
  function buildLayout(controlsHtml, extraPreviewHtml = '') {
    wsEl.innerHTML = `
      <div class="tool-controls-pane">${controlsHtml}</div>
      <div class="tool-preview-pane">
        <div class="preview-stage checkerboard-bg">
          <canvas id="ph-canvas" class="preview-canvas"></canvas>
          ${extraPreviewHtml}
        </div>
        <div class="meta-strip">
          <span id="ph-dim-info" class="tabular-nums">${img.naturalWidth} × ${img.naturalHeight} px</span>
          <span aria-hidden="true">·</span>
          <span id="ph-size-info" class="tabular-nums">Original ${formatBytes(file.size)}</span>
        </div>
        <div class="btn-row" id="ph-dl-row">
          <button type="button" id="ph-dl-png" class="btn btn-primary">Download PNG</button>
          <button type="button" id="ph-dl-jpg" class="btn btn-secondary">Download JPG</button>
          <button type="button" id="ph-dl-webp" class="btn btn-secondary">Download WEBP</button>
        </div>
      </div>
    `;
  }

  // 1. AI Background Remover & Background Changer
  if (mode === 'bg-remover' || mode === 'bg-changer') {
    const isChanger = mode === 'bg-changer';
    buildLayout(`
      <div class="panel-section">
        <h3 class="section-subtitle">Segmentation Controls</h3>
        <div class="field-group">
          <label for="bg-tol">Edge Tolerance (<span id="bg-tol-v" class="tabular-nums">36</span>)</label>
          <input type="range" id="bg-tol" min="8" max="90" value="36" />
        </div>
        <div class="field-group">
          <label for="bg-feather">Edge Feathering (<span id="bg-fea-v" class="tabular-nums">2</span>px)</label>
          <input type="range" id="bg-fea" min="0" max="6" value="2" />
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="bg-contig" checked />
          <span>Contiguous border fill (protect interior highlights)</span>
        </label>
        <div class="btn-row" style="margin-top:0.75rem">
          <button type="button" id="bg-auto-btn" class="btn btn-primary">Remove Background</button>
          <button type="button" id="bg-reset-btn" class="btn btn-secondary">Reset</button>
        </div>
      </div>

      <div class="panel-section">
        <h3 class="section-subtitle">Manual Touch-Up Brush</h3>
        <div class="segmented-tabs">
          <button type="button" class="seg-btn active" data-bmode="pick">Pick BG Color</button>
          <button type="button" class="seg-btn" data-bmode="erase">Erase Brush</button>
          <button type="button" class="seg-btn" data-bmode="restore">Restore Brush</button>
        </div>
        <div class="field-group" style="margin-top:0.65rem">
          <label for="bg-brush-size">Brush Radius (<span id="bg-bs-v" class="tabular-nums">24</span>px)</label>
          <input type="range" id="bg-brush-size" min="5" max="80" value="24" />
        </div>
      </div>

      ${
        isChanger
          ? `
        <div class="panel-section">
          <h3 class="section-subtitle">Replacement Backdrop</h3>
          <div class="grid-2">
            <div class="field-group">
              <label for="bg-fill-type">Backdrop Type</label>
              <select id="bg-fill-type">
                <option value="solid" selected>Solid Color</option>
                <option value="gradient">Studio Gradient</option>
                <option value="image">Custom Image</option>
              </select>
            </div>
            <div class="field-group">
              <label for="bg-solid-color">Primary Color</label>
              <input type="color" id="bg-solid-color" value="#2563eb" />
            </div>
          </div>
          <div class="field-group hidden" id="bg-custom-img-wrap">
            <label for="bg-custom-img">Upload Background Image</label>
            <input type="file" id="bg-custom-img" accept="image/*" />
          </div>
        </div>
      `
          : ''
      }
    `);

    const canvas = wsEl.querySelector('#ph-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Cap working canvas at 1800px for smooth mobile responsiveness
    const maxDim = 1800;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * scale);
    const H = Math.round(img.naturalHeight * scale);
    canvas.width = W;
    canvas.height = H;

    // Offscreen original & alpha-cutout buffer
    const origCanvas = document.createElement('canvas');
    origCanvas.width = W;
    origCanvas.height = H;
    origCanvas.getContext('2d').drawImage(img, 0, 0, W, H);

    const fgCanvas = document.createElement('canvas');
    fgCanvas.width = W;
    fgCanvas.height = H;
    const fgCtx = fgCanvas.getContext('2d', { willReadFrequently: true });
    fgCtx.drawImage(origCanvas, 0, 0);

    let customBgImg = null;
    let brushMode = 'pick';
    let samplePoints = [];

    function compositeDisplay() {
      ctx.clearRect(0, 0, W, H);
      if (isChanger) {
        const fillType = wsEl.querySelector('#bg-fill-type').value;
        const col = wsEl.querySelector('#bg-solid-color').value;
        if (fillType === 'solid') {
          ctx.fillStyle = col;
          ctx.fillRect(0, 0, W, H);
        } else if (fillType === 'gradient') {
          const grad = ctx.createLinearGradient(0, 0, W, H);
          grad.addColorStop(0, col);
          grad.addColorStop(1, '#0f172a');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
        } else if (fillType === 'image' && customBgImg) {
          const sc = Math.max(W / customBgImg.naturalWidth, H / customBgImg.naturalHeight);
          const dw = customBgImg.naturalWidth * sc;
          const dh = customBgImg.naturalHeight * sc;
          ctx.drawImage(customBgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        }
      }
      ctx.drawImage(fgCanvas, 0, 0);
    }

    async function runSegmentation() {
      const tol = parseInt(wsEl.querySelector('#bg-tol').value, 10);
      const feather = parseInt(wsEl.querySelector('#bg-fea').value, 10);
      const contiguous = wsEl.querySelector('#bg-contig').checked;
      progress.start('Segmenting foreground in Web Worker...');
      const origData = origCanvas.getContext('2d').getImageData(0, 0, W, H);
      const outData = await runImageWorker(
        'removeBackground',
        origData,
        { tolerance: tol, feather, contiguous, samplePoints },
        (p) => progress.update(p)
      );
      fgCtx.putImageData(outData, 0, 0);
      compositeDisplay();
      progress.finish('Background Removed');
    }

    wsEl.querySelector('#bg-tol').addEventListener('input', (e) => (wsEl.querySelector('#bg-tol-v').textContent = e.target.value));
    wsEl.querySelector('#bg-fea').addEventListener('input', (e) => (wsEl.querySelector('#bg-fea-v').textContent = e.target.value));
    wsEl.querySelector('#bg-brush-size').addEventListener('input', (e) => (wsEl.querySelector('#bg-bs-v').textContent = e.target.value));
    wsEl.querySelector('#bg-auto-btn').addEventListener('click', () => {
      samplePoints = [];
      runSegmentation();
    });
    wsEl.querySelector('#bg-reset-btn').addEventListener('click', () => {
      samplePoints = [];
      fgCtx.clearRect(0, 0, W, H);
      fgCtx.drawImage(origCanvas, 0, 0);
      compositeDisplay();
    });

    wsEl.querySelectorAll('[data-bmode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        brushMode = btn.dataset.bmode;
        wsEl.querySelectorAll('[data-bmode]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    let painting = false;
    function canvasCoords(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * W) / rect.width,
        y: ((e.clientY - rect.top) * H) / rect.height,
      };
    }

    function applyBrushAt(pt) {
      const r = parseInt(wsEl.querySelector('#bg-brush-size').value, 10);
      if (brushMode === 'erase') {
        fgCtx.save();
        fgCtx.globalCompositeOperation = 'destination-out';
        fgCtx.beginPath();
        fgCtx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        fgCtx.fill();
        fgCtx.restore();
        compositeDisplay();
      } else if (brushMode === 'restore') {
        fgCtx.save();
        fgCtx.beginPath();
        fgCtx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
        fgCtx.clip();
        fgCtx.drawImage(origCanvas, 0, 0);
        fgCtx.restore();
        compositeDisplay();
      }
    }

    canvas.addEventListener('pointerdown', (e) => {
      const pt = canvasCoords(e);
      if (brushMode === 'pick') {
        samplePoints = [pt];
        runSegmentation();
      } else {
        painting = true;
        applyBrushAt(pt);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!painting) return;
      applyBrushAt(canvasCoords(e));
    });
    window.addEventListener('pointerup', () => (painting = false));

    if (isChanger) {
      const fillSel = wsEl.querySelector('#bg-fill-type');
      const customWrap = wsEl.querySelector('#bg-custom-img-wrap');
      fillSel.addEventListener('change', () => {
        customWrap.classList.toggle('hidden', fillSel.value !== 'image');
        compositeDisplay();
      });
      wsEl.querySelector('#bg-solid-color').addEventListener('input', compositeDisplay);
      wsEl.querySelector('#bg-custom-img').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        customBgImg = await loadImageFromFile(f);
        compositeDisplay();
      });
    }

    // Automatically run initial segmentation cleanly on load
    runSegmentation();
    wireStandardDownloads(wsEl, canvas, baseName, tool);
    return;
  }

  // 2. Full Photo Editor
  if (mode === 'editor') {
    buildLayout(`
      <div class="panel-section">
        <h3 class="section-subtitle">Color &amp; Light</h3>
        <div class="field-group"><label>Brightness (<span id="ed-bri-v" class="tabular-nums">100</span>%)</label><input type="range" id="ed-bri" min="20" max="200" value="100" /></div>
        <div class="field-group"><label>Contrast (<span id="ed-con-v" class="tabular-nums">100</span>%)</label><input type="range" id="ed-con" min="20" max="200" value="100" /></div>
        <div class="field-group"><label>Saturation (<span id="ed-sat-v" class="tabular-nums">100</span>%)</label><input type="range" id="ed-sat" min="0" max="220" value="100" /></div>
        <div class="field-group"><label>Hue Rotate (<span id="ed-hue-v" class="tabular-nums">0</span>°)</label><input type="range" id="ed-hue" min="-180" max="180" value="0" /></div>
        <div class="field-group"><label>Sepia Tone (<span id="ed-sep-v" class="tabular-nums">0</span>%)</label><input type="range" id="ed-sep" min="0" max="100" value="0" /></div>
      </div>
      <div class="panel-section">
        <h3 class="section-subtitle">Transform &amp; Compare</h3>
        <div class="btn-row">
          <button type="button" id="ed-rot-l" class="btn btn-secondary btn-sm">Rotate -90°</button>
          <button type="button" id="ed-rot-r" class="btn btn-secondary btn-sm">Rotate +90°</button>
          <button type="button" id="ed-flip-h" class="btn btn-secondary btn-sm">Flip H</button>
          <button type="button" id="ed-flip-v" class="btn btn-secondary btn-sm">Flip V</button>
        </div>
        <div class="btn-row" style="margin-top:0.75rem">
          <button type="button" id="ed-compare" class="btn btn-secondary btn-sm">Hold to Compare Original</button>
          <button type="button" id="ed-reset" class="btn btn-secondary btn-sm">Reset All</button>
        </div>
      </div>
    `);

    const canvas = wsEl.querySelector('#ph-canvas');
    const ctx = canvas.getContext('2d');
    let rot = 0, flipH = 1, flipV = 1, showOrig = false;

    function draw() {
      const bri = wsEl.querySelector('#ed-bri').value;
      const con = wsEl.querySelector('#ed-con').value;
      const sat = wsEl.querySelector('#ed-sat').value;
      const hue = wsEl.querySelector('#ed-hue').value;
      const sep = wsEl.querySelector('#ed-sep').value;

      wsEl.querySelector('#ed-bri-v').textContent = bri;
      wsEl.querySelector('#ed-con-v').textContent = con;
      wsEl.querySelector('#ed-sat-v').textContent = sat;
      wsEl.querySelector('#ed-hue-v').textContent = hue;
      wsEl.querySelector('#ed-sep-v').textContent = sep;

      const swap = rot % 180 !== 0;
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      wsEl.querySelector('#ph-dim-info').textContent = `${canvas.width} × ${canvas.height} px`;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!showOrig) {
        ctx.filter = `brightness(${bri}%) contrast(${con}%) saturate(${sat}%) hue-rotate(${hue}deg) sepia(${sep}%)`;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(flipH, flipV);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
    }

    ['#ed-bri', '#ed-con', '#ed-sat', '#ed-hue', '#ed-sep'].forEach((id) => {
      wsEl.querySelector(id).addEventListener('input', draw);
    });
    wsEl.querySelector('#ed-rot-l').addEventListener('click', () => { rot = (rot + 270) % 360; draw(); });
    wsEl.querySelector('#ed-rot-r').addEventListener('click', () => { rot = (rot + 90) % 360; draw(); });
    wsEl.querySelector('#ed-flip-h').addEventListener('click', () => { flipH *= -1; draw(); });
    wsEl.querySelector('#ed-flip-v').addEventListener('click', () => { flipV *= -1; draw(); });

    const cmp = wsEl.querySelector('#ed-compare');
    cmp.addEventListener('pointerdown', () => { showOrig = true; draw(); });
    window.addEventListener('pointerup', () => { if (showOrig) { showOrig = false; draw(); } });

    wsEl.querySelector('#ed-reset').addEventListener('click', () => {
      wsEl.querySelector('#ed-bri').value = 100;
      wsEl.querySelector('#ed-con').value = 100;
      wsEl.querySelector('#ed-sat').value = 100;
      wsEl.querySelector('#ed-hue').value = 0;
      wsEl.querySelector('#ed-sep').value = 0;
      rot = 0; flipH = 1; flipV = 1;
      draw();
    });

    draw();
    wireStandardDownloads(wsEl, canvas, baseName, tool);
    return;
  }

  // 3. Interactive Image Cropper
  if (mode === 'cropper') {
    buildLayout(`
      <div class="panel-section">
        <h3 class="section-subtitle">Aspect Ratio</h3>
        <div class="segmented-tabs">
          <button type="button" class="seg-btn active" data-ar="0">Free</button>
          <button type="button" class="seg-btn" data-ar="1">1:1</button>
          <button type="button" class="seg-btn" data-ar="1.3333">4:3</button>
          <button type="button" class="seg-btn" data-ar="1.7777">16:9</button>
          <button type="button" class="seg-btn" data-ar="0.5625">9:16</button>
        </div>
        <div class="grid-4" style="margin-top:0.85rem">
          <div class="field-group"><label>X</label><input type="number" id="cr-x" min="0" value="0" /></div>
          <div class="field-group"><label>Y</label><input type="number" id="cr-y" min="0" value="0" /></div>
          <div class="field-group"><label>Width</label><input type="number" id="cr-w" min="10" value="${img.naturalWidth}" /></div>
          <div class="field-group"><label>Height</label><input type="number" id="cr-h" min="10" value="${img.naturalHeight}" /></div>
        </div>
        <p class="field-hint">Drag directly on the image preview to draw your crop box, or fine-tune exact pixels above.</p>
        <button type="button" id="cr-apply" class="btn btn-primary">Apply Crop</button>
        <button type="button" id="cr-reset" class="btn btn-secondary">Reset</button>
      </div>
    `);

    const canvas = wsEl.querySelector('#ph-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    let crop = {
      x: Math.round(img.naturalWidth * 0.1),
      y: Math.round(img.naturalHeight * 0.1),
      w: Math.round(img.naturalWidth * 0.8),
      h: Math.round(img.naturalHeight * 0.8),
    };
    let aspect = 0;
    let isCroppedApplied = false;

    function syncInputs() {
      wsEl.querySelector('#cr-x').value = Math.round(crop.x);
      wsEl.querySelector('#cr-y').value = Math.round(crop.y);
      wsEl.querySelector('#cr-w').value = Math.round(crop.w);
      wsEl.querySelector('#cr-h').value = Math.round(crop.h);
      wsEl.querySelector('#ph-dim-info').textContent = `Crop: ${Math.round(crop.w)} × ${Math.round(crop.h)} px`;
    }

    function drawOverlay() {
      if (isCroppedApplied) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, crop.x, crop.y, crop.w, crop.h);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = Math.max(3, Math.round(canvas.width / 300));
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      syncInputs();
    }

    wsEl.querySelectorAll('[data-ar]').forEach((b) => {
      b.addEventListener('click', () => {
        isCroppedApplied = false;
        aspect = parseFloat(b.dataset.ar);
        wsEl.querySelectorAll('[data-ar]').forEach((x) => x.classList.toggle('active', x === b));
        if (aspect > 0) {
          const nw = Math.min(img.naturalWidth * 0.8, img.naturalHeight * 0.8 * aspect);
          const nh = nw / aspect;
          crop = {
            x: Math.round((img.naturalWidth - nw) / 2),
            y: Math.round((img.naturalHeight - nh) / 2),
            w: Math.round(nw),
            h: Math.round(nh),
          };
        }
        drawOverlay();
      });
    });

    let dragStart = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (isCroppedApplied) return;
      const rect = canvas.getBoundingClientRect();
      dragStart = {
        x: ((e.clientX - rect.left) * canvas.width) / rect.width,
        y: ((e.clientY - rect.top) * canvas.height) / rect.height,
      };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragStart || isCroppedApplied) return;
      const rect = canvas.getBoundingClientRect();
      const cx = Math.max(0, Math.min(canvas.width, ((e.clientX - rect.left) * canvas.width) / rect.width));
      const cy = Math.max(0, Math.min(canvas.height, ((e.clientY - rect.top) * canvas.height) / rect.height));
      let x = Math.min(dragStart.x, cx);
      let y = Math.min(dragStart.y, cy);
      let w = Math.max(16, Math.abs(cx - dragStart.x));
      let h = Math.max(16, Math.abs(cy - dragStart.y));
      if (aspect > 0) {
        h = w / aspect;
        if (y + h > canvas.height) {
          h = canvas.height - y;
          w = h * aspect;
        }
      }
      crop = { x, y, w, h };
      drawOverlay();
    });
    window.addEventListener('pointerup', () => (dragStart = null));

    ['#cr-x', '#cr-y', '#cr-w', '#cr-h'].forEach((id) => {
      wsEl.querySelector(id).addEventListener('input', () => {
        isCroppedApplied = false;
        crop.x = Math.max(0, parseInt(wsEl.querySelector('#cr-x').value, 10) || 0);
        crop.y = Math.max(0, parseInt(wsEl.querySelector('#cr-y').value, 10) || 0);
        crop.w = Math.max(10, Math.min(img.naturalWidth - crop.x, parseInt(wsEl.querySelector('#cr-w').value, 10) || 10));
        crop.h = Math.max(10, Math.min(img.naturalHeight - crop.y, parseInt(wsEl.querySelector('#cr-h').value, 10) || 10));
        drawOverlay();
      });
    });

    function bakeCrop() {
      const out = document.createElement('canvas');
      out.width = Math.round(crop.w);
      out.height = Math.round(crop.h);
      out.getContext('2d').drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
      return out;
    }

    wsEl.querySelector('#cr-apply').addEventListener('click', () => {
      isCroppedApplied = true;
      const out = bakeCrop();
      canvas.width = out.width;
      canvas.height = out.height;
      ctx.drawImage(out, 0, 0);
      wsEl.querySelector('#ph-dim-info').textContent = `${out.width} × ${out.height} px (Cropped)`;
      showToast('Crop applied! Ready to download.', 'success');
    });

    wsEl.querySelector('#cr-reset').addEventListener('click', () => {
      isCroppedApplied = false;
      crop = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
      drawOverlay();
    });

    drawOverlay();
    wireStandardDownloads(wsEl, () => (isCroppedApplied ? canvas : bakeCrop()), baseName + '-cropped', tool);
    return;
  }

  // 4. Image Resizer & HD Image Converter
  if (mode === 'resizer' || mode === 'hd-converter') {
    const isHd = mode === 'hd-converter';
    buildLayout(`
      <div class="panel-section">
        <h3 class="section-subtitle">${isHd ? 'HD Upscale &amp; Format' : 'Dimensions &amp; Scale'}</h3>
        ${
          isHd
            ? `
          <div class="segmented-tabs" style="margin-bottom:0.85rem">
            <button type="button" class="seg-btn active" data-scale="2">2× HD</button>
            <button type="button" class="seg-btn" data-scale="3">3× Ultra HD</button>
            <button type="button" class="seg-btn" data-scale="1.5">1.5× Crisp</button>
          </div>
          <label class="checkbox-row"><input type="checkbox" id="hd-sharpen" checked /><span>Apply edge crispness sharpening pass</span></label>
        `
            : `
          <div class="grid-2">
            <div class="field-group"><label for="rs-w">Width (px)</label><input type="number" id="rs-w" min="1" max="10000" value="${img.naturalWidth}" /></div>
            <div class="field-group"><label for="rs-h">Height (px)</label><input type="number" id="rs-h" min="1" max="10000" value="${img.naturalHeight}" /></div>
          </div>
          <label class="checkbox-row"><input type="checkbox" id="rs-lock" checked /><span>Lock aspect ratio</span></label>
          <div class="btn-row" style="margin-top:0.75rem">
            <button type="button" class="btn btn-secondary btn-xs rs-pre" data-w="1080" data-h="1080">Instagram 1080×1080</button>
            <button type="button" class="btn btn-secondary btn-xs rs-pre" data-w="1280" data-h="720">YouTube 1280×720</button>
            <button type="button" class="btn btn-secondary btn-xs rs-pre" data-w="512" data-h="512">Icon 512×512</button>
          </div>
        `
        }
      </div>
    `);

    const canvas = wsEl.querySelector('#ph-canvas');
    const ctx = canvas.getContext('2d');
    const ratio = img.naturalWidth / img.naturalHeight;
    let targetW = isHd ? Math.min(6000, img.naturalWidth * 2) : img.naturalWidth;
    let targetH = isHd ? Math.min(6000, img.naturalHeight * 2) : img.naturalHeight;

    async function renderResize() {
      canvas.width = targetW;
      canvas.height = targetH;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetW, targetH);

      if (isHd && wsEl.querySelector('#hd-sharpen')?.checked) {
        const data = ctx.getImageData(0, 0, targetW, targetH);
        const out = await runImageWorker('applyFilter', data, { filter: 'sharpen', intensity: 32 });
        ctx.putImageData(out, 0, 0);
      }
      wsEl.querySelector('#ph-dim-info').textContent = `${targetW} × ${targetH} px`;
      const b = await canvasToBlob(canvas, 'image/png');
      wsEl.querySelector('#ph-size-info').textContent = `Output ~${formatBytes(b.size)}`;
    }

    if (isHd) {
      wsEl.querySelectorAll('[data-scale]').forEach((b) => {
        b.addEventListener('click', () => {
          wsEl.querySelectorAll('[data-scale]').forEach((x) => x.classList.toggle('active', x === b));
          const mult = parseFloat(b.dataset.scale);
          targetW = Math.min(6000, Math.round(img.naturalWidth * mult));
          targetH = Math.min(6000, Math.round(img.naturalHeight * mult));
          renderResize();
        });
      });
      wsEl.querySelector('#hd-sharpen').addEventListener('change', renderResize);
    } else {
      const wIn = wsEl.querySelector('#rs-w');
      const hIn = wsEl.querySelector('#rs-h');
      const lock = wsEl.querySelector('#rs-lock');
      wIn.addEventListener('input', () => {
        targetW = Math.max(1, parseInt(wIn.value, 10) || 1);
        if (lock.checked) {
          targetH = Math.max(1, Math.round(targetW / ratio));
          hIn.value = targetH;
        }
        renderResize();
      });
      hIn.addEventListener('input', () => {
        targetH = Math.max(1, parseInt(hIn.value, 10) || 1);
        if (lock.checked) {
          targetW = Math.max(1, Math.round(targetH * ratio));
          wIn.value = targetW;
        }
        renderResize();
      });
      wsEl.querySelectorAll('.rs-pre').forEach((b) => {
        b.addEventListener('click', () => {
          lock.checked = false;
          targetW = parseInt(b.dataset.w, 10);
          targetH = parseInt(b.dataset.h, 10);
          wIn.value = targetW;
          hIn.value = targetH;
          renderResize();
        });
      });
    }

    renderResize();
    wireStandardDownloads(wsEl, canvas, baseName + (isHd ? '-hd' : '-resized'), tool);
    return;
  }

  // 5. Image Compressor
  if (mode === 'compressor') {
    buildLayout(`
      <div class="panel-section">
        <h3 class="section-subtitle">Compression Settings</h3>
        <div class="field-group">
          <label for="cmp-fmt">Compressed Format</label>
          <select id="cmp-fmt">
            <option value="image/jpeg" selected>JPG (Universal)</option>
            <option value="image/webp">WEBP (Smallest Size)</option>
          </select>
        </div>
        <div class="field-group">
          <label for="cmp-q">Quality (<span id="cmp-q-v" class="tabular-nums">75</span>%)</label>
          <input type="range" id="cmp-q" min="10" max="100" value="75" />
        </div>
        <div class="field-group">
          <label for="cmp-kb">Or Auto-Target Max KB (0 = manual quality)</label>
          <div class="input-action-row">
            <input type="number" id="cmp-kb" min="0" value="0" placeholder="e.g. 150" />
            <button type="button" id="cmp-auto-kb" class="btn btn-secondary btn-sm">Optimize to KB</button>
          </div>
        </div>
        <div id="cmp-stats" class="info-box"></div>
      </div>
    `);

    const canvas = wsEl.querySelector('#ph-canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    let lastBlob = null;

    async function updateCompression() {
      const mime = wsEl.querySelector('#cmp-fmt').value;
      const q = parseInt(wsEl.querySelector('#cmp-q').value, 10) / 100;
      wsEl.querySelector('#cmp-q-v').textContent = Math.round(q * 100);
      lastBlob = await canvasToBlob(canvas, mime, q);
      const saved = Math.round((1 - lastBlob.size / file.size) * 100);
      wsEl.querySelector('#ph-size-info').textContent = `${formatBytes(file.size)} → ${formatBytes(lastBlob.size)}`;
      wsEl.querySelector('#cmp-stats').innerHTML = `<strong>Compressed Size:</strong> ${formatBytes(lastBlob.size)} (${saved >= 0 ? saved + '% smaller' : Math.abs(saved) + '% larger'})`;
    }

    wsEl.querySelector('#cmp-auto-kb').addEventListener('click', async () => {
      const targetKb = parseInt(wsEl.querySelector('#cmp-kb').value, 10);
      if (!targetKb || targetKb < 5) return showToast('Enter a target size >= 5 KB.', 'error');
      const mime = wsEl.querySelector('#cmp-fmt').value;
      let lo = 0.08, hi = 0.98, bestQ = 0.5;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const b = await canvasToBlob(canvas, mime, mid);
        if (b.size <= targetKb * 1024) {
          bestQ = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      wsEl.querySelector('#cmp-q').value = Math.round(bestQ * 100);
      updateCompression();
      showToast(`Optimized to ~${targetKb} KB`, 'success');
    });

    wsEl.querySelector('#cmp-fmt').addEventListener('change', updateCompression);
    wsEl.querySelector('#cmp-q').addEventListener('input', updateCompression);

    // Override download buttons to serve exact compressed blob
    wsEl.querySelector('#ph-dl-row').innerHTML = `
      <button type="button" id="cmp-dl-btn" class="btn btn-primary">Download Compressed Image</button>
    `;
    wsEl.querySelector('#cmp-dl-btn').addEventListener('click', () => {
      if (!lastBlob) return;
      const ext = wsEl.querySelector('#cmp-fmt').value === 'image/webp' ? 'webp' : 'jpg';
      triggerDownload(lastBlob, `${baseName}-compressed.${ext}`, { toolName: tool.name, toolId: tool.id });
    });

    updateCompression();
    return;
  }

  // 6. Photo Enhancer & 7. Image Blur and Filters
  if (mode === 'enhancer' || mode === 'filters') {
    const isEnhancer = mode === 'enhancer';
    buildLayout(
      isEnhancer
        ? `
        <div class="panel-section">
          <h3 class="section-subtitle">Auto-Enhance Controls</h3>
          <div class="field-group"><label>Auto-Levels Contrast (<span id="en-str-v" class="tabular-nums">65</span>%)</label><input type="range" id="en-str" min="0" max="100" value="65" /></div>
          <div class="field-group"><label>Edge Sharpness (<span id="en-sh-v" class="tabular-nums">45</span>%)</label><input type="range" id="en-sh" min="0" max="100" value="45" /></div>
          <div class="field-group"><label>Color Vibrance (<span id="en-vib-v" class="tabular-nums">35</span>%)</label><input type="range" id="en-vib" min="0" max="100" value="35" /></div>
          <button type="button" id="en-apply" class="btn btn-primary">Enhance Photo</button>
          <button type="button" id="en-orig" class="btn btn-secondary">Reset Original</button>
        </div>
      `
        : `
        <div class="panel-section">
          <h3 class="section-subtitle">Blur &amp; Creative Filters</h3>
          <div class="field-group">
            <label for="fl-type">Filter Effect</label>
            <select id="fl-type">
              <option value="blur" selected>Gaussian Blur</option>
              <option value="pixelate">Pixelate / Censor Mosaic</option>
              <option value="sharpen">Crisp Sharpen</option>
              <option value="sepia">Warm Sepia</option>
              <option value="grayscale">Black &amp; White</option>
              <option value="noir">High-Contrast Noir</option>
              <option value="vintage">Retro Vintage</option>
              <option value="cool">Cool Tone</option>
              <option value="warm">Golden Warm</option>
              <option value="emboss">3D Emboss</option>
              <option value="invert">Invert Colors</option>
            </select>
          </div>
          <div class="field-group">
            <label for="fl-int">Intensity (<span id="fl-int-v" class="tabular-nums">55</span>%)</label>
            <input type="range" id="fl-int" min="5" max="100" value="55" />
          </div>
          <button type="button" id="fl-apply" class="btn btn-primary">Apply Filter</button>
          <button type="button" id="fl-reset" class="btn btn-secondary">Reset Original</button>
        </div>
      `
    );

    const canvas = wsEl.querySelector('#ph-canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const maxDim = 1800;
    const sc = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.round(img.naturalWidth * sc);
    canvas.height = Math.round(img.naturalHeight * sc);

    const origCanvas = document.createElement('canvas');
    origCanvas.width = canvas.width;
    origCanvas.height = canvas.height;
    origCanvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

    async function processWorker() {
      const origData = origCanvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      progress.start('Processing pixels in Web Worker...');
      let out;
      if (isEnhancer) {
        const strength = parseInt(wsEl.querySelector('#en-str').value, 10);
        const sharpness = parseInt(wsEl.querySelector('#en-sh').value, 10);
        const vibrance = parseInt(wsEl.querySelector('#en-vib').value, 10);
        out = await runImageWorker('enhancePhoto', origData, { strength, sharpness, vibrance }, (p) => progress.update(p));
      } else {
        const filter = wsEl.querySelector('#fl-type').value;
        const intensity = parseInt(wsEl.querySelector('#fl-int').value, 10);
        out = await runImageWorker('applyFilter', origData, { filter, intensity }, (p) => progress.update(p));
      }
      ctx.putImageData(out, 0, 0);
      progress.finish('Done');
    }

    if (isEnhancer) {
      wsEl.querySelector('#en-str').addEventListener('input', (e) => (wsEl.querySelector('#en-str-v').textContent = e.target.value));
      wsEl.querySelector('#en-sh').addEventListener('input', (e) => (wsEl.querySelector('#en-sh-v').textContent = e.target.value));
      wsEl.querySelector('#en-vib').addEventListener('input', (e) => (wsEl.querySelector('#en-vib-v').textContent = e.target.value));
      wsEl.querySelector('#en-apply').addEventListener('click', processWorker);
      wsEl.querySelector('#en-orig').addEventListener('click', () => ctx.drawImage(origCanvas, 0, 0));
    } else {
      wsEl.querySelector('#fl-int').addEventListener('input', (e) => (wsEl.querySelector('#fl-int-v').textContent = e.target.value));
      wsEl.querySelector('#fl-apply').addEventListener('click', processWorker);
      wsEl.querySelector('#fl-type').addEventListener('change', processWorker);
      wsEl.querySelector('#fl-reset').addEventListener('click', () => ctx.drawImage(origCanvas, 0, 0));
    }

    processWorker();
    wireStandardDownloads(wsEl, canvas, baseName + (isEnhancer ? '-enhanced' : '-filtered'), tool);
    return;
  }

  // 8. Passport Size Photo Maker (Single + Printable 4x6 / A4 Sheet + PDF)
  if (mode === 'passport') {
    const PASSPORT_PRESETS = {
      us: { label: 'US Passport (2×2 in · 600×600 px)', w: 600, h: 600 },
      in: { label: 'India / UK / EU (35×45 mm · 413×531 px)', w: 413, h: 531 },
      visa: { label: 'Schengen / Japan Visa (35×45 mm)', w: 413, h: 531 },
      pan: { label: 'PAN / ID Stamp (25×35 mm · 295×413 px)', w: 295, h: 413 },
    };

    buildLayout(`
      <div class="panel-section">
        <h3 class="section-subtitle">Passport Size &amp; Alignment</h3>
        <div class="field-group">
          <label for="pp-preset">Country / Size Standard (300 DPI)</label>
          <select id="pp-preset">
            ${Object.entries(PASSPORT_PRESETS)
              .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`)
              .join('')}
          </select>
        </div>
        <div class="field-group">
          <label for="pp-zoom">Zoom (<span id="pp-zoom-v" class="tabular-nums">100</span>%)</label>
          <input type="range" id="pp-zoom" min="50" max="250" value="100" />
        </div>
        <div class="grid-2">
          <div class="field-group"><label>Pan X (<span id="pp-x-v" class="tabular-nums">0</span>)</label><input type="range" id="pp-x" min="-200" max="200" value="0" /></div>
          <div class="field-group"><label>Pan Y (<span id="pp-y-v" class="tabular-nums">0</span>)</label><input type="range" id="pp-y" min="-200" max="200" value="0" /></div>
        </div>
        <div class="grid-2">
          <div class="field-group"><label for="pp-bg">Backdrop Color</label><input type="color" id="pp-bg" value="#ffffff" /></div>
          <div class="field-group">
            <label for="pp-sheet">Print Sheet Layout</label>
            <select id="pp-sheet">
              <option value="single">Single Photo</option>
              <option value="4x6" selected>4×6 inch Print Sheet (6 Photos)</option>
              <option value="a4">A4 Print Sheet (12 Photos)</option>
            </select>
          </div>
        </div>
      </div>
    `);

    const canvas = wsEl.querySelector('#ph-canvas');
    const ctx = canvas.getContext('2d');

    function renderSinglePassport() {
      const p = PASSPORT_PRESETS[wsEl.querySelector('#pp-preset').value];
      const zoom = parseInt(wsEl.querySelector('#pp-zoom').value, 10) / 100;
      const ox = parseInt(wsEl.querySelector('#pp-x').value, 10);
      const oy = parseInt(wsEl.querySelector('#pp-y').value, 10);
      const bg = wsEl.querySelector('#pp-bg').value;

      wsEl.querySelector('#pp-zoom-v').textContent = Math.round(zoom * 100);
      wsEl.querySelector('#pp-x-v').textContent = ox;
      wsEl.querySelector('#pp-y-v').textContent = oy;

      const c = document.createElement('canvas');
      c.width = p.w;
      c.height = p.h;
      const cctx = c.getContext('2d');
      cctx.fillStyle = bg;
      cctx.fillRect(0, 0, p.w, p.h);

      const baseScale = Math.max(p.w / img.naturalWidth, p.h / img.naturalHeight) * zoom;
      const dw = img.naturalWidth * baseScale;
      const dh = img.naturalHeight * baseScale;
      cctx.drawImage(img, (p.w - dw) / 2 + ox, (p.h - dh) / 2 + oy, dw, dh);
      return c;
    }

    function renderPassportPreview() {
      const single = renderSinglePassport();
      const sheet = wsEl.querySelector('#pp-sheet').value;

      if (sheet === 'single') {
        canvas.width = single.width;
        canvas.height = single.height;
        ctx.drawImage(single, 0, 0);
      } else {
        const is4x6 = sheet === '4x6';
        // 300 DPI printable sheet dimensions
        const sw = is4x6 ? 1800 : 2480;
        const sh = is4x6 ? 1200 : 3508;
        const cols = is4x6 ? 3 : 4;
        const rows = is4x6 ? 2 : 3;
        canvas.width = sw;
        canvas.height = sh;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sw, sh);

        const gap = 36;
        const totalW = cols * single.width + (cols - 1) * gap;
        const totalH = rows * single.height + (rows - 1) * gap;
        const startX = Math.round((sw - totalW) / 2);
        const startY = Math.round((sh - totalH) / 2);

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = startX + c * (single.width + gap);
            const y = startY + r * (single.height + gap);
            ctx.drawImage(single, x, y);
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, single.width, single.height);
          }
        }
      }
      wsEl.querySelector('#ph-dim-info').textContent = `${canvas.width} × ${canvas.height} px (300 DPI)`;
    }

    ['#pp-preset', '#pp-zoom', '#pp-x', '#pp-y', '#pp-bg', '#pp-sheet'].forEach((id) => {
      wsEl.querySelector(id).addEventListener('input', renderPassportPreview);
      wsEl.querySelector(id).addEventListener('change', renderPassportPreview);
    });

    wsEl.querySelector('#ph-dl-row').innerHTML = `
      <button type="button" id="pp-dl-jpg" class="btn btn-primary">Download Print JPG</button>
      <button type="button" id="pp-dl-png" class="btn btn-secondary">Download PNG</button>
      <button type="button" id="pp-dl-pdf" class="btn btn-secondary">Download Printable PDF</button>
    `;
    wsEl.querySelector('#pp-dl-jpg').addEventListener('click', async () => {
      const b = await canvasToBlob(canvas, 'image/jpeg', 0.95);
      triggerDownload(b, `${baseName}-passport.jpg`, { toolName: tool.name, toolId: tool.id });
    });
    wsEl.querySelector('#pp-dl-png').addEventListener('click', async () => {
      const b = await canvasToBlob(canvas, 'image/png');
      triggerDownload(b, `${baseName}-passport.png`, { toolName: tool.name, toolId: tool.id });
    });
    wsEl.querySelector('#pp-dl-pdf').addEventListener('click', () => {
      const sheet = wsEl.querySelector('#pp-sheet').value;
      const pdf = new jsPDF({
        orientation: sheet === '4x6' ? 'landscape' : 'portrait',
        unit: 'mm',
        format: sheet === '4x6' ? [152.4, 101.6] : 'a4',
      });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      const sc = Math.min(pw / canvas.width, ph / canvas.height);
      const dw = canvas.width * sc;
      const dh = canvas.height * sc;
      pdf.addImage(dataUrl, 'JPEG', (pw - dw) / 2, (ph - dh) / 2, dw, dh);
      triggerDownload(pdf.output('blob'), `${baseName}-passport-sheet.pdf`, { toolName: tool.name, toolId: tool.id });
    });

    renderPassportPreview();
  }
}

function wireStandardDownloads(wsEl, canvasOrFn, outBase, tool) {
  const getCanvas = () => (typeof canvasOrFn === 'function' ? canvasOrFn() : canvasOrFn);
  wsEl.querySelector('#ph-dl-png')?.addEventListener('click', async () => {
    const b = await canvasToBlob(getCanvas(), 'image/png');
    triggerDownload(b, `${outBase}.png`, { toolName: tool.name, toolId: tool.id });
  });
  wsEl.querySelector('#ph-dl-jpg')?.addEventListener('click', async () => {
    const src = getCanvas();
    const tmp = document.createElement('canvas');
    tmp.width = src.width;
    tmp.height = src.height;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = '#ffffff';
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(src, 0, 0);
    const b = await canvasToBlob(tmp, 'image/jpeg', 0.92);
    triggerDownload(b, `${outBase}.jpg`, { toolName: tool.name, toolId: tool.id });
  });
  wsEl.querySelector('#ph-dl-webp')?.addEventListener('click', async () => {
    const b = await canvasToBlob(getCanvas(), 'image/webp', 0.92);
    triggerDownload(b, `${outBase}.webp`, { toolName: tool.name, toolId: tool.id });
  });
}
