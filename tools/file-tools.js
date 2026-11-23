import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  computeSha256,
  createDropzone,
  createProgressController,
  detectMagicFormat,
  escapeHtml,
  formatBytes,
  loadImageFromFile,
  showToast,
  triggerDownload,
  validateFile,
} from './utils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

function encodeAudioViaWorker(audioBuffer, format, kbps, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/audio-worker.js', import.meta.url), { type: 'module' });
    const channels = [];
    const transfers = [];
    const maxCh = Math.min(2, audioBuffer.numberOfChannels);
    for (let i = 0; i < maxCh; i++) {
      const copy = new Float32Array(audioBuffer.getChannelData(i));
      channels.push(copy.buffer);
      transfers.push(copy.buffer);
    }
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress?.(e.data.value);
      else if (e.data.type === 'done') {
        worker.terminate();
        resolve(new Blob([e.data.buffer], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' }));
      } else if (e.data.type === 'error') {
        worker.terminate();
        reject(new Error(e.data.message));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Audio worker failed'));
    };
    worker.postMessage({ format, channelBuffers: channels, sampleRate: audioBuffer.sampleRate, kbps }, transfers);
  });
}

export function renderFileTool(container, tool) {
  const mode = tool.mode;

  // TXT to PDF supports pasting text OR dropping .txt file
  if (mode === 'txt-to-pdf') {
    container.innerHTML = `
      <div class="tool-stack">
        <div id="ft-dropzone"></div>
        <div class="panel-section">
          <div class="grid-2">
            <div class="field-group">
              <label for="txt-title">Document Title</label>
              <input type="text" id="txt-title" value="FlyAI Document" />
            </div>
            <div class="field-group">
              <label for="txt-font-size">Font Size (pt)</label>
              <select id="txt-font-size">
                <option value="10">10 pt (Compact)</option>
                <option value="11" selected>11 pt (Standard)</option>
                <option value="13">13 pt (Readable)</option>
                <option value="16">16 pt (Large)</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label for="txt-content">Text Content (Edit or Upload .TXT)</label>
            <textarea id="txt-content" rows="10" placeholder="Type or paste plain text here..."></textarea>
          </div>
          <button type="button" id="txt-export-pdf" class="btn btn-primary">Convert to PDF</button>
        </div>
      </div>
    `;

    const contentEl = container.querySelector('#txt-content');
    const titleEl = container.querySelector('#txt-title');
    const sizeEl = container.querySelector('#txt-font-size');

    createDropzone(container.querySelector('#ft-dropzone'), {
      accept: '.txt,.md,.csv,.log,text/plain',
      title: 'Drop a .TXT, .MD, or .CSV file here',
      onFiles: async ([file]) => {
        const err = validateFile(file, { maxMB: 20 });
        if (err) return showToast(err, 'error');
        titleEl.value = file.name.replace(/\.[^.]+$/, '');
        contentEl.value = await file.text();
        showToast(`Loaded ${file.name}`, 'success');
      },
    });

    container.querySelector('#txt-export-pdf').addEventListener('click', () => {
      const text = contentEl.value;
      if (!text.trim()) return showToast('Enter or upload text content first.', 'error');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const margin = 16;
      const maxW = pdf.internal.pageSize.getWidth() - margin * 2;
      const pageH = pdf.internal.pageSize.getHeight();
      const pt = parseInt(sizeEl.value, 10) || 11;
      const lineH = pt * 0.48;
      let y = 20;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(pt + 3);
      pdf.text(titleEl.value.trim() || 'Document', margin, y);
      y += lineH + 4;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(pt);
      const lines = pdf.splitTextToSize(text, maxW);
      for (const line of lines) {
        if (y > pageH - 18) {
          pdf.addPage();
          y = 20;
        }
        pdf.text(line, margin, y);
        y += lineH;
      }
      const fname = (titleEl.value.trim() || 'document').replace(/[^\w.-]+/g, '_') + '.pdf';
      triggerDownload(pdf.output('blob'), fname, { toolName: tool.name, toolId: tool.id });
    });
    return;
  }

  // Standard file-based converters
  container.innerHTML = `
    <div class="tool-stack">
      <div id="ft-dropzone"></div>
      <div id="ft-progress"></div>
      <div id="ft-workspace" class="panel-section hidden"></div>
    </div>
  `;

  const dzEl = container.querySelector('#ft-dropzone');
  const wsEl = container.querySelector('#ft-workspace');
  const progress = createProgressController(container.querySelector('#ft-progress'));

  const dropCfg = {
    'jpg-to-png': { accept: 'image/jpeg,image/webp,image/*', multiple: true, title: 'Drop JPG image(s) to convert to PNG', sampleUrl: '/assets/sample-studio.jpg' },
    'png-to-jpg': { accept: 'image/png,image/*', multiple: true, title: 'Drop PNG image(s) to convert to JPG', sampleUrl: '/assets/sample-studio.jpg' },
    'webp-to-jpg': { accept: 'image/webp,image/*', multiple: true, title: 'Drop WEBP image(s) to convert to JPG', sampleUrl: '/assets/sample-studio.jpg' },
    'jpg-to-pdf': { accept: 'image/jpeg,image/png,image/webp', multiple: true, title: 'Drop one or more JPG/PNG images to merge into PDF', sampleUrl: '/assets/sample-studio.jpg' },
    'pdf-to-jpg': { accept: 'application/pdf,.pdf', multiple: false, title: 'Drop a PDF document to extract pages as JPG' },
    'pdf-to-png': { accept: 'application/pdf,.pdf', multiple: false, title: 'Drop a PDF document to extract pages as PNG' },
    'docx-to-pdf': { accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: false, title: 'Drop a .DOCX Word document to convert to PDF' },
    'mp4-to-mp3': { accept: 'video/mp4,video/*,.mp4,.webm,.mov', multiple: false, title: 'Drop an MP4/WebM video file to extract MP3 audio' },
    'wav-to-mp3': { accept: 'audio/wav,.wav,audio/*', multiple: false, title: 'Drop a WAV audio file to encode as MP3' },
    'mp3-to-wav': { accept: 'audio/mpeg,.mp3,audio/*', multiple: false, title: 'Drop an MP3 audio file to decode as PCM WAV' },
    'zip-extract': { accept: '.zip,application/zip,application/x-zip-compressed', multiple: false, title: 'Drop a .ZIP archive to browse & extract files' },
    'zip-compress': { accept: '*', multiple: true, title: 'Drop multiple files to compress into a .ZIP archive' },
    'detect': { accept: '*', multiple: false, title: 'Drop any file to inspect binary magic bytes, MIME & SHA-256' },
  }[mode] || { accept: '*', multiple: false, title: 'Drop file here' };

  createDropzone(dzEl, {
    ...dropCfg,
    onFiles: (files) => handleFiles(files),
  });

  async function handleFiles(files) {
    wsEl.classList.remove('hidden');
    wsEl.innerHTML = '';

    // 1. Image format conversions & JPG to PDF
    if (['jpg-to-png', 'png-to-jpg', 'webp-to-jpg', 'jpg-to-pdf'].includes(mode)) {
      const targetExt = mode === 'jpg-to-png' ? 'png' : mode === 'jpg-to-pdf' ? 'pdf' : 'jpg';
      const targetMime = targetExt === 'png' ? 'image/png' : 'image/jpeg';

      if (mode === 'jpg-to-pdf') {
        progress.start('Generating PDF from images...');
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        for (let i = 0; i < files.length; i++) {
          const err = validateFile(files[i], { maxMB: 50, acceptPrefixes: ['image/'] });
          if (err) { showToast(err, 'error'); continue; }
          const img = await loadImageFromFile(files[i]);
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          if (i > 0) pdf.addPage();
          const pw = pdf.internal.pageSize.getWidth() - 20;
          const ph = pdf.internal.pageSize.getHeight() - 20;
          const ratio = Math.min(pw / canvas.width, ph / canvas.height);
          const dw = canvas.width * ratio;
          const dh = canvas.height * ratio;
          pdf.addImage(dataUrl, 'JPEG', (pw + 20 - dw) / 2, (ph + 20 - dh) / 2, dw, dh);
          progress.update(((i + 1) / files.length) * 100);
        }
        progress.finish('PDF Ready');
        const blob = pdf.output('blob');
        wsEl.innerHTML = `
          <div class="flex-between">
            <div><strong>${files.length} image(s) merged into PDF</strong><div class="muted-text tabular-nums">${formatBytes(blob.size)}</div></div>
            <button type="button" id="ft-dl-pdf" class="btn btn-primary">Download PDF</button>
          </div>
        `;
        wsEl.querySelector('#ft-dl-pdf').addEventListener('click', () => {
          triggerDownload(blob, 'flyai-images.pdf', { toolName: tool.name, toolId: tool.id });
        });
        return;
      }

      progress.start('Converting images...');
      const outputs = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const err = validateFile(f, { maxMB: 50, acceptPrefixes: ['image/'] });
        if (err) { showToast(err, 'error'); continue; }
        const img = await loadImageFromFile(f);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (targetMime === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise((r) => canvas.toBlob(r, targetMime, 0.92));
        const outName = f.name.replace(/\.[^.]+$/, '') + '.' + targetExt;
        outputs.push({ name: outName, blob, origSize: f.size, w: canvas.width, h: canvas.height });
        progress.update(((i + 1) / files.length) * 100);
      }
      progress.finish('Conversion Complete');

      wsEl.innerHTML = `
        <div class="flex-between" style="margin-bottom:1rem">
          <strong>${outputs.length} Converted File(s)</strong>
          ${outputs.length > 1 ? `<button type="button" id="ft-dl-zip" class="btn btn-primary btn-sm">Download All (.ZIP)</button>` : ''}
        </div>
        <div class="file-result-list">
          ${outputs
            .map(
              (o, idx) => `
            <div class="file-result-row">
              <div>
                <strong>${escapeHtml(o.name)}</strong>
                <div class="muted-text tabular-nums">${o.w}×${o.h} · ${formatBytes(o.origSize)} → ${formatBytes(o.blob.size)}</div>
              </div>
              <button type="button" class="btn btn-primary btn-sm ft-dl-one" data-idx="${idx}">Download</button>
            </div>
          `
            )
            .join('')}
        </div>
      `;
      wsEl.querySelectorAll('.ft-dl-one').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = outputs[parseInt(btn.dataset.idx, 10)];
          triggerDownload(item.blob, item.name, { toolName: tool.name, toolId: tool.id });
        });
      });
      wsEl.querySelector('#ft-dl-zip')?.addEventListener('click', async () => {
        const zip = new JSZip();
        outputs.forEach((o) => zip.file(o.name, o.blob));
        const zblob = await zip.generateAsync({ type: 'blob' });
        triggerDownload(zblob, `flyai-converted-${targetExt}.zip`, { toolName: tool.name, toolId: tool.id });
      });
      return;
    }

    // 2. PDF to JPG / PDF to PNG
    if (mode === 'pdf-to-jpg' || mode === 'pdf-to-png') {
      const file = files[0];
      const err = validateFile(file, { maxMB: 80, acceptExts: ['pdf'] });
      if (err) return showToast(err, 'error');
      const isPng = mode === 'pdf-to-png';
      const ext = isPng ? 'png' : 'jpg';
      const mime = isPng ? 'image/png' : 'image/jpeg';

      progress.start('Loading PDF pages...');
      try {
        const buf = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
        const pageCount = pdfDoc.numPages;
        const rendered = [];

        for (let p = 1; p <= pageCount; p++) {
          const page = await pdfDoc.getPage(p);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport }).promise;
          const blob = await new Promise((r) => canvas.toBlob(r, mime, 0.92));
          rendered.push({
            page: p,
            name: `${file.name.replace(/\.pdf$/i, '')}-page-${p}.${ext}`,
            blob,
            url: URL.createObjectURL(blob),
          });
          progress.update((p / pageCount) * 100, `Rendered page ${p} of ${pageCount}`);
        }
        progress.finish(`Rendered ${pageCount} page(s)`);

        wsEl.innerHTML = `
          <div class="flex-between" style="margin-bottom:1rem">
            <strong>${escapeHtml(file.name)} (${pageCount} pages)</strong>
            <button type="button" id="pdf-dl-zip" class="btn btn-primary btn-sm">Download All as ZIP</button>
          </div>
          <div class="thumb-grid">
            ${rendered
              .map(
                (r, idx) => `
              <div class="thumb-card">
                <img src="${r.url}" alt="Page ${r.page}" />
                <div class="thumb-meta">
                  <span class="tabular-nums">Page ${r.page} · ${formatBytes(r.blob.size)}</span>
                  <button type="button" class="btn btn-secondary btn-xs pdf-dl-page" data-idx="${idx}">Save ${ext.toUpperCase()}</button>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        `;
        wsEl.querySelectorAll('.pdf-dl-page').forEach((b) => {
          b.addEventListener('click', () => {
            const item = rendered[parseInt(b.dataset.idx, 10)];
            triggerDownload(item.blob, item.name, { toolName: tool.name, toolId: tool.id });
          });
        });
        wsEl.querySelector('#pdf-dl-zip').addEventListener('click', async () => {
          const zip = new JSZip();
          rendered.forEach((r) => zip.file(r.name, r.blob));
          const zblob = await zip.generateAsync({ type: 'blob' });
          triggerDownload(zblob, `${file.name.replace(/\.pdf$/i, '')}-${ext}.zip`, { toolName: tool.name, toolId: tool.id });
        });
      } catch (e) {
        progress.hide();
        wsEl.innerHTML = `<div class="error-banner">Could not read PDF: ${escapeHtml(e.message)}</div>`;
      }
      return;
    }

    // 3. DOCX to PDF
    if (mode === 'docx-to-pdf') {
      const file = files[0];
      const err = validateFile(file, { maxMB: 35, acceptExts: ['docx'] });
      if (err) return showToast(err, 'error');
      progress.start('Parsing DOCX structure...');
      try {
        const buf = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        const text = result.value || '';
        progress.update(65, 'Building PDF pages...');
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const margin = 16;
        const maxW = pdf.internal.pageSize.getWidth() - margin * 2;
        const pageH = pdf.internal.pageSize.getHeight();
        let y = 20;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(11);
        const lines = pdf.splitTextToSize(text || '(Empty DOCX document)', maxW);
        for (const line of lines) {
          if (y > pageH - 18) {
            pdf.addPage();
            y = 20;
          }
          pdf.text(line, margin, y);
          y += 5.5;
        }
        const outBlob = pdf.output('blob');
        const outName = file.name.replace(/\.docx$/i, '') + '.pdf';
        progress.finish('DOCX Converted');
        wsEl.innerHTML = `
          <div class="flex-between">
            <div>
              <strong>${escapeHtml(outName)}</strong>
              <div class="muted-text tabular-nums">${lines.length} wrapped lines · ${formatBytes(outBlob.size)}</div>
            </div>
            <button type="button" id="docx-dl-btn" class="btn btn-primary">Download PDF</button>
          </div>
          <pre class="code-preview">${escapeHtml(text.slice(0, 1200))}${text.length > 1200 ? '\n...' : ''}</pre>
        `;
        wsEl.querySelector('#docx-dl-btn').addEventListener('click', () => {
          triggerDownload(outBlob, outName, { toolName: tool.name, toolId: tool.id });
        });
      } catch (e) {
        progress.hide();
        wsEl.innerHTML = `<div class="error-banner">Failed to parse DOCX: ${escapeHtml(e.message)}</div>`;
      }
      return;
    }

    // 4. Audio/Video to MP3 / WAV
    if (['mp4-to-mp3', 'wav-to-mp3', 'mp3-to-wav'].includes(mode)) {
      const file = files[0];
      const err = validateFile(file, { maxMB: 250 });
      if (err) return showToast(err, 'error');
      const targetFmt = mode === 'mp3-to-wav' ? 'wav' : 'mp3';
      progress.start('Decoding audio stream in browser...');
      try {
        const buf = await file.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await audioCtx.decodeAudioData(buf.slice(0));
        await audioCtx.close();

        progress.update(25, `Encoding ${targetFmt.toUpperCase()} via Web Worker...`);
        const outBlob = await encodeAudioViaWorker(decoded, targetFmt, 192, (p) => {
          progress.update(25 + p * 0.75, `Encoding ${targetFmt.toUpperCase()}...`);
        });
        progress.finish('Audio Ready');
        const outName = file.name.replace(/\.[^.]+$/, '') + '.' + targetFmt;
        const audioUrl = URL.createObjectURL(outBlob);
        wsEl.innerHTML = `
          <div class="flex-between" style="margin-bottom:0.75rem">
            <div>
              <strong>${escapeHtml(outName)}</strong>
              <div class="muted-text tabular-nums">${decoded.sampleRate} Hz · ${decoded.numberOfChannels}ch · ${formatBytes(file.size)} → ${formatBytes(outBlob.size)}</div>
            </div>
            <button type="button" id="aud-dl-btn" class="btn btn-primary">Download ${targetFmt.toUpperCase()}</button>
          </div>
          <audio src="${audioUrl}" controls class="w-full"></audio>
        `;
        wsEl.querySelector('#aud-dl-btn').addEventListener('click', () => {
          triggerDownload(outBlob, outName, { toolName: tool.name, toolId: tool.id });
        });
      } catch (e) {
        progress.hide();
        wsEl.innerHTML = `<div class="error-banner">Audio decoding failed: ${escapeHtml(e.message || 'File may have no audio track or unsupported codec.')}</div>`;
      }
      return;
    }

    // 5. ZIP Extractor
    if (mode === 'zip-extract') {
      const file = files[0];
      const err = validateFile(file, { maxMB: 150, acceptExts: ['zip'] });
      if (err) return showToast(err, 'error');
      progress.start('Reading ZIP archive...');
      try {
        const zip = await JSZip.loadAsync(file);
        const entries = Object.values(zip.files).filter((e) => !e.dir);
        progress.finish(`Found ${entries.length} file(s)`);
        wsEl.innerHTML = `
          <div class="flex-between" style="margin-bottom:1rem">
            <strong>${escapeHtml(file.name)} (${entries.length} files)</strong>
          </div>
          <div class="file-result-list">
            ${entries
              .map(
                (entry, idx) => `
              <div class="file-result-row">
                <div>
                  <strong>${escapeHtml(entry.name)}</strong>
                  <div class="muted-text tabular-nums">${formatBytes(entry._data?.uncompressedSize || 0)}</div>
                </div>
                <button type="button" class="btn btn-primary btn-sm zip-extract-one" data-idx="${idx}">Extract</button>
              </div>
            `
              )
              .join('')}
          </div>
        `;
        wsEl.querySelectorAll('.zip-extract-one').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const entry = entries[parseInt(btn.dataset.idx, 10)];
            const blob = await entry.async('blob');
            const cleanName = entry.name.split('/').pop() || 'extracted-file';
            triggerDownload(blob, cleanName, { toolName: tool.name, toolId: tool.id });
          });
        });
      } catch (e) {
        progress.hide();
        wsEl.innerHTML = `<div class="error-banner">Invalid ZIP archive: ${escapeHtml(e.message)}</div>`;
      }
      return;
    }

    // 6. File Compressor (Create ZIP)
    if (mode === 'zip-compress') {
      const totalOrig = files.reduce((s, f) => s + f.size, 0);
      progress.start('Compressing files into ZIP...');
      const zip = new JSZip();
      files.forEach((f) => zip.file(f.name, f));
      const zblob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 7 } },
        (meta) => progress.update(meta.percent, `Compressing... ${Math.round(meta.percent)}%`)
      );
      progress.finish('ZIP Ready');
      const savedPct = totalOrig > 0 ? Math.max(0, Math.round((1 - zblob.size / totalOrig) * 100)) : 0;
      wsEl.innerHTML = `
        <div class="flex-between">
          <div>
            <strong>flyai-archive.zip (${files.length} file(s))</strong>
            <div class="muted-text tabular-nums">${formatBytes(totalOrig)} → ${formatBytes(zblob.size)} (${savedPct}% smaller)</div>
          </div>
          <button type="button" id="zip-dl-btn" class="btn btn-primary">Download ZIP</button>
        </div>
      `;
      wsEl.querySelector('#zip-dl-btn').addEventListener('click', () => {
        triggerDownload(zblob, 'flyai-archive.zip', { toolName: tool.name, toolId: tool.id });
      });
      return;
    }

    // 7. File Format Detector
    if (mode === 'detect') {
      const file = files[0];
      const err = validateFile(file, { maxMB: 300 });
      if (err) return showToast(err, 'error');
      progress.start('Inspecting binary header & SHA-256...');
      const info = await detectMagicFormat(file);
      const sha256 = await computeSha256(file);
      progress.finish('Analysis Complete');
      wsEl.innerHTML = `
        <div class="meta-grid">
          <div class="meta-item"><span class="meta-k">File Name</span><span class="meta-v">${escapeHtml(file.name)}</span></div>
          <div class="meta-item"><span class="meta-k">Size</span><span class="meta-v tabular-nums">${escapeHtml(formatBytes(file.size))} (${file.size.toLocaleString()} bytes)</span></div>
          <div class="meta-item"><span class="meta-k">Detected Format</span><span class="meta-v">${escapeHtml(info.detected)}</span></div>
          <div class="meta-item"><span class="meta-k">Magic MIME / Ext</span><span class="meta-v">${escapeHtml(info.mime)} (.${escapeHtml(info.ext)})</span></div>
          <div class="meta-item"><span class="meta-k">Header Hex (16B)</span><span class="meta-v mono-tag">${escapeHtml(info.hex)}</span></div>
          <div class="meta-item"><span class="meta-k">ASCII Signature</span><span class="meta-v mono-tag">${escapeHtml(info.ascii)}</span></div>
        </div>
        <div class="field-group" style="margin-top:1rem">
          <label>SHA-256 Checksum</label>
          <input type="text" readonly value="${escapeHtml(sha256)}" class="input-mono" />
        </div>
      `;
    }
  }
}
