import QRCode from 'qrcode';
import { escapeHtml, showToast, triggerDownload, validateFile } from './utils.js';

export function renderQrTool(container, tool) {
  let activeMode = tool.mode || 'url';
  let logoImg = null;
  let lastSvg = '';

  container.innerHTML = `
    <div class="tool-workspace">
      <div class="tool-controls-pane">
        <div class="segmented-tabs" role="tablist" aria-label="QR Code Type">
          <button type="button" class="seg-btn ${activeMode === 'url' ? 'active' : ''}" data-qrmode="url">URL</button>
          <button type="button" class="seg-btn ${activeMode === 'text' ? 'active' : ''}" data-qrmode="text">Text</button>
          <button type="button" class="seg-btn ${activeMode === 'wifi' ? 'active' : ''}" data-qrmode="wifi">WiFi</button>
          <button type="button" class="seg-btn ${activeMode === 'vcard' ? 'active' : ''}" data-qrmode="vcard">Contact</button>
          <button type="button" class="seg-btn ${activeMode === 'email' ? 'active' : ''}" data-qrmode="email">Email</button>
          <button type="button" class="seg-btn ${activeMode === 'phone' ? 'active' : ''}" data-qrmode="phone">Phone</button>
        </div>

        <div id="qr-dynamic-fields" class="panel-section"></div>

        <div class="panel-section">
          <h3 class="section-subtitle">Appearance &amp; Logo</h3>
          <div class="grid-2">
            <div class="field-group">
              <label for="qr-fg">Foreground Color</label>
              <div class="color-row">
                <input type="color" id="qr-fg" value="#0f172a" />
                <span id="qr-fg-hex" class="mono-tag tabular-nums">#0f172a</span>
              </div>
            </div>
            <div class="field-group">
              <label for="qr-bg">Background Color</label>
              <div class="color-row">
                <input type="color" id="qr-bg" value="#ffffff" />
                <span id="qr-bg-hex" class="mono-tag tabular-nums">#ffffff</span>
              </div>
            </div>
          </div>
          <div class="grid-2">
            <div class="field-group">
              <label for="qr-size">Resolution (px)</label>
              <select id="qr-size">
                <option value="256">256 × 256</option>
                <option value="512" selected>512 × 512</option>
                <option value="1024">1024 × 1024</option>
                <option value="1600">1600 × 1600 (Print)</option>
              </select>
            </div>
            <div class="field-group">
              <label for="qr-ecc">Error Correction</label>
              <select id="qr-ecc">
                <option value="L">L (7%)</option>
                <option value="M">M (15%)</option>
                <option value="Q">Q (25%)</option>
                <option value="H" selected>H (30% — Best for Logo)</option>
              </select>
            </div>
          </div>
          <div class="field-group">
            <label for="qr-logo-input">Center Logo Overlay (Optional PNG/SVG/JPG)</label>
            <div class="btn-row">
              <input type="file" id="qr-logo-input" accept="image/*" class="file-input-inline" />
              <button type="button" id="qr-logo-clear" class="btn btn-secondary btn-sm hidden">Remove Logo</button>
            </div>
          </div>
        </div>
      </div>

      <div class="tool-preview-pane">
        <div class="preview-stage qr-stage">
          <canvas id="qr-canvas" class="qr-canvas"></canvas>
        </div>
        <div class="meta-strip">
          <span id="qr-payload-len" class="tabular-nums">0 chars</span>
          <span aria-hidden="true">·</span>
          <span>Vector SVG + High-DPI Raster</span>
        </div>
        <div class="btn-row">
          <button type="button" id="qr-dl-png" class="btn btn-primary">Download PNG</button>
          <button type="button" id="qr-dl-jpg" class="btn btn-secondary">Download JPG</button>
          <button type="button" id="qr-dl-svg" class="btn btn-secondary">Download SVG</button>
        </div>
      </div>
    </div>
  `;

  const fieldsEl = container.querySelector('#qr-dynamic-fields');
  const canvas = container.querySelector('#qr-canvas');
  const fgInput = container.querySelector('#qr-fg');
  const bgInput = container.querySelector('#qr-bg');
  const fgHex = container.querySelector('#qr-fg-hex');
  const bgHex = container.querySelector('#qr-bg-hex');
  const sizeSelect = container.querySelector('#qr-size');
  const eccSelect = container.querySelector('#qr-ecc');
  const logoInput = container.querySelector('#qr-logo-input');
  const logoClear = container.querySelector('#qr-logo-clear');
  const lenLabel = container.querySelector('#qr-payload-len');

  function renderModeFields() {
    if (activeMode === 'url') {
      fieldsEl.innerHTML = `
        <div class="field-group">
          <label for="qr-url-val">Website URL</label>
          <input type="url" id="qr-url-val" value="https://flyai-tools.web.app" placeholder="https://example.com" />
        </div>
      `;
    } else if (activeMode === 'text') {
      fieldsEl.innerHTML = `
        <div class="field-group">
          <label for="qr-text-val">Plain Text / Message</label>
          <textarea id="qr-text-val" rows="4" placeholder="Enter any text, coupon code, or note...">FlyAI Tools — Fast &amp; Private Browser Utilities</textarea>
        </div>
      `;
    } else if (activeMode === 'wifi') {
      fieldsEl.innerHTML = `
        <div class="field-group">
          <label for="qr-wifi-ssid">Network Name (SSID)</label>
          <input type="text" id="qr-wifi-ssid" value="Studio_WiFi_5G" placeholder="Your WiFi Name" />
        </div>
        <div class="grid-2">
          <div class="field-group">
            <label for="qr-wifi-pass">Password</label>
            <input type="text" id="qr-wifi-pass" value="FlyAI2026!" placeholder="Network password" />
          </div>
          <div class="field-group">
            <label for="qr-wifi-enc">Security</label>
            <select id="qr-wifi-enc">
              <option value="WPA" selected>WPA / WPA2 / WPA3</option>
              <option value="WEP">WEP</option>
              <option value="nopass">Open (No Password)</option>
            </select>
          </div>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="qr-wifi-hidden" />
          <span>Hidden WiFi network</span>
        </label>
      `;
    } else if (activeMode === 'vcard') {
      fieldsEl.innerHTML = `
        <div class="grid-2">
          <div class="field-group">
            <label for="qr-vc-first">First Name</label>
            <input type="text" id="qr-vc-first" value="Alex" />
          </div>
          <div class="field-group">
            <label for="qr-vc-last">Last Name</label>
            <input type="text" id="qr-vc-last" value="Morgan" />
          </div>
        </div>
        <div class="grid-2">
          <div class="field-group">
            <label for="qr-vc-phone">Phone</label>
            <input type="tel" id="qr-vc-phone" value="+1-555-0192" />
          </div>
          <div class="field-group">
            <label for="qr-vc-email">Email</label>
            <input type="email" id="qr-vc-email" value="alex@example.com" />
          </div>
        </div>
        <div class="grid-2">
          <div class="field-group">
            <label for="qr-vc-org">Organization</label>
            <input type="text" id="qr-vc-org" value="FlyAI Studio" />
          </div>
          <div class="field-group">
            <label for="qr-vc-url">Website</label>
            <input type="url" id="qr-vc-url" value="https://example.com" />
          </div>
        </div>
      `;
    } else if (activeMode === 'email') {
      fieldsEl.innerHTML = `
        <div class="field-group">
          <label for="qr-em-to">Recipient Email</label>
          <input type="email" id="qr-em-to" value="hello@example.com" />
        </div>
        <div class="field-group">
          <label for="qr-em-sub">Subject</label>
          <input type="text" id="qr-em-sub" value="Inquiry via FlyAI QR" />
        </div>
        <div class="field-group">
          <label for="qr-em-body">Message Body</label>
          <textarea id="qr-em-body" rows="3">Hello, I scanned your QR code.</textarea>
        </div>
      `;
    } else if (activeMode === 'phone') {
      fieldsEl.innerHTML = `
        <div class="field-group">
          <label for="qr-ph-num">Phone Number (with country code)</label>
          <input type="tel" id="qr-ph-num" value="+15550192834" placeholder="+15550192834" />
        </div>
      `;
    }

    fieldsEl.querySelectorAll('input, textarea, select').forEach((el) => {
      el.addEventListener('input', updateQr);
      el.addEventListener('change', updateQr);
    });
  }

  function getPayload() {
    const val = (id) => container.querySelector(`#${id}`)?.value || '';
    if (activeMode === 'url') return val('qr-url-val').trim() || 'https://flyai-tools.web.app';
    if (activeMode === 'text') return val('qr-text-val') || ' ';
    if (activeMode === 'wifi') {
      const esc = (s) => s.replace(/([\\;,:"])/g, '\\$1');
      const ssid = esc(val('qr-wifi-ssid'));
      const pass = esc(val('qr-wifi-pass'));
      const enc = val('qr-wifi-enc') || 'WPA';
      const hidden = container.querySelector('#qr-wifi-hidden')?.checked ? 'true' : 'false';
      return `WIFI:T:${enc};S:${ssid};P:${enc === 'nopass' ? '' : pass};H:${hidden};;`;
    }
    if (activeMode === 'vcard') {
      const fn = val('qr-vc-first').trim();
      const ln = val('qr-vc-last').trim();
      const ph = val('qr-vc-phone').trim();
      const em = val('qr-vc-email').trim();
      const org = val('qr-vc-org').trim();
      const url = val('qr-vc-url').trim();
      return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${ln};${fn};;;`,
        `FN:${(fn + ' ' + ln).trim()}`,
        org ? `ORG:${org}` : '',
        ph ? `TEL;TYPE=CELL:${ph}` : '',
        em ? `EMAIL:${em}` : '',
        url ? `URL:${url}` : '',
        'END:VCARD',
      ]
        .filter(Boolean)
        .join('\n');
    }
    if (activeMode === 'email') {
      const to = encodeURIComponent(val('qr-em-to').trim());
      const sub = encodeURIComponent(val('qr-em-sub'));
      const body = encodeURIComponent(val('qr-em-body'));
      return `mailto:${to}?subject=${sub}&body=${body}`;
    }
    if (activeMode === 'phone') {
      return `tel:${val('qr-ph-num').replace(/\s+/g, '')}`;
    }
    return '';
  }

  async function updateQr() {
    const payload = getPayload();
    const size = parseInt(sizeSelect.value, 10) || 512;
    const fg = fgInput.value;
    const bg = bgInput.value;
    const ecc = eccSelect.value || 'H';

    fgHex.textContent = fg;
    bgHex.textContent = bg;
    lenLabel.textContent = `${payload.length} chars`;

    try {
      await QRCode.toCanvas(canvas, payload, {
        width: size,
        margin: 2,
        errorCorrectionLevel: ecc,
        color: { dark: fg, light: bg },
      });

      if (logoImg) {
        const ctx = canvas.getContext('2d');
        const logoBox = Math.round(size * 0.22);
        const pad = Math.round(logoBox * 0.14);
        const x = Math.round((size - logoBox) / 2);
        const y = Math.round((size - logoBox) / 2);
        ctx.fillStyle = bg;
        const r = Math.round(logoBox * 0.16);
        ctx.beginPath();
        ctx.roundRect(x - pad, y - pad, logoBox + pad * 2, logoBox + pad * 2, r);
        ctx.fill();
        ctx.drawImage(logoImg, x, y, logoBox, logoBox);
      }

      lastSvg = await QRCode.toString(payload, {
        type: 'svg',
        width: size,
        margin: 2,
        errorCorrectionLevel: ecc,
        color: { dark: fg, light: bg },
      });
    } catch (err) {
      showToast('QR generation error: ' + err.message, 'error');
    }
  }

  container.querySelectorAll('[data-qrmode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeMode = btn.dataset.qrmode;
      container.querySelectorAll('[data-qrmode]').forEach((b) => b.classList.toggle('active', b === btn));
      renderModeFields();
      updateQr();
    });
  });

  [fgInput, bgInput, sizeSelect, eccSelect].forEach((el) => {
    el.addEventListener('input', updateQr);
    el.addEventListener('change', updateQr);
  });

  logoInput.addEventListener('change', () => {
    const file = logoInput.files?.[0];
    if (!file) return;
    const err = validateFile(file, { maxMB: 10, acceptPrefixes: ['image/'] });
    if (err) {
      showToast(err, 'error');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      logoImg = img;
      logoClear.classList.remove('hidden');
      eccSelect.value = 'H';
      updateQr();
    };
    img.src = url;
  });

  logoClear.addEventListener('click', () => {
    logoImg = null;
    logoInput.value = '';
    logoClear.classList.add('hidden');
    updateQr();
  });

  container.querySelector('#qr-dl-png').addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, `flyai-qr-${activeMode}.png`, { toolName: tool.name, toolId: tool.id });
    }, 'image/png');
  });

  container.querySelector('#qr-dl-jpg').addEventListener('click', () => {
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = bgInput.value;
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(canvas, 0, 0);
    tmp.toBlob((blob) => {
      if (blob) triggerDownload(blob, `flyai-qr-${activeMode}.jpg`, { toolName: tool.name, toolId: tool.id });
    }, 'image/jpeg', 0.94);
  });

  container.querySelector('#qr-dl-svg').addEventListener('click', () => {
    if (!lastSvg) return;
    let svgOut = lastSvg;
    if (logoImg) {
      // Embed logo image as data URL centered inside SVG so vector download also preserves logo
      const tmpC = document.createElement('canvas');
      tmpC.width = 256;
      tmpC.height = 256;
      tmpC.getContext('2d').drawImage(logoImg, 0, 0, 256, 256);
      const dataUrl = tmpC.toDataURL('image/png');
      const vbMatch = svgOut.match(/viewBox="0 0 (\d+) (\d+)"/);
      const vbSize = vbMatch ? parseInt(vbMatch[1], 10) : 40;
      const logoSize = vbSize * 0.22;
      const pos = (vbSize - logoSize) / 2;
      const pad = logoSize * 0.14;
      const overlay = `<rect x="${pos - pad}" y="${pos - pad}" width="${logoSize + pad * 2}" height="${logoSize + pad * 2}" rx="${logoSize * 0.15}" fill="${escapeHtml(bgInput.value)}"/><image href="${dataUrl}" x="${pos}" y="${pos}" width="${logoSize}" height="${logoSize}"/>`;
      svgOut = svgOut.replace('</svg>', `${overlay}</svg>`);
    }
    const blob = new Blob([svgOut], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, `flyai-qr-${activeMode}.svg`, { toolName: tool.name, toolId: tool.id });
  });

  renderModeFields();
  updateQr();
}
