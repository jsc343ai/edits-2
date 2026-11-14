export interface HeadPose {
  x: number;
  y: number;
  size: number;
  rot: number;
}

export interface HeadKey extends HeadPose {
  t: number;
}

export const DEFAULT_HEAD: HeadPose = { x: 0.5, y: 0.25, size: 0.2, rot: 0 };

export function interpolateHead(keys: HeadKey[], t: number): HeadPose | null {
  if (keys.length === 0) return null;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (t <= sorted[0].t) return sorted[0];
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return last;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / (b.t - a.t || 1);
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        size: a.size + (b.size - a.size) * u,
        rot: a.rot + (b.rot - a.rot) * u,
      };
    }
  }
  return last;
}

/** How the template's head moves relative to its first frame; independent of any player's photo. */
export interface MotionKey {
  t: number;
  dx: number;
  dy: number;
  s: number;
  r: number;
}

export function toMotion(keys: HeadKey[]): MotionKey[] {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return [];
  const o = sorted[0];
  return sorted.map((k) => ({
    t: k.t,
    dx: +(k.x - o.x).toFixed(4),
    dy: +(k.y - o.y).toFixed(4),
    s: +(k.size / o.size).toFixed(4),
    r: +(k.rot - o.rot).toFixed(4),
  }));
}

/** Replays the template's motion on top of the pose the player aligned on the first frame. */
export function applyMotion(base: HeadPose, motion: MotionKey[], t: number): HeadPose {
  if (motion.length === 0) return base;
  let m = motion[motion.length - 1];
  if (t <= motion[0].t) {
    m = motion[0];
  } else if (t < m.t) {
    for (let i = 0; i < motion.length - 1; i++) {
      const a = motion[i];
      const b = motion[i + 1];
      if (t >= a.t && t <= b.t) {
        const u = (t - a.t) / (b.t - a.t || 1);
        m = { t, dx: a.dx + (b.dx - a.dx) * u, dy: a.dy + (b.dy - a.dy) * u, s: a.s + (b.s - a.s) * u, r: a.r + (b.r - a.r) * u };
        break;
      }
    }
  }
  return { x: base.x + m.dx, y: base.y + m.dy, size: base.size * m.s, rot: base.rot + m.r };
}

export interface FaceCrop {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const FACE_SIZE = 384;

/** Transparent canvas in face coordinates; painted alpha marks the parts of the face the user erased by hand. */
export function createEraseMask(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = FACE_SIZE;
  c.height = FACE_SIZE;
  return c;
}

export function paintMask(mask: HTMLCanvasElement, u: number, v: number, radius: number, softness: number, restore: boolean) {
  const ctx = mask.getContext("2d");
  if (!ctx) return;
  const inner = Math.max(0, radius * (1 - softness));
  const g = ctx.createRadialGradient(u, v, inner, u, v, radius);
  g.addColorStop(0, "rgba(0,0,0,0.9)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = restore ? "destination-out" : "source-over";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(u, v, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

/** Converts a point on the preview (0-1 range on each axis) into face-canvas pixels for the given head pose. */
export function pointToFace(nx: number, ny: number, head: HeadPose, aspect: number): { u: number; v: number; scale: number } {
  const fh = head.size;
  const dx = (nx - head.x) * aspect;
  const dy = ny - head.y;
  const cos = Math.cos(head.rot);
  const sin = Math.sin(head.rot);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return { u: (lx / fh) * FACE_SIZE + FACE_SIZE / 2, v: (ly / fh) * FACE_SIZE + FACE_SIZE / 2, scale: FACE_SIZE / fh / aspect };
}

export interface FaceStyle {
  /** 0.1-0.7: how far the soft edge reaches into the face. */
  feather: number;
  /** 0.6-1: width of the oval mask. */
  width: number;
  /** 0-0.6: fades the top of the face so the template's hair can show. */
  forehead: number;
  /** 0-0.8: mixes in a blurred copy to smooth the skin. */
  soften: number;
  /** -0.4-0.4: darkens or brightens the face to match the clip. */
  brightness: number;
}

export const DEFAULT_STYLE: FaceStyle = { feather: 0.36, width: 0.8, forehead: 0.2, soften: 0.25, brightness: 0 };

/** Crops the photo to a square, then blends it into a soft oval so it merges with the clip. */
export function prepareFace(img: CanvasImageSource & { width: number; height: number }, crop: FaceCrop, style: FaceStyle = DEFAULT_STYLE, erase?: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = FACE_SIZE;
  c.height = FACE_SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const scale = Math.max(FACE_SIZE / img.width, FACE_SIZE / img.height) * crop.zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (FACE_SIZE - w) / 2 + crop.offsetX * FACE_SIZE, (FACE_SIZE - h) / 2 + crop.offsetY * FACE_SIZE, w, h);

  if (style.soften > 0) {
    const small = document.createElement("canvas");
    small.width = Math.round(FACE_SIZE / 6);
    small.height = Math.round(FACE_SIZE / 6);
    const sctx = small.getContext("2d");
    if (sctx) {
      sctx.drawImage(c, 0, 0, small.width, small.height);
      ctx.globalAlpha = style.soften;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, 0, 0, FACE_SIZE, FACE_SIZE);
      ctx.globalAlpha = 1;
    }
  }

  if (style.brightness !== 0) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = style.brightness > 0 ? `rgba(255,255,255,${style.brightness})` : `rgba(0,0,0,${-style.brightness})`;
    ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  }

