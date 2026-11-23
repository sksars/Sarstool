import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { escapeHtml, showToast, triggerDownload } from './utils.js';

const PRESETS = {
  CODE128: { format: 'CODE128', sample: 'FLYAI-2026-001', hint: 'Supports full ASCII letters, numbers, and symbols.' },
  CODE39: { format: 'CODE39', sample: 'FLYAI-1234', hint: 'Supports uppercase A–Z, digits 0–9, and - . $ / + % space.' },
  EAN13: { format: 'EAN13', sample: '5901234123457', hint: 'Requires 12 digits (auto-check) or 13 digits with valid checksum.' },
  UPC: { format: 'UPC', sample: '012345678905', hint: 'Requires 11 digits (auto-check) or 12 digits with valid checksum.' },
  ISBN: { format: 'EAN13', sample: '9780143127741', hint: 'ISBN-13 book barcode starting with 978 or 979 (12 or 13 digits).' },
  CUSTOM: { format: 'CODE128', sample: 'CUSTOM-98765', hint: 'Flexible barcode studio with full bar width, height, color & label customization.' },
};

function computeEanCheckDigit(digits12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits12[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

function computeUpcCheckDigit(digits11) {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += parseInt(digits11[i], 10) * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

export function renderBarcodeTool(container, tool) {
  let activeMode = PRESETS[tool.mode] ? tool.mode : 'CODE128';

  container.innerHTML = `
    <div class="tool-workspace">
      <div class="tool-controls-pane">
        <div class="segmented-tabs" role="tablist" aria-label="Barcode Format">
          <button type="button" class="seg-btn ${activeMode === 'CODE128' ? 'active' : ''}" data-bcmode="CODE128">Code 128</button>
          <button type="button" class="seg-btn ${activeMode === 'CODE39' ? 'active' : ''}" data-bcmode="CODE39">Code 39</button>
          <button type="button" class="seg-btn ${activeMode === 'EAN13' ? 'active' : ''}" data-bcmode="EAN13">EAN-13</button>
          <button type="button" class="seg-btn ${activeMode === 'UPC' ? 'active' : ''}" data-bcmode="UPC">UPC-A</button>
          <button type="button" class="seg-btn ${activeMode === 'ISBN' ? 'active' : ''}" data-bcmode="ISBN">ISBN</button>
          <button type="button" class="seg-btn ${activeMode === 'CUSTOM' ? 'active' : ''}" data-bcmode="CUSTOM">Custom</button>
        </div>

        <div class="panel-section">
          <div class="field-group">
            <label for="bc-value">Barcode Value</label>
            <div class="input-action-row">
              <input type="text" id="bc-value" value="${escapeHtml(PRESETS[activeMode].sample)}" />
              <button type="button" id="bc-fix-check" class="btn btn-secondary btn-sm">Auto Check Digit</button>
            </div>
            <p id="bc-hint" class="field-hint">${escapeHtml(PRESETS[activeMode].hint)}</p>
          </div>

          <div id="bc-custom-format-wrap" class="field-group ${activeMode === 'CUSTOM' ? '' : 'hidden'}">
            <label for="bc-custom-fmt">Symbology</label>
            <select id="bc-custom-fmt">
              <option value="CODE128">Code 128</option>
              <option value="CODE39">Code 39</option>
              <option value="EAN13">EAN-13</option>
              <option value="EAN8">EAN-8</option>
              <option value="UPC">UPC-A</option>
              <option value="ITF14">ITF-14</option>
              <option value="MSI">MSI</option>
            </select>
          </div>

          <div class="grid-2">
            <div class="field-group">
              <label for="bc-width">Bar Width (<span id="bc-width-val" class="tabular-nums">2</span>px)</label>
              <input type="range" id="bc-width" min="1" max="5" step="0.5" value="2" />
            </div>
            <div class="field-group">
              <label for="bc-height">Bar Height (<span id="bc-height-val" class="tabular-nums">90</span>px)</label>
              <input type="range" id="bc-height" min="40" max="200" step="5" value="90" />
            </div>
          </div>

          <div class="grid-2">
            <div class="field-group">
              <label for="bc-line-color">Bar Color</label>
              <input type="color" id="bc-line-color" value="#0f172a" />
            </div>
            <div class="field-group">
              <label for="bc-bg-color">Background Color</label>
              <input type="color" id="bc-bg-color" value="#ffffff" />
            </div>
          </div>

          <label class="checkbox-row">
            <input type="checkbox" id="bc-show-text" checked />
            <span>Display human-readable text below bars</span>
          </label>
        </div>
      </div>

      <div class="tool-preview-pane">
        <div class="preview-stage barcode-stage">
          <svg id="bc-svg" aria-label="Barcode preview"></svg>
          <div id="bc-error" class="error-banner hidden"></div>
        </div>
        <div class="btn-row">
          <button type="button" id="bc-dl-png" class="btn btn-primary">Download PNG</button>
          <button type="button" id="bc-dl-svg" class="btn btn-secondary">Download SVG</button>
          <button type="button" id="bc-dl-pdf" class="btn btn-secondary">Download PDF</button>
        </div>
      </div>
    </div>
  `;

  const valInput = container.querySelector('#bc-value');
  const hintEl = container.querySelector('#bc-hint');
  const fmtWrap = container.querySelector('#bc-custom-format-wrap');
  const fmtSelect = container.querySelector('#bc-custom-fmt');
  const widthInput = container.querySelector('#bc-width');
  const heightInput = container.querySelector('#bc-height');
  const widthVal = container.querySelector('#bc-width-val');
  const heightVal = container.querySelector('#bc-height-val');
  const lineColor = container.querySelector('#bc-line-color');
  const bgColor = container.querySelector('#bc-bg-color');
  const showText = container.querySelector('#bc-show-text');
  const svgEl = container.querySelector('#bc-svg');
  const errEl = container.querySelector('#bc-error');

  function getActiveFormat() {
    if (activeMode === 'CUSTOM') return fmtSelect.value;
    return PRESETS[activeMode].format;
  }

  function renderBarcode() {
    widthVal.textContent = widthInput.value;
    heightVal.textContent = heightInput.value;

    let raw = valInput.value.trim();
    const format = getActiveFormat();

    if (format === 'EAN13' && /^\d{12}$/.test(raw)) {
      raw = raw + computeEanCheckDigit(raw);
    } else if (format === 'UPC' && /^\d{11}$/.test(raw)) {
      raw = raw + computeUpcCheckDigit(raw);
    }

    try {
      errEl.classList.add('hidden');
      svgEl.classList.remove('hidden');
      JsBarcode(svgEl, raw || ' ', {
        format,
        width: parseFloat(widthInput.value),
        height: parseInt(heightInput.value, 10),
        displayValue: showText.checked,
        lineColor: lineColor.value,
        background: bgColor.value,
        margin: 14,
        fontSize: 16,
      });
    } catch (err) {
      svgEl.classList.add('hidden');
      errEl.classList.remove('hidden');
      errEl.textContent = `Invalid ${format} value: ${err.message || 'Check input format and length.'}`;
    }
  }

  function svgToCanvas() {
    return new Promise((resolve, reject) => {
      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svgEl);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = (img.width || 400) * scale;
        canvas.height = (img.height || 180) * scale;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = bgColor.value;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to rasterize SVG barcode.'));
      };
      img.src = url;
    });
  }

  container.querySelectorAll('[data-bcmode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeMode = btn.dataset.bcmode;
      container.querySelectorAll('[data-bcmode]').forEach((b) => b.classList.toggle('active', b === btn));
      valInput.value = PRESETS[activeMode].sample;
      hintEl.textContent = PRESETS[activeMode].hint;
      fmtWrap.classList.toggle('hidden', activeMode !== 'CUSTOM');
      renderBarcode();
    });
  });

  container.querySelector('#bc-fix-check').addEventListener('click', () => {
    const digits = valInput.value.replace(/\D/g, '');
    const fmt = getActiveFormat();
    if (fmt === 'EAN13') {
      const base = (digits.length >= 12 ? digits.slice(0, 12) : digits.padStart(12, '0'));
      valInput.value = base + computeEanCheckDigit(base);
      renderBarcode();
      showToast('EAN-13 check digit calculated.', 'success');
    } else if (fmt === 'UPC') {
      const base = (digits.length >= 11 ? digits.slice(0, 11) : digits.padStart(11, '0'));
      valInput.value = base + computeUpcCheckDigit(base);
      renderBarcode();
      showToast('UPC-A check digit calculated.', 'success');
    } else {
      showToast('Check digits apply automatically to EAN-13, ISBN, and UPC-A.', 'info');
    }
  });

  [valInput, fmtSelect, widthInput, heightInput, lineColor, bgColor, showText].forEach((el) => {
    el.addEventListener('input', renderBarcode);
    el.addEventListener('change', renderBarcode);
  });

  container.querySelector('#bc-dl-svg').addEventListener('click', () => {
    if (!errEl.classList.contains('hidden')) return showToast('Fix barcode value first.', 'error');
    const svgStr = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    triggerDownload(blob, `flyai-barcode-${activeMode.toLowerCase()}.svg`, { toolName: tool.name, toolId: tool.id });
  });

  container.querySelector('#bc-dl-png').addEventListener('click', async () => {
    if (!errEl.classList.contains('hidden')) return showToast('Fix barcode value first.', 'error');
    const canvas = await svgToCanvas();
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, `flyai-barcode-${activeMode.toLowerCase()}.png`, { toolName: tool.name, toolId: tool.id });
    }, 'image/png');
  });

  container.querySelector('#bc-dl-pdf').addEventListener('click', async () => {
    if (!errEl.classList.contains('hidden')) return showToast('Fix barcode value first.', 'error');
    const canvas = await svgToCanvas();
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const maxW = pageW - 40;
    const ratio = canvas.height / canvas.width;
    const drawW = Math.min(maxW, 140);
    const drawH = drawW * ratio;
    pdf.addImage(imgData, 'PNG', (pageW - drawW) / 2, (pageH - drawH) / 2, drawW, drawH);
    const blob = pdf.output('blob');
    triggerDownload(blob, `flyai-barcode-${activeMode.toLowerCase()}.pdf`, { toolName: tool.name, toolId: tool.id });
  });

  renderBarcode();
}
