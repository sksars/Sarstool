import JSZip from 'jszip';
import {
  createDropzone,
  createProgressController,
  detectMagicFormat,
  escapeHtml,
  formatBytes,
  formatDuration,
  showToast,
  triggerDownload,
  validateFile,
} from './utils.js';

function encodeAudioWorker(channels, sampleRate, format, kbps, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/audio-worker.js', import.meta.url), { type: 'module' });
    const buffers = channels.map((c) => c.buffer);
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
      reject(new Error(err.message || 'Audio worker error'));
    };
    worker.postMessage({ format, channelBuffers: buffers, sampleRate, kbps }, buffers);
  });
}

function drawWaveform(canvas, audioBuffer, startSec, endSec) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  const data = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / w));
  const mid = h / 2;

  const startX = (startSec / audioBuffer.duration) * w;
  const endX = (endSec / audioBuffer.duration) * w;

  ctx.fillStyle = 'rgba(37, 99, 235, 0.25)';
  ctx.fillRect(startX, 0, Math.max(2, endX - startX), h);

  for (let x = 0; x < w; x++) {
    let min = 1.0;
    let max = -1.0;
    const base = x * step;
    for (let j = 0; j < step && base + j < data.length; j++) {
      const v = data[base + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const inSel = x >= startX && x <= endX;
    ctx.fillStyle = inSel ? '#60a5fa' : '#475569';
    const y1 = (1 + min) * mid;
    const y2 = (1 + max) * mid;
    ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}

export function renderMediaTool(container, tool) {
  const mode = tool.mode;
  const isAudioOnly = ['audio-convert', 'audio-cutter', 'audio-trimmer'].includes(mode);

  container.innerHTML = `
    <div class="tool-stack">
      <div id="md-dropzone"></div>
      <div id="md-progress"></div>
      <div id="md-workspace" class="panel-section hidden"></div>
    </div>
  `;

  const dzEl = container.querySelector('#md-dropzone');
  const wsEl = container.querySelector('#md-workspace');
  const progress = createProgressController(container.querySelector('#md-progress'));

  createDropzone(dzEl, {
    accept: isAudioOnly ? 'audio/*' : mode === 'metadata' ? 'video/*,audio/*' : 'video/*',
    title: isAudioOnly
      ? 'Drop an audio file (MP3, WAV, OGG, M4A)'
      : mode === 'metadata'
      ? 'Drop any video or audio file to inspect metadata'
      : 'Drop a video file (MP4, WebM, MOV)',
    hint: 'Processed locally in your browser using Web Audio API, Canvas, and Web Workers.',
    onFiles: ([file]) => loadMediaFile(file),
  });

  async function loadMediaFile(file) {
    const err = validateFile(file, { maxMB: 350 });
    if (err) return showToast(err, 'error');
    wsEl.classList.remove('hidden');
    wsEl.innerHTML = '';

    // 1. Video to MP3 or Audio Converter
    if (mode === 'video-to-mp3' || mode === 'audio-convert') {
      const defaultFmt = mode === 'video-to-mp3' ? 'mp3' : 'mp3';
      wsEl.innerHTML = `
        <div class="grid-2" style="margin-bottom:1rem">
          <div class="field-group">
            <label for="ac-fmt">Output Format</label>
            <select id="ac-fmt">
              <option value="mp3" ${defaultFmt === 'mp3' ? 'selected' : ''}>MP3 (MPEG Layer III)</option>
              <option value="wav">WAV (16-bit Uncompressed PCM)</option>
            </select>
          </div>
          <div class="field-group">
            <label for="ac-kbps">MP3 Bitrate</label>
            <select id="ac-kbps">
              <option value="128">128 kbps</option>
              <option value="192" selected>192 kbps (High)</option>
              <option value="320">320 kbps (Studio)</option>
            </select>
          </div>
        </div>
        <button type="button" id="ac-run-btn" class="btn btn-primary">Convert Audio</button>
        <div id="ac-out" style="margin-top:1rem"></div>
      `;

      wsEl.querySelector('#ac-run-btn').addEventListener('click', async () => {
        const fmt = wsEl.querySelector('#ac-fmt').value;
        const kbps = parseInt(wsEl.querySelector('#ac-kbps').value, 10);
        progress.start('Decoding audio track...');
        try {
          const buf = await file.arrayBuffer();
          const actx = new (window.AudioContext || window.webkitAudioContext)();
          const decoded = await actx.decodeAudioData(buf);
          await actx.close();
          const channels = [];
          for (let i = 0; i < Math.min(2, decoded.numberOfChannels); i++) {
            channels.push(new Float32Array(decoded.getChannelData(i)));
          }
          const blob = await encodeAudioWorker(channels, decoded.sampleRate, fmt, kbps, (p) => {
            progress.update(20 + p * 0.8, `Encoding ${fmt.toUpperCase()}...`);
          });
          progress.finish('Done');
          const outName = file.name.replace(/\.[^.]+$/, '') + '.' + fmt;
          const url = URL.createObjectURL(blob);
          wsEl.querySelector('#ac-out').innerHTML = `
            <div class="flex-between" style="margin-bottom:0.75rem">
              <div><strong>${escapeHtml(outName)}</strong> <span class="muted-text tabular-nums">(${formatBytes(blob.size)})</span></div>
              <button type="button" id="ac-dl" class="btn btn-primary btn-sm">Download ${fmt.toUpperCase()}</button>
            </div>
            <audio src="${url}" controls class="w-full"></audio>
          `;
          wsEl.querySelector('#ac-dl').addEventListener('click', () => {
            triggerDownload(blob, outName, { toolName: tool.name, toolId: tool.id });
          });
        } catch (e) {
          progress.hide();
          wsEl.querySelector('#ac-out').innerHTML = `<div class="error-banner">${escapeHtml(e.message || 'Unable to decode audio track.')}</div>`;
        }
      });
      return;
    }

    // 2. Audio Cutter & Audio Trimmer
    if (mode === 'audio-cutter' || mode === 'audio-trimmer') {
      progress.start('Decoding waveform...');
      try {
        const buf = await file.arrayBuffer();
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await actx.decodeAudioData(buf);
        await actx.close();
        progress.finish('Waveform Ready');

        const dur = decoded.duration;
        const isTrimmer = mode === 'audio-trimmer';

        wsEl.innerHTML = `
          <canvas id="wf-canvas" width="900" height="150" class="waveform-canvas"></canvas>
          <div class="grid-2" style="margin-top:1rem">
            <div class="field-group">
              <label for="cut-start">Start Time (sec) — max <span class="tabular-nums">${dur.toFixed(1)}s</span></label>
              <input type="number" id="cut-start" min="0" max="${dur.toFixed(2)}" step="0.1" value="0" />
            </div>
            <div class="field-group">
              <label for="cut-end">End Time (sec)</label>
              <input type="number" id="cut-end" min="0.1" max="${dur.toFixed(2)}" step="0.1" value="${dur.toFixed(2)}" />
            </div>
          </div>
          ${
            isTrimmer
              ? `
            <div class="grid-3">
              <div class="field-group">
                <label for="trim-fade-in">Fade In (sec)</label>
                <input type="number" id="trim-fade-in" min="0" max="10" step="0.1" value="0.5" />
              </div>
              <div class="field-group">
                <label for="trim-fade-out">Fade Out (sec)</label>
                <input type="number" id="trim-fade-out" min="0" max="10" step="0.1" value="0.5" />
              </div>
              <div class="field-group">
                <label for="trim-gain">Gain (<span id="trim-gain-lbl" class="tabular-nums">100</span>%)</label>
                <input type="range" id="trim-gain" min="20" max="200" value="100" />
              </div>
            </div>
          `
              : ''
          }
          <div class="grid-2">
            <div class="field-group">
              <label for="cut-fmt">Export Format</label>
              <select id="cut-fmt">
                <option value="mp3">MP3 (192 kbps)</option>
                <option value="wav">WAV (Lossless 16-bit)</option>
              </select>
            </div>
            <div class="field-group" style="display:flex;align-items:flex-end;gap:0.5rem">
              <button type="button" id="cut-preview-btn" class="btn btn-secondary">Preview Selection</button>
              <button type="button" id="cut-export-btn" class="btn btn-primary">Cut &amp; Export</button>
            </div>
          </div>
          <div id="cut-out" style="margin-top:1rem"></div>
        `;

        const wfCanvas = wsEl.querySelector('#wf-canvas');
        const startIn = wsEl.querySelector('#cut-start');
        const endIn = wsEl.querySelector('#cut-end');

        const redraw = () => {
          const s = Math.max(0, Math.min(dur - 0.1, parseFloat(startIn.value) || 0));
          const e = Math.max(s + 0.1, Math.min(dur, parseFloat(endIn.value) || dur));
          drawWaveform(wfCanvas, decoded, s, e);
        };

        startIn.addEventListener('input', redraw);
        endIn.addEventListener('input', redraw);
        if (isTrimmer) {
          wsEl.querySelector('#trim-gain').addEventListener('input', (e) => {
            wsEl.querySelector('#trim-gain-lbl').textContent = e.target.value;
          });
        }
        redraw();

        function sliceAudio() {
          const s = Math.max(0, Math.min(dur - 0.1, parseFloat(startIn.value) || 0));
          const e = Math.max(s + 0.1, Math.min(dur, parseFloat(endIn.value) || dur));
          const sr = decoded.sampleRate;
          const startSample = Math.floor(s * sr);
          const endSample = Math.min(decoded.length, Math.floor(e * sr));
          const len = Math.max(1, endSample - startSample);
          const fadeInSamples = isTrimmer ? Math.floor((parseFloat(wsEl.querySelector('#trim-fade-in').value) || 0) * sr) : 0;
          const fadeOutSamples = isTrimmer ? Math.floor((parseFloat(wsEl.querySelector('#trim-fade-out').value) || 0) * sr) : 0;
          const gain = isTrimmer ? (parseFloat(wsEl.querySelector('#trim-gain').value) || 100) / 100 : 1;

          const channels = [];
          for (let ch = 0; ch < Math.min(2, decoded.numberOfChannels); ch++) {
            const src = decoded.getChannelData(ch);
            const slice = new Float32Array(len);
            for (let i = 0; i < len; i++) {
              let v = src[startSample + i] * gain;
              if (fadeInSamples > 0 && i < fadeInSamples) v *= i / fadeInSamples;
              if (fadeOutSamples > 0 && i > len - fadeOutSamples) v *= (len - i) / fadeOutSamples;
              slice[i] = Math.max(-1, Math.min(1, v));
            }
            channels.push(slice);
          }
          return { channels, sr };
        }

        wsEl.querySelector('#cut-preview-btn').addEventListener('click', async () => {
          const { channels, sr } = sliceAudio();
          const wavBlob = await encodeAudioWorker(channels, sr, 'wav', 192);
          const url = URL.createObjectURL(wavBlob);
          wsEl.querySelector('#cut-out').innerHTML = `<audio src="${url}" controls autoplay class="w-full"></audio>`;
        });

        wsEl.querySelector('#cut-export-btn').addEventListener('click', async () => {
          const fmt = wsEl.querySelector('#cut-fmt').value;
          const { channels, sr } = sliceAudio();
          progress.start(`Encoding trimmed ${fmt.toUpperCase()}...`);
          const blob = await encodeAudioWorker(channels, sr, fmt, 192, (p) => progress.update(p));
          progress.finish('Export Ready');
          const outName = file.name.replace(/\.[^.]+$/, '') + `-cut.${fmt}`;
          triggerDownload(blob, outName, { toolName: tool.name, toolId: tool.id });
        });
      } catch (e) {
        progress.hide();
        wsEl.innerHTML = `<div class="error-banner">${escapeHtml(e.message)}</div>`;
      }
      return;
    }

    // 3. Video to GIF (Real LZW GIF89a Web Worker)
    if (mode === 'video-gif') {
      const videoUrl = URL.createObjectURL(file);
      wsEl.innerHTML = `
        <video id="gif-vid" src="${videoUrl}" controls muted playsinline class="preview-media" style="margin-bottom:1rem"></video>
        <div class="grid-4">
          <div class="field-group"><label for="gif-start">Start (sec)</label><input type="number" id="gif-start" min="0" step="0.2" value="0" /></div>
          <div class="field-group"><label for="gif-dur">Duration (sec, max 10)</label><input type="number" id="gif-dur" min="0.5" max="10" step="0.5" value="3" /></div>
          <div class="field-group"><label for="gif-fps">FPS</label><select id="gif-fps"><option value="8">8 fps</option><option value="12" selected>12 fps</option><option value="15">15 fps</option></select></div>
          <div class="field-group"><label for="gif-width">Width (px)</label><select id="gif-width"><option value="320">320 px</option><option value="480" selected>480 px</option><option value="640">640 px</option></select></div>
        </div>
        <button type="button" id="gif-build-btn" class="btn btn-primary">Create Animated GIF</button>
        <div id="gif-out" style="margin-top:1rem"></div>
      `;

      const vid = wsEl.querySelector('#gif-vid');
      await new Promise((res) => { vid.onloadedmetadata = res; });
      wsEl.querySelector('#gif-dur').max = Math.min(10, vid.duration).toFixed(1);

      wsEl.querySelector('#gif-build-btn').addEventListener('click', async () => {
        const start = Math.max(0, Math.min(vid.duration - 0.2, parseFloat(wsEl.querySelector('#gif-start').value) || 0));
        const dur = Math.max(0.4, Math.min(10, vid.duration - start, parseFloat(wsEl.querySelector('#gif-dur').value) || 3));
        const fps = parseInt(wsEl.querySelector('#gif-fps').value, 10);
        const targetW = parseInt(wsEl.querySelector('#gif-width').value, 10);
        const targetH = Math.max(2, Math.round((vid.videoHeight / vid.videoWidth) * targetW));
        const totalFrames = Math.max(2, Math.round(dur * fps));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        progress.start('Capturing video frames...');
        const frames = [];
        for (let i = 0; i < totalFrames; i++) {
          const t = start + (i / fps);
          vid.currentTime = Math.min(vid.duration, t);
          await new Promise((r) => { vid.onseeked = r; });
          ctx.drawImage(vid, 0, 0, targetW, targetH);
          const imgData = ctx.getImageData(0, 0, targetW, targetH);
          frames.push(imgData.data.buffer);
          progress.update(Math.round(((i + 1) / totalFrames) * 50), `Captured frame ${i + 1}/${totalFrames}`);
        }

        progress.update(55, 'Encoding GIF89a in Web Worker...');
        const worker = new Worker(new URL('./workers/gif-worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
          if (e.data.type === 'progress') {
            progress.update(55 + e.data.value * 0.45, `LZW compressing GIF... ${e.data.value}%`);
          } else if (e.data.type === 'done') {
            worker.terminate();
            progress.finish('GIF Created');
            const blob = new Blob([e.data.buffer], { type: 'image/gif' });
            const gifUrl = URL.createObjectURL(blob);
            const outName = file.name.replace(/\.[^.]+$/, '') + '.gif';
            wsEl.querySelector('#gif-out').innerHTML = `
              <div class="flex-between" style="margin-bottom:0.75rem">
                <strong>${escapeHtml(outName)} (${targetW}×${targetH} · ${totalFrames} frames · ${formatBytes(blob.size)})</strong>
                <button type="button" id="gif-dl" class="btn btn-primary btn-sm">Download GIF</button>
              </div>
              <img src="${gifUrl}" alt="Generated GIF" class="preview-media" />
            `;
            wsEl.querySelector('#gif-dl').addEventListener('click', () => {
              triggerDownload(blob, outName, { toolName: tool.name, toolId: tool.id });
            });
          } else if (e.data.type === 'error') {
            worker.terminate();
            progress.hide();
            showToast('GIF encoding failed: ' + e.data.message, 'error');
          }
        };
        worker.postMessage({ width: targetW, height: targetH, frames, delayMs: Math.round(1000 / fps) }, frames);
      });
      return;
    }

    // 4. Video Compressor & Video Resizer (Canvas + MediaRecorder)
    if (mode === 'video-compress' || mode === 'video-resize') {
      const videoUrl = URL.createObjectURL(file);
      const isResize = mode === 'video-resize';
      wsEl.innerHTML = `
        <video id="vr-vid" src="${videoUrl}" controls playsinline class="preview-media" style="margin-bottom:1rem"></video>
        <div class="grid-3">
          <div class="field-group">
            <label for="vr-res">Target Resolution</label>
            <select id="vr-res">
              <option value="orig" ${!isResize ? 'selected' : ''}>Keep Original</option>
              <option value="1280x720" ${isResize ? 'selected' : ''}>720p HD (1280×720)</option>
              <option value="854x480">480p SD (854×480)</option>
              <option value="640x360">360p Compact (640×360)</option>
              <option value="720x720">Square 1:1 (720×720)</option>
            </select>
          </div>
          <div class="field-group">
            <label for="vr-kbps">Target Bitrate (kbps)</label>
            <select id="vr-kbps">
              <option value="500">500 kbps (Max Compression)</option>
              <option value="1200" selected>1200 kbps (Balanced)</option>
              <option value="2500">2500 kbps (High Quality)</option>
            </select>
          </div>
          <div class="field-group">
            <label for="vr-fps">Frame Rate</label>
            <select id="vr-fps">
              <option value="24">24 fps</option>
              <option value="30" selected>30 fps</option>
            </select>
          </div>
        </div>
        <button type="button" id="vr-run-btn" class="btn btn-primary">${isResize ? 'Resize Video' : 'Compress Video'}</button>
        <p class="field-hint">Note: Browser MediaRecorder encodes in real time while playing through the clip into WebM.</p>
        <div id="vr-out" style="margin-top:1rem"></div>
      `;

      const vid = wsEl.querySelector('#vr-vid');
      await new Promise((res) => { vid.onloadedmetadata = res; });

      wsEl.querySelector('#vr-run-btn').addEventListener('click', async () => {
        if (typeof MediaRecorder === 'undefined') {
          return showToast('MediaRecorder is not supported in this browser.', 'error');
        }
        const resVal = wsEl.querySelector('#vr-res').value;
        const kbps = parseInt(wsEl.querySelector('#vr-kbps').value, 10);
        const fps = parseInt(wsEl.querySelector('#vr-fps').value, 10);

        let tw = vid.videoWidth;
        let th = vid.videoHeight;
        if (resVal !== 'orig') {
          const [rw, rh] = resVal.split('x').map(Number);
          tw = rw;
          th = rh;
        }

        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d');
        const stream = canvas.captureStream(fps);

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
          ? 'video/webm;codecs=vp9'
          : 'video/webm';
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: kbps * 1000,
        });

        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

        progress.start('Re-encoding video frames...');
        vid.currentTime = 0;
        vid.muted = true;
        recorder.start(250);
        await vid.play();

        let rafId;
        const pump = () => {
          if (vid.paused || vid.ended) return;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, tw, th);
          // Fit aspect ratio cleanly inside target canvas
          const scale = Math.min(tw / vid.videoWidth, th / vid.videoHeight);
          const dw = vid.videoWidth * scale;
          const dh = vid.videoHeight * scale;
          ctx.drawImage(vid, (tw - dw) / 2, (th - dh) / 2, dw, dh);
          progress.update((vid.currentTime / Math.max(0.1, vid.duration)) * 95);
          rafId = requestAnimationFrame(pump);
        };
        pump();

        await new Promise((resolve) => {
          vid.onended = () => {
            cancelAnimationFrame(rafId);
            recorder.stop();
          };
          recorder.onstop = resolve;
        });

        progress.finish('Video Ready');
        const outBlob = new Blob(chunks, { type: 'video/webm' });
        const outUrl = URL.createObjectURL(outBlob);
        const outName = file.name.replace(/\.[^.]+$/, '') + `-${tw}x${th}.webm`;
        wsEl.querySelector('#vr-out').innerHTML = `
          <div class="flex-between" style="margin-bottom:0.75rem">
            <strong>${escapeHtml(outName)} (${formatBytes(file.size)} → ${formatBytes(outBlob.size)})</strong>
            <button type="button" id="vr-dl" class="btn btn-primary btn-sm">Download WebM</button>
          </div>
          <video src="${outUrl}" controls class="preview-media"></video>
        `;
        wsEl.querySelector('#vr-dl').addEventListener('click', () => {
          triggerDownload(outBlob, outName, { toolName: tool.name, toolId: tool.id });
        });
      });
      return;
    }

    // 5. Video Thumbnail Generator
    if (mode === 'video-thumbs') {
      const videoUrl = URL.createObjectURL(file);
      wsEl.innerHTML = `
        <video id="th-vid" src="${videoUrl}" controls playsinline class="preview-media" style="margin-bottom:1rem"></video>
        <div class="btn-row">
          <button type="button" id="th-capture-now" class="btn btn-primary">Capture Current Frame</button>
          <button type="button" id="th-grid-btn" class="btn btn-secondary">Auto-Extract 6 Keyframes</button>
          <button type="button" id="th-zip-btn" class="btn btn-secondary hidden">Download All (.ZIP)</button>
        </div>
        <div id="th-grid" class="thumb-grid" style="margin-top:1rem"></div>
      `;
      const vid = wsEl.querySelector('#th-vid');
      const grid = wsEl.querySelector('#th-grid');
      const zipBtn = wsEl.querySelector('#th-zip-btn');
      const captured = [];

      await new Promise((res) => { vid.onloadedmetadata = res; });

      async function grabFrameAt(timeSec) {
        vid.currentTime = Math.min(vid.duration, Math.max(0, timeSec));
        await new Promise((r) => { vid.onseeked = r; });
        const c = document.createElement('canvas');
        c.width = vid.videoWidth;
        c.height = vid.videoHeight;
        c.getContext('2d').drawImage(vid, 0, 0);
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.94));
        const url = URL.createObjectURL(blob);
        const item = {
          name: `${file.name.replace(/\.[^.]+$/, '')}-${timeSec.toFixed(1)}s.jpg`,
          blob,
          url,
          time: timeSec,
        };
        captured.push(item);
        renderThumbCards();
      }

      function renderThumbCards() {
        zipBtn.classList.toggle('hidden', captured.length < 2);
        grid.innerHTML = captured
          .map(
            (c, idx) => `
          <div class="thumb-card">
            <img src="${c.url}" alt="Frame at ${c.time.toFixed(1)}s" />
            <div class="thumb-meta">
              <span class="tabular-nums">${formatDuration(c.time)} · ${formatBytes(c.blob.size)}</span>
              <button type="button" class="btn btn-secondary btn-xs th-dl-one" data-idx="${idx}">Save JPG</button>
            </div>
          </div>
        `
          )
          .join('');
        grid.querySelectorAll('.th-dl-one').forEach((b) => {
          b.addEventListener('click', () => {
            const item = captured[parseInt(b.dataset.idx, 10)];
            triggerDownload(item.blob, item.name, { toolName: tool.name, toolId: tool.id });
          });
        });
      }

      wsEl.querySelector('#th-capture-now').addEventListener('click', () => grabFrameAt(vid.currentTime));
      wsEl.querySelector('#th-grid-btn').addEventListener('click', async () => {
        progress.start('Extracting 6 frames...');
        for (let i = 1; i <= 6; i++) {
          const t = (vid.duration * i) / 7;
          await grabFrameAt(t);
          progress.update((i / 6) * 100);
        }
        progress.finish('Thumbnails Ready');
      });
      zipBtn.addEventListener('click', async () => {
        const zip = new JSZip();
        captured.forEach((c) => zip.file(c.name, c.blob));
        const zblob = await zip.generateAsync({ type: 'blob' });
        triggerDownload(zblob, 'video-thumbnails.zip', { toolName: tool.name, toolId: tool.id });
      });
      return;
    }

    // 6. Media Metadata Viewer
    if (mode === 'metadata') {
      progress.start('Inspecting media container & streams...');
      const magic = await detectMagicFormat(file);
      const url = URL.createObjectURL(file);
      const isVid = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name);

      let duration = 0;
      let width = 0;
      let height = 0;
      let sampleRate = 'N/A';
      let channels = 'N/A';

      await new Promise((resolve) => {
        const el = document.createElement(isVid ? 'video' : 'audio');
        el.preload = 'metadata';
        el.onloadedmetadata = () => {
          duration = el.duration;
          if (isVid) {
            width = el.videoWidth;
            height = el.videoHeight;
          }
          resolve();
        };
        el.onerror = resolve;
        el.src = url;
      });

      try {
        const headBuf = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer();
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await actx.decodeAudioData(headBuf).catch(() => null);
        if (decoded) {
          sampleRate = `${decoded.sampleRate.toLocaleString()} Hz`;
          channels = `${decoded.numberOfChannels} channel(s)`;
        }
        await actx.close();
      } catch {
        // ignore
      }

      const bitrateKbps = duration > 0 ? Math.round((file.size * 8) / duration / 1000) : 0;
      progress.finish('Inspection Complete');

      wsEl.innerHTML = `
        <div class="meta-grid">
          <div class="meta-item"><span class="meta-k">File Name</span><span class="meta-v">${escapeHtml(file.name)}</span></div>
          <div class="meta-item"><span class="meta-k">File Size</span><span class="meta-v tabular-nums">${escapeHtml(formatBytes(file.size))}</span></div>
          <div class="meta-item"><span class="meta-k">Container / Magic</span><span class="meta-v">${escapeHtml(magic.detected)}</span></div>
          <div class="meta-item"><span class="meta-k">Duration</span><span class="meta-v tabular-nums">${duration ? formatDuration(duration) + ` (${duration.toFixed(2)}s)` : 'Unknown'}</span></div>
          <div class="meta-item"><span class="meta-k">Resolution</span><span class="meta-v tabular-nums">${width ? `${width} × ${height} px` : 'Audio Only'}</span></div>
          <div class="meta-item"><span class="meta-k">Estimated Bitrate</span><span class="meta-v tabular-nums">${bitrateKbps ? `~${bitrateKbps} kbps` : 'N/A'}</span></div>
          <div class="meta-item"><span class="meta-k">Audio Sample Rate</span><span class="meta-v tabular-nums">${escapeHtml(sampleRate)}</span></div>
          <div class="meta-item"><span class="meta-k">Audio Channels</span><span class="meta-v">${escapeHtml(channels)}</span></div>
        </div>
        <div style="margin-top:1rem">
          ${isVid ? `<video src="${url}" controls class="preview-media"></video>` : `<audio src="${url}" controls class="w-full"></audio>`}
        </div>
      `;
    }
  }
}
