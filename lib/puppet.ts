export type JointKey =
  | "head"
  | "neck"
  | "shL"
  | "shR"
  | "elL"
  | "elR"
  | "wrL"
  | "wrR"
  | "hipL"
  | "hipR"
  | "knL"
  | "knR"
  | "anL"
  | "anR";

export interface Pt {
  x: number;
  y: number;
}

export type Joints = Record<JointKey, Pt>;

export const JOINT_KEYS: JointKey[] = ["head", "neck", "shL", "shR", "elL", "elR", "wrL", "wrR", "hipL", "hipR", "knL", "knR", "anL", "anR"];

export const JOINT_LABEL: Record<JointKey, { zh: string; en: string }> = {
  head: { zh: "頭", en: "Head" },
  neck: { zh: "頸", en: "Neck" },
  shL: { zh: "左肩", en: "Left shoulder" },
  shR: { zh: "右肩", en: "Right shoulder" },
  elL: { zh: "左肘", en: "Left elbow" },
  elR: { zh: "右肘", en: "Right elbow" },
  wrL: { zh: "左手", en: "Left hand" },
  wrR: { zh: "右手", en: "Right hand" },
  hipL: { zh: "左髖", en: "Left hip" },
  hipR: { zh: "右髖", en: "Right hip" },
  knL: { zh: "左膝", en: "Left knee" },
  knR: { zh: "右膝", en: "Right knee" },
  anL: { zh: "左腳", en: "Left foot" },
  anR: { zh: "右腳", en: "Right foot" },
};

