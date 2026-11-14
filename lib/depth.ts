import type { JointKey, Joints, Pt } from "@/lib/puppet";

const AI_TIMEOUT_MS = 120_000;

function grayCanvas(w: number, h: number, data: ArrayLike<number>, channels: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  if (!x) return c;
  const img = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = data[i * channels];
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

function canvasBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", 0.92);
  });
}

/** Real AI depth estimate (bright = near). Throws when the model cannot be loaded. */
export async function aiEstimateDepth(src: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  const run = async () => {
    const mod = await import("@huggingface/transformers");
    const estimator = await mod.pipeline("depth-estimation", "Xenova/depth-anything-small-hf");
    const url = URL.createObjectURL(await canvasBlob(src));
    try {
      const out = (await estimator(url)) as unknown as {
        depth: { data: ArrayLike<number>; width: number; height: number; channels: number };
      };
      const d = out.depth;
      return grayCanvas(d.width, d.height, d.data, d.channels || 1);
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("ai timeout")), AI_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Built-in fallback: lower parts are nearer, the centre is nearer, and the cut-out person (if any) is the nearest layer. */
export function syntheticDepth(w: number, h: number, cutout?: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  if (!x) return c;
  const lin = x.createLinearGradient(0, 0, 0, h);
  lin.addColorStop(0, "#202020");
  lin.addColorStop(1, "#7a7a7a");
  x.fillStyle = lin;
  x.fillRect(0, 0, w, h);
  const rad = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
  rad.addColorStop(0, "rgba(255,255,255,0.28)");
  rad.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = rad;
  x.fillRect(0, 0, w, h);
  if (cutout) {
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const t = tmp.getContext("2d");
    if (t) {
      t.drawImage(cutout, 0, 0, w, h);
      t.globalCompositeOperation = "source-in";
      t.fillStyle = "#e0e0e0";
      t.fillRect(0, 0, w, h);
      x.save();
      x.filter = `blur(${Math.max(1, w / 120)}px)`;
      x.drawImage(tmp, 0, 0);
      x.restore();
    }
  }
  return c;
}

export interface ParallaxRig {
  w: number;
  h: number;
  color: Uint8ClampedArray;
  depth: Uint8ClampedArray;
  out: ImageData;
  buf: HTMLCanvasElement;
  mdx?: Float32Array;
  mdy?: Float32Array;
  mws?: Float32Array;
}

/** Downsamples the photo and its depth map once so each frame is a cheap per-pixel shift. */
export function makeParallaxRig(photo: HTMLCanvasElement, depth: HTMLCanvasElement, maxSide = 420): ParallaxRig | null {
  const k = Math.min(1, maxSide / Math.max(photo.width, photo.height));
  const w = Math.max(2, Math.round(photo.width * k));
  const h = Math.max(2, Math.round(photo.height * k));
  const read = (src: HTMLCanvasElement) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    if (!x) return null;
    x.drawImage(src, 0, 0, w, h);
    return x.getImageData(0, 0, w, h);
  };
  const a = read(photo);
  const b = read(depth);
  if (!a || !b) return null;
  const d = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) d[i] = b.data[i * 4];
  const buf = document.createElement("canvas");
  buf.width = w;
  buf.height = h;
  const bx = buf.getContext("2d");
  if (!bx) return null;
  return { w, h, color: a.data, depth: d, out: bx.createImageData(w, h), buf };
}

export type CameraPath = "sway" | "vertical" | "orbit" | "push" | "pull";

export interface ParallaxOpts {
  path: CameraPath;
  /** Size of the camera movement. */
  strength: number;
  /** Whole cycles per 4 seconds, so the clip loops seamlessly. */
  speed: number;
  /** Depth plane that stays still, 0 = far, 1 = near. */
  focus: number;
  /** Gentle breathing of the near parts, 0 to 1. */
  breath: number;
  /** Floating light specks, 0 to 1. */
  dust: number;
  /** Which body parts get a small motion, and which kind. */
  micro?: MicroSetting;
  /** Size of the part motions, 0 to 1. */
  microAmount?: number;
  /** Whole cycles per 4 seconds for the part motions. */
  microSpeed?: number;
  /** Skeleton used to find the parts. */
  joints?: Joints | null;
}

export const DEFAULT_PARALLAX: ParallaxOpts = { path: "sway", strength: 1, speed: 1, focus: 0.5, breath: 0, dust: 0, microAmount: 0.6, microSpeed: 1 };

const LOOP_SECONDS = 4;

