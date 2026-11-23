// Web Worker for CPU-intensive pixel operations:
// 1. Edge-aware background removal (border clustering + flood-fill + feathering)
// 2. Photo enhancement (auto-levels, unsharp mask, vibrance)
// 3. Convolution & blur filters (Gaussian blur, pixelate, sharpen, emboss, color grades)

function clamp(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function rgbDistSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  // Perceptual weighted Euclidean distance
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

function computeEdgeMap(data, width, height) {
  const len = width * height;
  const gray = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const p = i * 4;
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  const edge = new Float32Array(len);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const gx =
        -gray[idx - width - 1] + gray[idx - width + 1] -
        2 * gray[idx - 1] + 2 * gray[idx + 1] -
        gray[idx + width - 1] + gray[idx + width + 1];
      const gy =
        -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1] +
        gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1];
      edge[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return edge;
}

function removeBackground(imageData, options) {
  const { width, height, data } = imageData;
  const tolerance = options.tolerance ?? 36;
  const feather = options.feather ?? 2;
  const contiguous = options.contiguous !== false;
  const samplePoints = Array.isArray(options.samplePoints) && options.samplePoints.length
    ? options.samplePoints
    : null;

  const total = width * height;
  const out = new Uint8ClampedArray(data);
  const visited = new Uint8Array(total);
  const bgMask = new Uint8Array(total); // 1 = background

  // Sample border reference colors if no explicit sample point provided
  const seeds = [];
  const seedColors = [];

  if (samplePoints) {
    for (const pt of samplePoints) {
      const sx = Math.max(0, Math.min(width - 1, Math.round(pt.x)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(pt.y)));
      const idx = sy * width + sx;
      const p = idx * 4;
      seeds.push(idx);
      seedColors.push([data[p], data[p + 1], data[p + 2]]);
    }
  } else {
    // Sample 4 corners and perimeter intervals
    const stepX = Math.max(1, Math.floor(width / 24));
    const stepY = Math.max(1, Math.floor(height / 24));
    for (let x = 0; x < width; x += stepX) {
      seeds.push(x);
      seeds.push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y += stepY) {
      seeds.push(y * width);
      seeds.push(y * width + (width - 1));
    }
    // Cluster dominant border color + local seed tolerance
    let sumR = 0, sumG = 0, sumB = 0;
    for (const idx of seeds) {
      const p = idx * 4;
      sumR += data[p];
      sumG += data[p + 1];
      sumB += data[p + 2];
    }
    seedColors.push([sumR / seeds.length, sumG / seeds.length, sumB / seeds.length]);
    // Also add exact corner colors
    const corners = [0, width - 1, (height - 1) * width, total - 1];
    for (const c of corners) {
      const p = c * 4;
      seedColors.push([data[p], data[p + 1], data[p + 2]]);
    }
  }

  self.postMessage({ type: 'progress', value: 25 });

  const edges = computeEdgeMap(data, width, height);
  // Scaled perceptual threshold
  const threshSq = (tolerance * 3.1) * (tolerance * 3.1);

  if (contiguous) {
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    for (const idx of seeds) {
      if (!visited[idx]) {
        const p = idx * 4;
        const r = data[p], g = data[p + 1], b = data[p + 2];
        let match = false;
        for (const sc of seedColors) {
          if (rgbDistSq(r, g, b, sc[0], sc[1], sc[2]) <= threshSq * 1.45) {
            match = true;
            break;
          }
        }
        if (match || !samplePoints) {
          visited[idx] = 1;
          bgMask[idx] = 1;
          queue[tail++] = idx;
        }
      }
    }

    const dx = [-1, 1, 0, 0];
    const dy = [0, 0, -1, 1];

    while (head < tail) {
      const curr = queue[head++];
      const cx = curr % width;
      const cy = (curr - cx) / width;
      const cp = curr * 4;
      const cr = data[cp], cg = data[cp + 1], cb = data[cp + 2];

      for (let k = 0; k < 4; k++) {
        const nx = cx + dx[k];
        const ny = cy + dy[k];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;

        const np = nIdx * 4;
        const nr = data[np], ng = data[np + 1], nb = data[np + 2];

        // Check against seed palette AND local neighbor similarity minus edge strength
        let matchesSeed = false;
        for (const sc of seedColors) {
          if (rgbDistSq(nr, ng, nb, sc[0], sc[1], sc[2]) <= threshSq) {
            matchesSeed = true;
            break;
          }
        }
        const localDiff = rgbDistSq(nr, ng, nb, cr, cg, cb);
        const edgePenalty = edges[nIdx] * 0.65;
        if (matchesSeed || (localDiff < threshSq * 0.25 && edgePenalty < tolerance * 2.2)) {
          bgMask[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
    }
  } else {
    for (let i = 0; i < total; i++) {
      const p = i * 4;
      const r = data[p], g = data[p + 1], b = data[p + 2];
      for (const sc of seedColors) {
        if (rgbDistSq(r, g, b, sc[0], sc[1], sc[2]) <= threshSq) {
          bgMask[i] = 1;
          break;
        }
      }
    }
  }

  self.postMessage({ type: 'progress', value: 70 });

  // Alpha mask generation + optional edge feathering
  const alpha = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    alpha[i] = bgMask[i] ? 0 : 255;
  }

  if (feather > 0) {
    const r = Math.min(6, Math.round(feather));
    const temp = new Float32Array(total);
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0, count = 0;
        for (let kx = -r; kx <= r; kx++) {
          const xx = x + kx;
          if (xx >= 0 && xx < width) {
            sum += alpha[row + xx];
            count++;
          }
        }
        temp[row + x] = sum / count;
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0, count = 0;
        for (let ky = -r; ky <= r; ky++) {
          const yy = y + ky;
          if (yy >= 0 && yy < height) {
            sum += temp[yy * width + x];
            count++;
          }
        }
        const idx = y * width + x;
        // Preserve solid interior foreground; smooth only boundary
        if (bgMask[idx] === 1) {
          out[idx * 4 + 3] = Math.min(data[idx * 4 + 3], clamp(sum / count * 0.35));
        } else {
          out[idx * 4 + 3] = Math.min(data[idx * 4 + 3], clamp(sum / count));
        }
      }
    }
  } else {
    for (let i = 0; i < total; i++) {
      if (bgMask[i]) out[i * 4 + 3] = 0;
    }
  }

  self.postMessage({ type: 'progress', value: 95 });
  return new ImageData(out, width, height);
}