// Canonical standing skeleton: y spans the body height (0..1), x is an offset from the body centre line (0.5).
const CANON: Joints = {
  head: { x: 0.5, y: 0.1 },
  neck: { x: 0.5, y: 0.19 },
  shL: { x: 0.4, y: 0.22 },
  shR: { x: 0.6, y: 0.22 },
  elL: { x: 0.36, y: 0.37 },
  elR: { x: 0.64, y: 0.37 },
  wrL: { x: 0.34, y: 0.5 },
  wrR: { x: 0.66, y: 0.5 },
  hipL: { x: 0.45, y: 0.52 },
  hipR: { x: 0.55, y: 0.52 },
  knL: { x: 0.44, y: 0.72 },
  knR: { x: 0.56, y: 0.72 },
  anL: { x: 0.43, y: 0.92 },
  anR: { x: 0.57, y: 0.92 },
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function fitJoints(pw: number, ph: number, face?: { cx: number; cy: number; h: number }): Joints {
  const out = {} as Joints;
  let k: number;
  let hx: number;
  let hy: number;
  if (face) {
    k = (0.75 * face.h * ph) / (CANON.neck.y - CANON.head.y);
    hx = face.cx * pw;
    hy = face.cy * ph;
  } else {
    k = ph * 0.9;
    hx = pw / 2;
    hy = ph * 0.1;
  }
  for (const key of JOINT_KEYS) {
    const d = CANON[key];
    out[key] = {
      x: clamp01((hx + (d.x - CANON.head.x) * k) / pw),
      y: clamp01((hy + (d.y - CANON.head.y) * k) / ph),
    };
  }
  return out;
}

interface Pose {
  dx: number;
  dy: number;
  rot: number;
  head: number;
  armL: [number, number];
  armR: [number, number];
  legL: [number, number];
  legR: [number, number];
}

export interface PuppetMotion {
  id: string;
  zh: string;
  en: string;
  keywords: string[];
  seconds: number;
  pose: (p: number) => Pose;
}

const REST: Pose = { dx: 0, dy: 0, rot: 0, head: 0, armL: [0, 0], armR: [0, 0], legL: [0, 0], legR: [0, 0] };

export const PUPPET_SECONDS = 4;

export const PUPPET_MOTIONS: PuppetMotion[] = [
  {
    id: "sing",
    zh: "唱歌",
    en: "Sing",
    keywords: ["唱", "歌", "sing", "song"],
    seconds: PUPPET_SECONDS,
    pose: (p) => ({
      ...REST,
      dy: -Math.abs(Math.sin(p)) * 0.008,
      head: Math.sin(p) * 0.09,
      armR: [0.55 + 0.08 * Math.sin(p * 2), -1.7],
      armL: [0.12 + 0.05 * Math.sin(p), 0],
    }),
  },
  {
    id: "dance",
    zh: "跳舞",
    en: "Dance",
    keywords: ["舞", "dance"],
    seconds: PUPPET_SECONDS,
    pose: (p) => ({
      ...REST,
      rot: Math.sin(p) * 0.05,
      dy: -Math.abs(Math.sin(p * 2)) * 0.02,
      head: Math.sin(p) * 0.1,
      armL: [1.2 + 0.5 * Math.sin(p), 0.35],
      armR: [1.2 + 0.5 * Math.sin(p + Math.PI), 0.35],
      legL: [0.1 * Math.sin(p), 0],
      legR: [0.1 * Math.sin(p + Math.PI), 0],
    }),
  },
  {
    id: "exercise",
    zh: "運動",
    en: "Exercise",
    keywords: ["運動", "健身", "體操", "跳躍", "exercise", "workout", "jump"],
    seconds: PUPPET_SECONDS,
    pose: (p) => {
      const u = (1 - Math.cos(p * 2)) / 2;
      return { ...REST, dy: -u * 0.025, armL: [u * 2.6, 0], armR: [u * 2.6, 0], legL: [u * 0.3, 0], legR: [u * 0.3, 0] };
    },
  },
  {
    id: "walk",
    zh: "散步",
    en: "Walk",
    keywords: ["走", "散步", "walk", "stroll"],
    seconds: PUPPET_SECONDS,
    pose: (p) => ({
      ...REST,
      dy: -Math.abs(Math.sin(p * 2)) * 0.012,
      dx: Math.sin(p) * 0.008,
      armL: [-Math.sin(p * 2) * 0.28, 0],
      armR: [Math.sin(p * 2) * 0.28, 0],
      legL: [Math.sin(p * 2) * 0.3, Math.max(0, -Math.sin(p * 2)) * -0.3],
      legR: [-Math.sin(p * 2) * 0.3, Math.max(0, Math.sin(p * 2)) * -0.3],
    }),
  },
  {
    id: "chat",
    zh: "聊天",
    en: "Chat",
    keywords: ["聊", "說話", "講", "chat", "talk"],
    seconds: PUPPET_SECONDS,
    pose: (p) => ({
      ...REST,
      head: Math.sin(p * 2) * 0.06,
      armR: [0.7 + 0.25 * Math.sin(p * 2), -0.9 + 0.35 * Math.cos(p * 2)],
      armL: [0.06, 0],
    }),
  },
  {
    id: "sway",
    zh: "擺動",
    en: "Sway",
    keywords: ["擺", "搖", "sway", "swing"],
    seconds: PUPPET_SECONDS,
    pose: (p) => ({
      ...REST,
      rot: Math.sin(p) * 0.06,
      dx: Math.sin(p) * 0.02,
      head: -Math.sin(p) * 0.05,
      armL: [0.2 + 0.12 * Math.sin(p), 0],
      armR: [0.2 - 0.12 * Math.sin(p), 0],
    }),
  },
];

export function pickPuppetMotion(text: string): PuppetMotion | null {
  const t = text.toLowerCase();
  return PUPPET_MOTIONS.find((m) => m.keywords.some((k) => t.includes(k))) ?? null;
}

export function photoPlacement(pw: number, ph: number, cw: number, ch: number) {
  const s = Math.min(cw / pw, ch / ph);
  return { s, ox: (cw - pw * s) / 2, oy: (ch - ph * s) / 2 };
}

function rotateAbout(ctx: CanvasRenderingContext2D, c: Pt, a: number) {
  ctx.translate(c.x, c.y);
  ctx.rotate(a);
  ctx.translate(-c.x, -c.y);
}

function clipCapsule(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  ctx.beginPath();
  ctx.moveTo(a.x + nx, a.y + ny);
  ctx.lineTo(b.x + nx, b.y + ny);
  ctx.lineTo(b.x - nx, b.y - ny);
  ctx.lineTo(a.x - nx, a.y - ny);
  ctx.closePath();
  ctx.moveTo(a.x + w, a.y);
  ctx.arc(a.x, a.y, w, 0, Math.PI * 2);
  ctx.moveTo(b.x + w, b.y);
  ctx.arc(b.x, b.y, w, 0, Math.PI * 2);
  ctx.clip();
}

function drawLimb(ctx: CanvasRenderingContext2D, photo: HTMLCanvasElement, root: Pt, mid: Pt, tip: Pt, sign: number, a1: number, a2: number, w: number) {
  const reach = { x: tip.x + (tip.x - mid.x) * 0.3, y: tip.y + (tip.y - mid.y) * 0.3 };
  ctx.save();
  rotateAbout(ctx, root, sign * a1);
  ctx.save();
  clipCapsule(ctx, root, mid, w);
  ctx.drawImage(photo, 0, 0);
  ctx.restore();
  rotateAbout(ctx, mid, sign * a2);
  ctx.save();
  clipCapsule(ctx, mid, reach, w);
  ctx.drawImage(photo, 0, 0);
  ctx.restore();
  ctx.restore();
}

const BONES: [JointKey, JointKey][] = [
  ["head", "neck"],
  ["neck", "shL"],
  ["neck", "shR"],
  ["shL", "elL"],
  ["elL", "wrL"],
  ["shR", "elR"],
  ["elR", "wrR"],
  ["shL", "hipL"],
  ["shR", "hipR"],
  ["hipL", "hipR"],
  ["hipL", "knL"],
  ["knL", "anL"],
  ["hipR", "knR"],
  ["knR", "anR"],
];

const blurCache = new WeakMap<HTMLCanvasElement, Map<number, HTMLCanvasElement>>();

function blurredOf(photo: HTMLCanvasElement, sw = 28): HTMLCanvasElement {
  let bySize = blurCache.get(photo);
  if (!bySize) {
    bySize = new Map();
    blurCache.set(photo, bySize);
  }
  const hit = bySize.get(sw);
  if (hit) return hit;
  const sh = Math.max(8, Math.round((photo.height / photo.width) * sw));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d");
  if (sctx) {
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(photo, 0, 0, sw, sh);
  }
  bySize.set(sw, small);
  return small;
}

let baseCanvas: HTMLCanvasElement | null = null;

export const GROUP_COLORS = ["#ffb020", "#1fb5a8", "#a855f7", "#ec4899", "#84cc16", "#f97316", "#06b6d4", "#8b5cf6"];

export interface CustomSwing {
  pivot: Pt;
  swing: Pt;
  angle: number;
}

export type CustomPart = "head" | "torso" | "armL" | "armR" | "legL" | "legR" | "free";

export const PART_LABEL: Record<CustomPart, string> = {
  head: "頭部",
  torso: "身體",
  armL: "左手臂",
  armR: "右手臂",
  legL: "左腿",
  legR: "右腿",
  free: "自由點（未對到人體）",
};

export interface CustomRegion {
  part: CustomPart;
  pv: Pt;
  segs: [Pt, Pt][];
  width: number;
  circle?: { c: Pt; r: number };
}

function segDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function resolveCustom(c: CustomSwing, joints: Joints, pw: number, ph: number, customW: number): CustomRegion {
  const J = (k: JointKey): Pt => ({ x: joints[k].x * pw, y: joints[k].y * ph });
  const pv = { x: c.pivot.x * pw, y: c.pivot.y * ph };
  const sw = { x: c.swing.x * pw, y: c.swing.y * ph };
  const hd = J("head");
  const nk = J("neck");
  const hr = Math.hypot(hd.x - nk.x, hd.y - nk.y) * 1.05;
  const shL = J("shL");
  const shR = J("shR");
  const hipMid = lerpPt(J("hipL"), J("hipR"), 0.5);
  const shMid = lerpPt(shL, shR, 0.5);
  const shoulderW = Math.hypot(shL.x - shR.x, shL.y - shR.y);
  const score = (d: (p: Pt) => number) => d(sw) + d(pv) * 0.5;

  const limbs: { part: CustomPart; root: Pt; mid: Pt; tip: Pt }[] = [
    { part: "armL", root: shL, mid: J("elL"), tip: J("wrL") },
    { part: "armR", root: shR, mid: J("elR"), tip: J("wrR") },
    { part: "legL", root: J("hipL"), mid: J("knL"), tip: J("anL") },
    { part: "legR", root: J("hipR"), mid: J("knR"), tip: J("anR") },
  ];

  let best: { part: CustomPart; s: number } = {
    part: "head",
    s: score((p) => Math.max(0, Math.hypot(p.x - hd.x, p.y - hd.y) - hr)),
  };
  const torsoS = score((p) => Math.max(0, segDistance(p, shMid, hipMid) - shoulderW * 0.4));
  if (torsoS < best.s) best = { part: "torso", s: torsoS };
  for (const l of limbs) {
    const s = score((p) => Math.min(segDistance(p, l.root, l.mid), segDistance(p, l.mid, l.tip)));
    if (s < best.s) best = { part: l.part, s };
  }

  if (best.s > pw * 0.2) {
    const reach = { x: pv.x + (sw.x - pv.x) * 1.2, y: pv.y + (sw.y - pv.y) * 1.2 };
    return { part: "free", pv, segs: [[pv, reach]], width: customW };
  }
  if (best.part === "head") {
    return { part: "head", pv: nk, segs: [], width: customW, circle: { c: hd, r: hr } };
  }
  if (best.part === "torso") {
    return { part: "torso", pv: hipMid, segs: [[hipMid, shMid]], width: shoulderW * 0.85 };
  }
  const limb = limbs.find((l) => l.part === best.part) as (typeof limbs)[number];
  const reachTip = { x: limb.tip.x + (limb.tip.x - limb.mid.x) * 0.3, y: limb.tip.y + (limb.tip.y - limb.mid.y) * 0.3 };
  const width = customW * (best.part.startsWith("leg") ? 1.2 : 1);
  const lowerOnly = Math.hypot(pv.x - limb.mid.x, pv.y - limb.mid.y) < Math.hypot(pv.x - limb.root.x, pv.y - limb.root.y);
  if (lowerOnly) {
    return { part: best.part, pv: limb.mid, segs: [[limb.mid, reachTip]], width };
  }
  return { part: best.part, pv: limb.root, segs: [[limb.root, limb.mid], [limb.mid, reachTip]], width };
}

export interface OpenPoint {
  c: Pt;
  r: number;
  amount: number;
  mode: "mouth" | "eye";
}

export interface PuppetFx {
  customs?: CustomSwing[];
  opens?: OpenPoint[];
  selectedOpen?: number;
  size?: number;
  blend?: number;
  feather?: number;
  width?: number;
  showPins?: boolean;
  pending?: Pt | null;
  selected?: number;
  target?: "pending" | { i: number; which: "pivot" | "swing" } | { joint: JointKey } | null;
}

function scalePose(p: Pose, k: number): Pose {
  return {
    dx: p.dx * k,
    dy: p.dy * k,
    rot: p.rot * k,
    head: p.head * k,
    armL: [p.armL[0] * k, p.armL[1] * k],
    armR: [p.armR[0] * k, p.armR[1] * k],
    legL: [p.legL[0] * k, p.legL[1] * k],
    legR: [p.legR[0] * k, p.legR[1] * k],
  };
}

function eraseSoftLine(tctx: CanvasRenderingContext2D, a: Pt, b: Pt, w: number, amount: number, feather = 0.5) {
  if (amount <= 0.01) return;
  tctx.lineCap = "round";
  tctx.strokeStyle = "#000";
  for (let i = 0; i < 4; i++) {
    tctx.globalAlpha = Math.min(1, amount) * 0.5;
    tctx.lineWidth = w * Math.max(0.3, 0.96 - i * (0.07 + feather * 0.08));
    tctx.beginPath();
    tctx.moveTo(a.x, a.y);
    tctx.lineTo(b.x, b.y);
    tctx.stroke();
  }
  tctx.globalAlpha = 1;
}

function eraseSoftCircle(tctx: CanvasRenderingContext2D, c: Pt, r: number, amount: number) {
  if (amount <= 0.01) return;
  const g = tctx.createRadialGradient(c.x, c.y, r * 0.7, c.x, c.y, r);
  g.addColorStop(0, `rgba(0,0,0,${Math.min(1, amount)})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  tctx.fillStyle = g;
  tctx.beginPath();
  tctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  tctx.fill();
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function drawPuppet(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  photo: HTMLCanvasElement,
  joints: Joints,
  motion: PuppetMotion | null,
  seconds: number,
  showJoints: boolean,
  layers?: { bg: HTMLCanvasElement; fg: HTMLCanvasElement },
  ghostFade = 0.85,
  fx: PuppetFx = {},
) {
  const src = layers?.fg ?? photo;
  const pw = photo.width;
  const ph = photo.height;
  const { s, ox, oy } = photoPlacement(pw, ph, cw, ch);
  const P = (k: JointKey): Pt => ({ x: joints[k].x * pw, y: joints[k].y * ph });
  const sizeK = fx.size ?? 1;
  const feather = fx.feather ?? 0.5;
  const customs = fx.customs ?? [];
  const active = !!motion || customs.length > 0;
  const phase = (seconds / PUPPET_SECONDS) * Math.PI * 2;
  const pose = motion ? scalePose(motion.pose((seconds / motion.seconds) * Math.PI * 2), sizeK) : REST;
  const customW = pw * (fx.width ?? 0.05);
  const customGeo = customs.map((c, i) => {
    const region = resolveCustom(c, joints, pw, ph, customW);
    const rad = ((c.angle * Math.PI) / 180) * sizeK;
    return { ...region, rad, offset: i * 0.9 };
  });

  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, 0, cw, ch);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  ctx.drawImage(layers ? layers.bg : blurredOf(photo, Math.round(140 - (fx.blend ?? 0.5) * 110)), 0, 0, pw, ph);

  const hipMid = { x: (P("hipL").x + P("hipR").x) / 2, y: (P("hipL").y + P("hipR").y) / 2 };
  ctx.translate(hipMid.x + pose.dx * pw, hipMid.y + pose.dy * ph);
  ctx.rotate(pose.rot);
  ctx.translate(-hipMid.x, -hipMid.y);

  const armW = pw * 0.045;
  const legW = pw * 0.055;
  let base: HTMLCanvasElement = src;
  if (active && ghostFade > 0.01) {
    if (!baseCanvas) baseCanvas = document.createElement("canvas");
    if (baseCanvas.width !== pw || baseCanvas.height !== ph) {
      baseCanvas.width = pw;
      baseCanvas.height = ph;
    }
    const tctx = baseCanvas.getContext("2d");
    if (tctx) {
      tctx.globalCompositeOperation = "source-over";
      tctx.globalAlpha = 1;
      tctx.clearRect(0, 0, pw, ph);
      tctx.drawImage(src, 0, 0);
      tctx.globalCompositeOperation = "destination-out";
      const moved = (a1: number, a2: number) => Math.min(1, ((Math.abs(a1) + Math.abs(a2)) / 0.1) * ghostFade);
      const limb = (root: Pt, mid: Pt, tip: Pt, a1: number, a2: number, w: number) => {
        const amount = moved(a1, a2);
        const reach = { x: tip.x + (tip.x - mid.x) * 0.3, y: tip.y + (tip.y - mid.y) * 0.3 };
        eraseSoftLine(tctx, lerpPt(root, mid, 0.25), mid, w, amount, feather);
        eraseSoftLine(tctx, mid, reach, w, amount, feather);
      };
      for (const g of customGeo) {
        const amount = Math.min(1, (g.rad * Math.abs(Math.sin(phase + g.offset))) / 0.03) * ghostFade;
        g.segs.forEach(([a, b], idx) => {
          eraseSoftLine(tctx, idx === 0 ? lerpPt(a, b, 0.12) : a, b, g.width, amount, feather);
        });
        if (g.circle) eraseSoftCircle(tctx, g.circle.c, g.circle.r, amount);
      }
      limb(P("hipL"), P("knL"), P("anL"), pose.legL[0], pose.legL[1], legW);
      limb(P("hipR"), P("knR"), P("anR"), pose.legR[0], pose.legR[1], legW);
      limb(P("shL"), P("elL"), P("wrL"), pose.armL[0], pose.armL[1], armW);
      limb(P("shR"), P("elR"), P("wrR"), pose.armR[0], pose.armR[1], armW);
      const hd = P("head");
      const nk = P("neck");
      const hr = Math.hypot(hd.x - nk.x, hd.y - nk.y) * 1.05;
      eraseSoftCircle(tctx, hd, hr, Math.min(1, (Math.abs(pose.head) / 0.05) * ghostFade));
      tctx.globalCompositeOperation = "source-over";
      base = baseCanvas;
    }
  }
  ctx.drawImage(base, 0, 0);

  if (motion) {
    drawLimb(ctx, src, P("hipL"), P("knL"), P("anL"), 1, pose.legL[0], pose.legL[1], legW);
    drawLimb(ctx, src, P("hipR"), P("knR"), P("anR"), -1, pose.legR[0], pose.legR[1], legW);
    drawLimb(ctx, src, P("shL"), P("elL"), P("wrL"), 1, pose.armL[0], pose.armL[1], armW);
    drawLimb(ctx, src, P("shR"), P("elR"), P("wrR"), -1, pose.armR[0], pose.armR[1], armW);
    const head = P("head");
    const neck = P("neck");
    const r = Math.hypot(head.x - neck.x, head.y - neck.y) * 1.05;
    ctx.save();
    rotateAbout(ctx, neck, pose.head);
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  }
  for (const g of customGeo) {
    const angle = Math.sin(phase + g.offset) * g.rad;
    for (const [a, b] of g.segs) {
      ctx.save();
      rotateAbout(ctx, g.pv, angle);
      clipCapsule(ctx, a, b, g.width);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
    if (g.circle) {
      ctx.save();
      rotateAbout(ctx, g.pv, angle);
      ctx.beginPath();
      ctx.arc(g.circle.c.x, g.circle.c.y, g.circle.r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
  }
  (fx.opens ?? []).forEach((o, i) => {
    const c = { x: o.c.x * pw, y: o.c.y * ph };
    const r = o.r * pw;
    const wave = (1 - Math.cos(phase + i * 0.9)) / 2;
    const d = r * o.amount * (o.mode === "eye" ? Math.pow(wave, 6) : wave);
    if (d < 0.5) return;
    if (o.mode === "mouth") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#2a0d12";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + d / 2, r * 0.85, d / 2 + 1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(0, d);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    if (o.mode === "mouth") ctx.rect(c.x - r, c.y, r * 2, r);
    else ctx.rect(c.x - r, c.y - r, r * 2, r);
    ctx.clip();
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  });
  ctx.restore();

  if (fx.showPins) {
    const toS = (p: Pt): Pt => ({ x: ox + p.x * pw * s, y: oy + p.y * ph * s });
    const r = Math.max(8, cw * 0.014);
    const dot = (p: Pt, color: string) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    };
    const anySelected = fx.selected !== undefined && fx.selected >= 0 && fx.selected < customs.length;
    const label = (p: Pt, text: string, color: string, big: boolean) => {
      const lr = r * (big ? 1.5 : 1.15);
      ctx.beginPath();
      ctx.arc(p.x + r * 1.9, p.y - r * 1.9, lr, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(lr * 1.3)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, p.x + r * 1.9, p.y - r * 1.9 + 1);
    };
    (fx.opens ?? []).forEach((o, i) => {
      const p = toS(o.c);
      ctx.save();
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = i === fx.selectedOpen ? 4 : 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, o.r * pw * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      dot(p, "#22c55e");
      label(p, o.mode === "eye" ? "眼" : "嘴", "#22c55e", i === fx.selectedOpen);
    });
    const order = customs.map((_, i) => i).sort((x, y) => (x === fx.selected ? 1 : 0) - (y === fx.selected ? 1 : 0));
    order.forEach((i) => {
      const c = customs[i];
      const gc = GROUP_COLORS[i % GROUP_COLORS.length];
      const a = toS(c.pivot);
      const b = toS(c.swing);
      const chosen = i === fx.selected;
      const dim = anySelected && !chosen;
      const geo = customGeo[i];
      ctx.save();
      ctx.globalAlpha = chosen ? 0.45 : dim ? 0.1 : 0.25;
      ctx.strokeStyle = gc;
      ctx.fillStyle = gc;
      ctx.lineCap = "round";
      ctx.lineWidth = geo.width * s;
      for (const [p, q] of geo.segs) {
        const sp = toS({ x: p.x / pw, y: p.y / ph });
        const sq = toS({ x: q.x / pw, y: q.y / ph });
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(sq.x, sq.y);
        ctx.stroke();
      }
      if (geo.circle) {
        const cc = toS({ x: geo.circle.c.x / pw, y: geo.circle.c.y / ph });
        ctx.beginPath();
        ctx.arc(cc.x, cc.y, geo.circle.r * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = dim ? 0.45 : 1;
      ctx.lineWidth = chosen ? 6 : 3;
      ctx.strokeStyle = gc;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (chosen) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(a.x, a.y, r * 1.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * 1.8, 0, Math.PI * 2);
        ctx.stroke();
      }
      dot(a, "#ff3b3b");
      dot(b, "#2f8cff");
      label(a, String(i + 1), gc, chosen);
      label(b, String(i + 1), gc, chosen);
      ctx.restore();
    });
    if (fx.pending) dot(toS(fx.pending), "#ff3b3b");
    const tgt = fx.target;
    const tp =
      tgt === "pending"
        ? fx.pending
        : tgt && "joint" in tgt
          ? (joints?.[tgt.joint] ?? null)
          : tgt && customs[tgt.i]
            ? customs[tgt.i][tgt.which]
            : null;
    if (tp) {
      const c = toS(tp);
      const arm = r * 3.4;
      const gap = r * 0.9;
      for (const [w, col] of [[5, "#000000"], [2.5, "#ffffff"]] as const) {
        ctx.lineWidth = w;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * 2.4, 0, Math.PI * 2);
        ctx.moveTo(c.x - arm, c.y);
        ctx.lineTo(c.x - gap, c.y);
        ctx.moveTo(c.x + gap, c.y);
        ctx.lineTo(c.x + arm, c.y);
        ctx.moveTo(c.x, c.y - arm);
        ctx.lineTo(c.x, c.y - gap);
        ctx.moveTo(c.x, c.y + gap);
        ctx.lineTo(c.x, c.y + arm);
        ctx.stroke();
      }
    }
  }

  if (showJoints) {
    const toC = (k: JointKey): Pt => ({ x: ox + joints[k].x * pw * s, y: oy + joints[k].y * ph * s });
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    for (const [a, b] of BONES) {
      const pa = toC(a);
      const pb = toC(b);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    for (const k of JOINT_KEYS) {
      const p = toC(k);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(7, cw * 0.012), 0, Math.PI * 2);
      ctx.fillStyle = k === "head" ? "#ff5d5d" : "#3fb6ff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    }
  }
}
