/** Box dilation of a binary mask by r pixels (square window), done in two cheap passes. */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const rowPre = new Uint32Array(w + 1);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) rowPre[x + 1] = rowPre[x] + (mask[o + x] ? 1 : 0);
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r);
      const b = Math.min(w, x + r + 1);
      tmp[o + x] = rowPre[b] - rowPre[a] > 0 ? 1 : 0;
    }
  }
  const colPre = new Uint32Array(h + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) colPre[y + 1] = colPre[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r);
      const b = Math.min(h, y + r + 1);
      out[y * w + x] = colPre[b] - colPre[a] > 0 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Fills the masked pixels from the surrounding picture: layer by layer from the edge inward,
 * then a few smoothing passes so the patch blends into the background.
 */
export function inpaint(img: ImageData, mask: Uint8Array): void {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const known = new Uint8Array(n);
  let unknownCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i]) unknownCount++;
    else known[i] = 1;
  }
  if (unknownCount === 0 || unknownCount === n) return;

  const queued = new Uint8Array(n);
  const order: number[] = [];
  let layer: number[] = [];

  const touchesKnown = (p: number) => {
    const x = p % w;
    const y = (p - x) / w;
    return (
      (x > 0 && known[p - 1]) ||
      (x < w - 1 && known[p + 1]) ||
      (y > 0 && known[p - w]) ||
      (y < h - 1 && known[p + w])
    );
  };
  for (let p = 0; p < n; p++) {
    if (!known[p] && touchesKnown(p)) {
      queued[p] = 1;
      layer.push(p);
    }
  }

  while (layer.length) {
    const next: number[] = [];
    for (const p of layer) {
      const x = p % w;
      const y = (p - x) / w;
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
          const q = yy * w + xx;
          if (!known[q]) continue;
          const k = q * 4;
          r += data[k];
          g += data[k + 1];
          b += data[k + 2];
          c++;
        }
      }
      const k = p * 4;
      if (c) {
        data[k] = r / c;
        data[k + 1] = g / c;
        data[k + 2] = b / c;
      }
      data[k + 3] = 255;
      order.push(p);
    }
    for (const p of layer) {
      known[p] = 1;
      const x = p % w;
      const y = (p - x) / w;
      const push = (q: number) => {
        if (!known[q] && !queued[q] && mask[q]) {
          queued[q] = 1;
          next.push(q);
        }
      };
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    layer = next;
  }

  const passes = order.length > 600000 ? 8 : order.length > 150000 ? 16 : 28;
  for (let it = 0; it < passes; it++) {
    for (const p of order) {
      const x = p % w;
      const y = (p - x) / w;
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
          const k = (yy * w + xx) * 4;
          r += data[k];
          g += data[k + 1];
          b += data[k + 2];
          c++;
        }
      }
      const k = p * 4;
      data[k] = r / c;
      data[k + 1] = g / c;
      data[k + 2] = b / c;
    }
  }
}

/**
 * Looks inside the area the player circled and finds what does not belong to the background
 * (letters, small decorations). Returns the exact pixels to clear.
 */
export function detectForeground(img: ImageData, rough: Uint8Array, grow: number, threshold = 60): Uint8Array {
  const { width: w, height: h } = img;
  const area = dilate(rough, w, h, grow);
  const estimate = new ImageData(new Uint8ClampedArray(img.data), w, h);
  inpaint(estimate, area);
  const found = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (!area[i]) continue;
    const k = i * 4;
    const d =
      Math.abs(img.data[k] - estimate.data[k]) +
      Math.abs(img.data[k + 1] - estimate.data[k + 1]) +
      Math.abs(img.data[k + 2] - estimate.data[k + 2]);
    if (d > threshold) {
      found[i] = 1;
      count++;
    }
  }
  if (count < 20) return dilate(rough, w, h, 2);
  const grown = dilate(found, w, h, 3);
  for (let i = 0; i < grown.length; i++) if (!area[i]) grown[i] = 0;
  return grown;
}