function enhancePhoto(imageData, options) {
  const { width, height, data } = imageData;
  const strength = (options.strength ?? 60) / 100;
  const sharpAmount = (options.sharpness ?? 40) / 100;
  const vibrance = (options.vibrance ?? 30) / 100;
  const total = width * height;

  // Build luminance histogram for 1% auto-levels stretch
  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const lum = clamp(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
    hist[lum]++;
  }
  const clipCount = Math.floor(total * 0.01);
  let low = 0, high = 255, acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= clipCount) { low = i; break; }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc >= clipCount) { high = i; break; }
  }
  const range = Math.max(24, high - low);

  const leveled = new Uint8ClampedArray(data.length);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    let r = data[p], g = data[p + 1], b = data[p + 2];

    const sr = ((r - low) * 255) / range;
    const sg = ((g - low) * 255) / range;
    const sb = ((b - low) * 255) / range;

    r = r + (sr - r) * strength;
    g = g + (sg - g) * strength;
    b = b + (sb - b) * strength;

    // Smart vibrance (boosts low-saturation pixels more than already saturated ones)
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const avg = (r + g + b) / 3;
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    const vibBoost = vibrance * (1 - sat) * 1.1;

    leveled[p] = clamp(r + (r - avg) * vibBoost);
    leveled[p + 1] = clamp(g + (g - avg) * vibBoost);
    leveled[p + 2] = clamp(b + (b - avg) * vibBoost);
    leveled[p + 3] = data[p + 3];
  }

  self.postMessage({ type: 'progress', value: 65 });

  if (sharpAmount <= 0.02) {
    return new ImageData(leveled, width, height);
  }

  // Unsharp mask 3x3 sharpening pass
  const out = new Uint8ClampedArray(leveled);
  const amt = sharpAmount * 0.85;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = leveled[idx + c];
        const blur =
          (leveled[idx - 4 + c] +
            leveled[idx + 4 + c] +
            leveled[idx - width * 4 + c] +
            leveled[idx + width * 4 + c]) *
          0.25;
        out[idx + c] = clamp(center + (center - blur) * amt);
      }
    }
  }

  return new ImageData(out, width, height);
}