function frac(v: number) {
  return v - Math.floor(v);
}

function seeded(i: number, k: number) {
  return frac(Math.sin(i * 127.1 + k * 311.7) * 43758.5453);
}

function drawDust(ctx: CanvasRenderingContext2D, cw: number, ch: number, t: number, amount: number) {
  const count = Math.round(8 + amount * 40);
  const u = t / LOOP_SECONDS;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const layer = seeded(i, 1);
    const cyclesY = layer > 0.5 ? 2 : 1;
    const cyclesX = seeded(i, 2) > 0.5 ? 1 : -1;
    const x = frac(seeded(i, 3) + u * cyclesX * 0.5 + Math.sin((u + seeded(i, 4)) * Math.PI * 2) * 0.02);
    const y = frac(seeded(i, 5) - u * cyclesY);
    const r = (0.6 + layer * 2.2) * (cw / 540);
    const twinkle = 0.55 + 0.45 * Math.sin((u * 2 + seeded(i, 6)) * Math.PI * 2);
    ctx.globalAlpha = Math.min(1, (0.25 + layer * 0.45) * amount * twinkle);
    ctx.fillStyle = "#fff6dc";
    ctx.beginPath();
    ctx.arc(x * cw, y * ch, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export type MicroMode = "rotate" | "shift" | "bob" | "swing";

export type MicroPartKey =
  | "whole"
  | "head"
  | "body"
  | "arms"
  | "legs"
  | "eyes"
  | "ears"
  | "mouth"
  | "upperArm"
  | "foreArm"
  | "wrist"
  | "shoulder"
  | "upperBody"
  | "lowerBody"
  | "thigh"
  | "calf";

export type MicroSetting = Partial<Record<MicroPartKey, MicroMode>>;

export const MICRO_PART_LABEL: Record<MicroPartKey, { zh: string; en: string }> = {
  whole: { zh: "全身", en: "Whole body" },
  head: { zh: "頭部", en: "Head" },
  body: { zh: "身體", en: "Body" },
  arms: { zh: "手臂", en: "Arms" },
  legs: { zh: "腳部", en: "Legs" },
  eyes: { zh: "眼", en: "Eyes" },
  ears: { zh: "耳", en: "Ears" },
  mouth: { zh: "口", en: "Mouth" },
  upperArm: { zh: "上臂膀", en: "Upper arm" },
  foreArm: { zh: "下臂", en: "Forearm" },
  wrist: { zh: "手腕", en: "Wrist" },
  shoulder: { zh: "肩膀", en: "Shoulders" },
  upperBody: { zh: "上身", en: "Upper body" },
  lowerBody: { zh: "下身", en: "Lower body" },
  thigh: { zh: "大腿", en: "Thigh" },
  calf: { zh: "小腿", en: "Calf" },
};

export const MICRO_MODE_LABEL: Record<MicroMode, { zh: string; en: string; shortZh: string; shortEn: string }> = {
  rotate: { zh: "左／右旋轉", en: "Rotate left/right", shortZh: "旋轉", shortEn: "Rotate" },
  shift: { zh: "左／右移動", en: "Move left/right", shortZh: "移動", shortEn: "Move" },
  bob: { zh: "前／後晃動", en: "Sway front/back", shortZh: "晃動", shortEn: "Bob" },
  swing: { zh: "鐘擺／搖動", en: "Pendulum swing", shortZh: "搖擺", shortEn: "Swing" },
};

export interface MicroCapsule {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  px: number;
  py: number;
  alt: boolean;
  shared?: Pt;
}

/** Soft part regions in rig pixels, worked out from the skeleton. Eyes, ears and mouth are estimated from the head size. */
export function microCapsules(key: MicroPartKey, j: Joints, w: number, h: number): MicroCapsule[] {
  const P = (k: JointKey): Pt => ({ x: j[k].x * w, y: j[k].y * h });
  const head = P("head");
  const neck = P("neck");
  const hn = Math.max(6, Math.hypot(head.x - neck.x, head.y - neck.y));
  const shL = P("shL");
  const shR = P("shR");
  const elL = P("elL");
  const elR = P("elR");
  const wrL = P("wrL");
  const wrR = P("wrR");
  const hipL = P("hipL");
  const hipR = P("hipR");
  const knL = P("knL");
  const knR = P("knR");
  const anL = P("anL");
  const anR = P("anR");
  const hip = { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 };
  const cap = (a: Pt, b: Pt, r: number, anchor: Pt, alt = false): MicroCapsule => ({ ax: a.x, ay: a.y, bx: b.x, by: b.y, r, px: anchor.x, py: anchor.y, alt });
  const ext = (a: Pt, b: Pt, k: number): Pt => ({ x: b.x + (b.x - a.x) * k, y: b.y + (b.y - a.y) * k });
  switch (key) {
    case "head":
      return [cap(head, head, hn * 1.05, neck)];
    case "eyes":
      return [-1, 1].map((s) => {
        const p = { x: head.x + s * hn * 0.4, y: head.y - hn * 0.1 };
        return cap(p, p, hn * 0.28, neck);
      });
    case "ears":
      return [-1, 1].map((s) => {
        const p = { x: head.x + s * hn * 0.95, y: head.y };
        return cap(p, p, hn * 0.3, neck);
      });
    case "mouth": {
      const p = { x: head.x, y: head.y + hn * 0.45 };
      return [cap(p, p, hn * 0.38, neck)];
    }
    case "shoulder":
      return [cap(neck, shL, hn * 0.45, neck), cap(neck, shR, hn * 0.45, neck)];
    case "upperArm":
      return [cap(shL, elL, hn * 0.32, shL), cap(shR, elR, hn * 0.32, shR, true)];
    case "foreArm":
      return [cap(elL, wrL, hn * 0.3, elL), cap(elR, wrR, hn * 0.3, elR, true)];
    case "wrist":
      return [cap(wrL, ext(elL, wrL, 0.35), hn * 0.28, wrL), cap(wrR, ext(elR, wrR, 0.35), hn * 0.28, wrR, true)];
    case "upperBody":
      return [cap(neck, hip, Math.max(hn * 0.8, Math.abs(shR.x - shL.x) * 0.55), hip)];
    case "lowerBody":
      return [cap(hip, hip, Math.max(hn * 0.8, Math.abs(hipR.x - hipL.x) * 0.9), { x: hip.x, y: hip.y - hn })];
    case "thigh":
      return [cap(hipL, knL, hn * 0.36, hipL), cap(hipR, knR, hn * 0.36, hipR, true)];
    case "calf":
      return [cap(knL, ext(knL, anL, 0.2), hn * 0.3, knL), cap(knR, ext(knR, anR, 0.2), hn * 0.3, knR, true)];
    case "body":
      return [...microCapsules("shoulder", j, w, h), ...microCapsules("upperBody", j, w, h), ...microCapsules("lowerBody", j, w, h)];
    case "arms":
      return [...microCapsules("upperArm", j, w, h), ...microCapsules("foreArm", j, w, h), ...microCapsules("wrist", j, w, h)];
    case "legs":
      return [...microCapsules("thigh", j, w, h), ...microCapsules("calf", j, w, h)];
    case "whole": {
      const feet = { x: (anL.x + anR.x) / 2, y: (anL.y + anR.y) / 2 };
      return (["head", "body", "arms", "legs"] as MicroPartKey[])
        .flatMap((k) => microCapsules(k, j, w, h))
        .map((c) => ({ ...c, alt: false, shared: feet }));
    }
    default:
      return [];
  }
}

function smooth(t: number) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Fills the rig's per-pixel offset fields for the chosen parts; returns false when nothing is chosen. */
function applyMicro(rig: ParallaxRig, opts: ParallaxOpts, t: number): boolean {
  const j = opts.joints;
  const set = opts.micro;
  if (!j || !set) return false;
  const entries = (Object.entries(set) as [MicroPartKey, MicroMode | undefined][]).filter(([, m]) => !!m);
  if (!entries.length) return false;
  const { w, h } = rig;
  if (!rig.mdx || !rig.mdy || !rig.mws) {
    rig.mdx = new Float32Array(w * h);
    rig.mdy = new Float32Array(w * h);
    rig.mws = new Float32Array(w * h);
  }
  const mdx = rig.mdx;
  const mdy = rig.mdy;
  const mws = rig.mws;
  mdx.fill(0);
  mdy.fill(0);
  mws.fill(0);
  const base = (t / LOOP_SECONDS) * (opts.microSpeed ?? 1) * Math.PI * 2;
  const A = opts.microAmount ?? 0.6;
  for (const [key, mode] of entries) {
    if (!mode) continue;
    for (const c of microCapsules(key, j, w, h)) {
      const sn = Math.sin(base + (c.alt ? Math.PI : 0));
      const pivX = c.shared ? c.shared.x : mode === "swing" ? c.px : (c.ax + c.bx) / 2;
      const pivY = c.shared ? c.shared.y : mode === "swing" ? c.py : (c.ay + c.by) / 2;
      let theta = 0;
      let scale = 1;
      let shiftX = 0;
      if (mode === "rotate") theta = sn * 0.16 * A;
      else if (mode === "swing") theta = sn * 0.22 * A;
      else if (mode === "shift") shiftX = sn * c.r * 0.35 * A;
      else scale = 1 + sn * 0.08 * A;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const x0 = Math.max(0, Math.floor(Math.min(c.ax, c.bx) - c.r * 1.3));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(c.ax, c.bx) + c.r * 1.3));
      const y0 = Math.max(0, Math.floor(Math.min(c.ay, c.by) - c.r * 1.3));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(c.ay, c.by) + c.r * 1.3));
      const abx = c.bx - c.ax;
      const aby = c.by - c.ay;
      const len2 = abx * abx + aby * aby;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const tt = len2 > 0 ? Math.min(1, Math.max(0, ((x - c.ax) * abx + (y - c.ay) * aby) / len2)) : 0;
          const e = Math.hypot(x - (c.ax + abx * tt), y - (c.ay + aby * tt)) / c.r;
          if (e >= 1.3) continue;
          const wt = e <= 0.7 ? 1 : 1 - smooth((e - 0.7) / 0.6);
          const dx = x - pivX;
          const dy = y - pivY;
          let sx: number;
          let sy: number;
          if (mode === "shift") {
            sx = x - shiftX;
            sy = y;
          } else if (mode === "bob") {
            sx = pivX + dx / scale;
            sy = pivY + dy / scale;
          } else {
            sx = pivX + dx * cosT + dy * sinT;
            sy = pivY - dx * sinT + dy * cosT;
          }
          const i = y * w + x;
          mdx[i] += wt * (x - sx);
          mdy[i] += wt * (y - sy);
          mws[i] += wt;
        }
      }
    }
  }
  return true;
}