  const half = FACE_SIZE / 2;
  ctx.globalCompositeOperation = "destination-in";
  ctx.save();
  ctx.translate(half, half);
  ctx.scale(style.width, 1);
  const outer = half * 0.98;
  const inner = Math.max(half * 0.08, outer - half * style.feather * 1.6);
  const g = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-half / style.width, -half, FACE_SIZE / style.width, FACE_SIZE);
  ctx.restore();

  if (style.forehead > 0) {
    const lg = ctx.createLinearGradient(0, 0, 0, FACE_SIZE);
    lg.addColorStop(0, "rgba(0,0,0,0)");
    lg.addColorStop(Math.max(0.02, Math.min(0.9, style.forehead)), "rgba(0,0,0,1)");
    lg.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, FACE_SIZE, FACE_SIZE);
  }
  if (erase) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(erase, 0, 0);
  }
  ctx.globalCompositeOperation = "source-over";
  return c;
}

export const TRACK_W = 320;

export interface Gray {
  w: number;
  h: number;
  d: Uint8Array;
}

export function toGray(data: Uint8ClampedArray, w: number, h: number): Gray {
  const d = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i++, p += 4) d[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  return { w, h, d };
}

/** Block-matches the patch around (cx, cy) in the previous frame to its best position in the current frame. */
export function trackStep(prev: Gray, cur: Gray, cx: number, cy: number, half: number, radius: number): { cx: number; cy: number; score: number } {
  const { w, h } = prev;
  const px = Math.max(half, Math.min(w - half - 1, Math.round(cx)));
  const py = Math.max(half, Math.min(h - half - 1, Math.round(cy)));
  const side = half * 2 + 1;
  const count = Math.ceil(side / 2) * Math.ceil(side / 2);
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx - half < 0 || ny - half < 0 || nx + half >= w || ny + half >= h) continue;
      let sum = count * 0.4 * (Math.abs(dx) + Math.abs(dy));
      for (let y = -half; y <= half && sum < best; y += 2) {
        const rowPrev = (py + y) * w + px;
        const rowCur = (ny + y) * w + nx;
        for (let x = -half; x <= half; x += 2) sum += Math.abs(prev.d[rowPrev + x] - cur.d[rowCur + x]);
      }
      if (sum < best) {
        best = sum;
        bx = dx;
        by = dy;
      }
    }
  }
  if (!Number.isFinite(best)) return { cx, cy, score: 255 };
  return { cx: cx + bx, cy: cy + by, score: best / count };
}