function boxBlur(data, width, height, radius) {
  const r = Math.max(1, Math.min(30, Math.round(radius)));
  const temp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  const div = r * 2 + 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let k = -r; k <= r; k++) {
        const xx = Math.max(0, Math.min(width - 1, x + k));
        const p = (y * width + xx) * 4;
        sr += data[p];
        sg += data[p + 1];
        sb += data[p + 2];
        sa += data[p + 3];
      }
      const p = (y * width + x) * 4;
      temp[p] = sr / div;
      temp[p + 1] = sg / div;
      temp[p + 2] = sb / div;
      temp[p + 3] = sa / div;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let k = -r; k <= r; k++) {
        const yy = Math.max(0, Math.min(height - 1, y + k));
        const p = (yy * width + x) * 4;
        sr += temp[p];
        sg += temp[p + 1];
        sb += temp[p + 2];
        sa += temp[p + 3];
      }
      const p = (y * width + x) * 4;
      out[p] = sr / div;
      out[p + 1] = sg / div;
      out[p + 2] = sb / div;
      out[p + 3] = sa / div;
    }
  }
  return out;
}

function applyFilter(imageData, options) {
  const { width, height, data } = imageData;
  const filter = options.filter || 'none';
  const intensity = (options.intensity ?? 50) / 100;
  let out = new Uint8ClampedArray(data);

  if (filter === 'blur') {
    const rad = Math.max(1, Math.round(intensity * 22));
    // Two box blur passes approximate Gaussian blur smoothly
    out = boxBlur(out, width, height, rad);
    self.postMessage({ type: 'progress', value: 55 });
    out = boxBlur(out, width, height, Math.max(1, Math.round(rad * 0.7)));
    return new ImageData(out, width, height);
  }

  if (filter === 'pixelate') {
    const block = Math.max(3, Math.round(intensity * 36));
    for (let y = 0; y < height; y += block) {
      for (let x = 0; x < width; x += block) {
        const sx = Math.min(width - 1, x + Math.floor(block / 2));
        const sy = Math.min(height - 1, y + Math.floor(block / 2));
        const sp = (sy * width + sx) * 4;
        const r = data[sp], g = data[sp + 1], b = data[sp + 2], a = data[sp + 3];
        for (let dy = 0; dy < block && y + dy < height; dy++) {
          for (let dx = 0; dx < block && x + dx < width; dx++) {
            const p = ((y + dy) * width + (x + dx)) * 4;
            out[p] = r;
            out[p + 1] = g;
            out[p + 2] = b;
            out[p + 3] = a;
          }
        }
      }
    }
    return new ImageData(out, width, height);
  }

  if (filter === 'sharpen' || filter === 'emboss') {
    const kernel =
      filter === 'sharpen'
        ? [0, -1, 0, -1, 5, -1, 0, -1, 0]
        : [-2, -1, 0, -1, 1, 1, 0, 1, 2];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          let k = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const p = ((y + ky) * width + (x + kx)) * 4;
              sum += data[p + c] * kernel[k++];
            }
          }
          out[idx + c] = clamp(data[idx + c] * (1 - intensity) + sum * intensity);
        }
      }
    }
    return new ImageData(out, width, height);
  }

  for (let i = 0; i < out.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let nr = r, ng = g, nb = b;
    if (filter === 'grayscale') {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      nr = ng = nb = lum;
    } else if (filter === 'sepia') {
      nr = 0.393 * r + 0.769 * g + 0.189 * b;
      ng = 0.349 * r + 0.686 * g + 0.168 * b;
      nb = 0.272 * r + 0.534 * g + 0.131 * b;
    } else if (filter === 'vintage') {
      nr = r * 1.08 + 14;
      ng = g * 0.96 + 8;
      nb = b * 0.78 + 20;
    } else if (filter === 'cool') {
      nr = r * 0.88;
      ng = g * 1.02;
      nb = b * 1.18 + 10;
    } else if (filter === 'warm') {
      nr = r * 1.14 + 10;
      ng = g * 1.03 + 4;
      nb = b * 0.84;
    } else if (filter === 'noir') {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const c = ((lum / 255 - 0.5) * 1.45 + 0.5) * 255;
      nr = ng = nb = c;
    } else if (filter === 'invert') {
      nr = 255 - r;
      ng = 255 - g;
      nb = 255 - b;
    }
    out[i] = clamp(r + (nr - r) * intensity);
    out[i + 1] = clamp(g + (ng - g) * intensity);
    out[i + 2] = clamp(b + (nb - b) * intensity);
  }
  return new ImageData(out, width, height);
}

self.onmessage = (event) => {
  const { id, action, imageData, options } = event.data;
  try {
    let result;
    if (action === 'removeBackground') {
      result = removeBackground(imageData, options || {});
    } else if (action === 'enhancePhoto') {
      result = enhancePhoto(imageData, options || {});
    } else if (action === 'applyFilter') {
      result = applyFilter(imageData, options || {});
    } else {
      throw new Error('Unknown image worker action: ' + action);
    }
    self.postMessage({ id, type: 'done', imageData: result }, [result.data.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err.message || String(err) });
  }
};