/** Near pixels (bright depth) slide further than far pixels, which reads as a camera moving in front of the photo. */
export function drawParallax(ctx: CanvasRenderingContext2D, cw: number, ch: number, rig: ParallaxRig, t: number, opts: ParallaxOpts) {
  const { w, h, color, depth, out, buf } = rig;
  const phase = (t / LOOP_SECONDS) * opts.speed * Math.PI * 2;
  const S = opts.strength;
  let ax = 0;
  let ay = 0;
  let zoom = 0;
  if (opts.path === "sway") {
    ax = Math.sin(phase) * S * w * 0.035;
    ay = Math.cos(phase) * S * h * 0.018;
  } else if (opts.path === "vertical") {
    ay = Math.sin(phase) * S * h * 0.035;
  } else if (opts.path === "orbit") {
    ax = Math.sin(phase) * S * w * 0.035;
    ay = Math.cos(phase) * S * h * 0.035;
  } else {
    const wave = 0.5 - 0.5 * Math.cos(phase);
    zoom = (opts.path === "push" ? 1 : -1) * S * 0.06 * wave;
  }
  const breath = Math.sin((t / LOOP_SECONDS) * Math.PI * 2 * 2) * opts.breath * 0.012;
  const z = zoom + breath;
  const cx = w / 2;
  const cy = h / 2;
  const o = out.data;
  const hasMicro = applyMicro(rig, opts, t);
  const { mdx, mdy, mws } = rig;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = depth[i] / 255 - opts.focus;
      const k = z * (d + 0.6);
      let mx = 0;
      let my = 0;
      if (hasMicro && mdx && mdy && mws && mws[i] > 0) {
        const n = Math.max(1, mws[i]);
        mx = mdx[i] / n;
        my = mdy[i] / n;
      }
      const sx = Math.min(w - 1, Math.max(0, Math.round(x - ax * d - (x - cx) * k - mx)));
      const sy = Math.min(h - 1, Math.max(0, Math.round(y - ay * d - (y - cy) * k - my)));
      const j = (sy * w + sx) * 4;
      o[i * 4] = color[j];
      o[i * 4 + 1] = color[j + 1];
      o[i * 4 + 2] = color[j + 2];
      o[i * 4 + 3] = 255;
    }
  }
  buf.getContext("2d")?.putImageData(out, 0, 0);
  const s = Math.min(cw / w, ch / h) * 1.06;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(buf, (cw - w * s) / 2, (ch - h * s) / 2, w * s, h * s);
  if (opts.dust > 0) drawDust(ctx, cw, ch, t, opts.dust);
}