/** Matches the patch around (sx, sy) in src against positions near (cx, cy) in dst; used to pull the track back to the head's first-frame look. */
export function matchPatch(src: Gray, dst: Gray, sx: number, sy: number, cx: number, cy: number, half: number, radius: number): { cx: number; cy: number; score: number } {
  const { w, h } = src;
  const spx = Math.max(half, Math.min(w - half - 1, Math.round(sx)));
  const spy = Math.max(half, Math.min(h - half - 1, Math.round(sy)));
  const cpx = Math.max(half, Math.min(w - half - 1, Math.round(cx)));
  const cpy = Math.max(half, Math.min(h - half - 1, Math.round(cy)));
  const side = half * 2 + 1;
  const count = Math.ceil(side / 2) * Math.ceil(side / 2);
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cpx + dx;
      const ny = cpy + dy;
      if (nx - half < 0 || ny - half < 0 || nx + half >= w || ny + half >= h) continue;
      let sum = count * 0.15 * (Math.abs(dx) + Math.abs(dy));
      for (let y = -half; y <= half && sum < best; y += 2) {
        const rowSrc = (spy + y) * w + spx;
        const rowDst = (ny + y) * w + nx;
        for (let x = -half; x <= half; x += 2) sum += Math.abs(src.d[rowSrc + x] - dst.d[rowDst + x]);
      }
      if (sum < best) {
        best = sum;
        bx = dx;
        by = dy;
      }
    }
  }
  if (!Number.isFinite(best)) return { cx, cy, score: 255 };
  return { cx: cpx + bx, cy: cpy + by, score: best / count };
}

let scratch: HTMLCanvasElement | null = null;

export function drawSwapFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, face: HTMLCanvasElement | null, head: HeadPose | null, tone: number, opacity = 1) {
  ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
  paintFace(ctx, video, face, head, tone, true, opacity);
}

/** Draws only the face on a transparent canvas, so a visible <video> underneath shows the template. */
export function drawFaceOverlay(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, face: HTMLCanvasElement | null, head: HeadPose | null, tone: number, opacity = 1) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  paintFace(ctx, video, face, head, tone, false, opacity);
}

let sampler: HTMLCanvasElement | null = null;

function paintFace(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, face: HTMLCanvasElement | null, head: HeadPose | null, tone: number, sampleFromCanvas: boolean, opacity: number) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (!face || !head) return;

  const fh = head.size * h;
  const fw = fh * (face.width / face.height);
  const cx = head.x * w;
  const cy = head.y * h;

  scratch ??= document.createElement("canvas");
  scratch.width = face.width;
  scratch.height = face.height;
  const sctx = scratch.getContext("2d");
  if (!sctx) return;
  sctx.clearRect(0, 0, scratch.width, scratch.height);
  sctx.drawImage(face, 0, 0);

  if (tone > 0) {
    try {
      let d: Uint8ClampedArray;
      if (sampleFromCanvas) {
        const sx = Math.max(0, Math.min(w - 8, Math.round(cx - 4)));
        const sy = Math.max(0, Math.min(h - 8, Math.round(cy - 4)));
        d = ctx.getImageData(sx, sy, 8, 8).data;
      } else {
        if (video.readyState < 2 || !video.videoWidth) throw new Error("no frame");
        sampler ??= document.createElement("canvas");
        sampler.width = 8;
        sampler.height = 8;
        const sampleCtx = sampler.getContext("2d", { willReadFrequently: true });
        if (!sampleCtx) throw new Error("no canvas");
        const vx = Math.max(0, Math.min(video.videoWidth - 8, (cx / w) * video.videoWidth - 4));
        const vy = Math.max(0, Math.min(video.videoHeight - 8, (cy / h) * video.videoHeight - 4));
        sampleCtx.drawImage(video, vx, vy, 8, 8, 0, 0, 8, 8);
        d = sampleCtx.getImageData(0, 0, 8, 8).data;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      sctx.globalCompositeOperation = "source-atop";
      sctx.globalAlpha = tone;
      sctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
      sctx.fillRect(0, 0, scratch.width, scratch.height);
      sctx.globalAlpha = 1;
      sctx.globalCompositeOperation = "source-over";
    } catch {
      // Cross-origin video pixels cannot be read; skip the skin-tone match.
    }
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(head.rot);
  ctx.globalAlpha = opacity;
  ctx.drawImage(scratch, -fw / 2, -fh / 2, fw, fh);
  ctx.restore();
}
