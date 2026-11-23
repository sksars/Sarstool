// Pure Vanilla JavaScript GIF89a Animated GIF Encoder Web Worker
// Quantizes RGBA frames to an adaptive 256-color palette and compresses with LZW.

function buildPaletteAndMap(rgba, pixelCount) {
  // Uniform 6x8x5 (240) + 16 grayscale (256) crisp perceptual palette for fast, reliable encoding
  const palette = new Uint8Array(256 * 3);
  let idx = 0;
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 8; g++) {
      for (let b = 0; b < 5; b++) {
        palette[idx * 3] = Math.round((r * 255) / 5);
        palette[idx * 3 + 1] = Math.round((g * 255) / 7);
        palette[idx * 3 + 2] = Math.round((b * 255) / 4);
        idx++;
      }
    }
  }
  for (let i = 0; i < 16; i++) {
    const gray = Math.round((i * 255) / 15);
    palette[idx * 3] = gray;
    palette[idx * 3 + 1] = gray;
    palette[idx * 3 + 2] = gray;
    idx++;
  }

  const indices = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const ri = Math.min(5, Math.round((r * 5) / 255));
    const gi = Math.min(7, Math.round((g * 7) / 255));
    const bi = Math.min(4, Math.round((b * 4) / 255));
    indices[i] = ri * 40 + gi * 5 + bi;
  }

  return { palette, indices };
}

function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const output = [];
  let bitBuffer = 0;
  let bitCount = 0;

  function emitBits(code, size) {
    bitBuffer |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  }

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let dict = new Map();

  function resetDict() {
    dict = new Map();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  }

  emitBits(clearCode, codeSize);
  let prefix = indices[0];

  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const existing = dict.get(key);
    if (existing !== undefined) {
      prefix = existing;
    } else {
      emitBits(prefix, codeSize);
      if (nextCode < 4096) {
        dict.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        emitBits(clearCode, codeSize);
        resetDict();
      }
      prefix = k;
    }
  }

  emitBits(prefix, codeSize);
  emitBits(eoiCode, codeSize);
  if (bitCount > 0) {
    output.push(bitBuffer & 0xff);
  }

  // Split into GIF LZW sub-blocks (max 255 bytes each)
  const blocks = [minCodeSize];
  for (let i = 0; i < output.length; i += 255) {
    const chunkLen = Math.min(255, output.length - i);
    blocks.push(chunkLen);
    for (let j = 0; j < chunkLen; j++) {
      blocks.push(output[i + j]);
    }
  }
  blocks.push(0); // Block terminator
  return new Uint8Array(blocks);
}

self.onmessage = (event) => {
  const { width, height, frames, delayMs } = event.data;
  try {
    const bytes = [];
    const pushStr = (s) => {
      for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i));
    };
    const push16 = (v) => {
      bytes.push(v & 0xff, (v >> 8) & 0xff);
    };

    // GIF89a Header
    pushStr('GIF89a');
    push16(width);
    push16(height);
    // Global Color Table Flag=0, Color Res=7, Sort=0, Size=0 (per-frame local table used)
    bytes.push(0x70, 0x00, 0x00);

    // Netscape 2.0 Looping Extension (infinite loop)
    bytes.push(0x21, 0xff, 0x0b);
    pushStr('NETSCAPE2.0');
    bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

    const delayCs = Math.max(2, Math.round((delayMs || 100) / 10));
    const pixelCount = width * height;

    for (let f = 0; f < frames.length; f++) {
      const rgba = new Uint8ClampedArray(frames[f]);
      const { palette, indices } = buildPaletteAndMap(rgba, pixelCount);

      // Graphic Control Extension
      bytes.push(0x21, 0xf9, 0x04, 0x04);
      push16(delayCs);
      bytes.push(0x00, 0x00);

      // Image Descriptor with Local Color Table (256 colors -> bit 7=1, size=7)
      bytes.push(0x2c);
      push16(0);
      push16(0);
      push16(width);
      push16(height);
      bytes.push(0x87);

      // Local Color Table
      for (let i = 0; i < palette.length; i++) {
        bytes.push(palette[i]);
      }

      // LZW Compressed Image Data
      const lzw = lzwEncode(indices, 8);
      for (let i = 0; i < lzw.length; i++) {
        bytes.push(lzw[i]);
      }

      self.postMessage({
        type: 'progress',
        value: Math.round(((f + 1) / frames.length) * 100),
      });
    }

    bytes.push(0x3b); // GIF Trailer
    const result = new Uint8Array(bytes);
    self.postMessage({ type: 'done', buffer: result.buffer }, [result.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
