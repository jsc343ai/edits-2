export interface MotionDef {
  id: string;
  zh: string;
  en: string;
  keywords: string[];
  backdrop: [string, string];
  outfit: string;
}

export const MOTIONS: MotionDef[] = [
  { id: "nod", zh: "點頭微笑", en: "Nod and smile", keywords: ["點頭", "微笑", "nod", "smile", "yes"], backdrop: ["#cfe8ff", "#f4f9ff"], outfit: "#2f6fb5" },
  { id: "turn", zh: "左右轉頭", en: "Turn head", keywords: ["轉頭", "搖頭", "看", "turn", "look", "no"], backdrop: ["#ffe9d1", "#fff7ec"], outfit: "#c8643a" },
  { id: "wave", zh: "揮手打招呼", en: "Wave hello", keywords: ["揮手", "招呼", "你好", "hello", "wave", "hi"], backdrop: ["#d8f3e0", "#f3fcf6"], outfit: "#2b8a57" },
  { id: "dance", zh: "開心舞動", en: "Happy dance", keywords: ["跳舞", "舞", "dance", "party", "派對"], backdrop: ["#ffd9ec", "#fff1f8"], outfit: "#c23c85" },
  { id: "jump", zh: "歡呼跳躍", en: "Cheer and jump", keywords: ["跳", "歡呼", "慶祝", "jump", "cheer", "celebrate"], backdrop: ["#fff3b8", "#fffbe3"], outfit: "#d29a12" },
  { id: "heart", zh: "比愛心", en: "Heart sign", keywords: ["愛心", "愛", "比心", "heart", "love"], backdrop: ["#ffd6d6", "#fff0f0"], outfit: "#d1434f" },
  { id: "spin", zh: "3D 旋轉", en: "3D spin", keywords: ["旋轉", "轉圈", "3d", "spin", "rotate"], backdrop: ["#dcd9ff", "#f2f1ff"], outfit: "#4a46b8" },
];

export function pickMotionByText(text: string): MotionDef | null {
  const q = text.trim().toLowerCase();
  if (!q) return null;
  return MOTIONS.find((m) => m.keywords.some((k) => q.includes(k.toLowerCase()))) ?? null;
}

export const MOTION_SECONDS = 4;

interface Pose {
  headX: number;
  headY: number;
  headRot: number;
  yaw: number;
  bodyY: number;
  armL: [number, number];
  armR: [number, number];
}

const TAU = Math.PI * 2;

function poseFor(id: string, t: number): Pose {
  const base: Pose = { headX: 0, headY: 0, headRot: 0, yaw: 0, bodyY: 0, armL: [0.25, 0.1], armR: [0.25, 0.1] };
  const w = (t / MOTION_SECONDS) * TAU;
  if (id === "nod") {
    base.headY = Math.sin(w * 3) * 0.018;
    base.headRot = Math.sin(w * 3) * 0.05;
    base.yaw = Math.sin(w) * 0.15;
  } else if (id === "turn") {
    base.yaw = Math.sin(w * 1.5) * 0.75;
    base.headX = Math.sin(w * 1.5) * 0.02;
  } else if (id === "wave") {
    base.armR = [2.5, Math.sin(w * 6) * 0.55];
    base.headRot = Math.sin(w * 2) * 0.06;
    base.yaw = Math.sin(w) * 0.2;
  } else if (id === "dance") {
    const s = Math.sin(w * 4);
    base.bodyY = Math.abs(s) * -0.025;
    base.armL = [2.2 + s * 0.5, 0.4];
    base.armR = [2.2 - s * 0.5, 0.4];
    base.headRot = s * 0.12;
    base.headX = s * 0.02;
    base.yaw = Math.sin(w * 2) * 0.3;
  } else if (id === "jump") {
    const s = Math.abs(Math.sin(w * 2.5));
    base.bodyY = -s * 0.12;
    base.armL = [2.6, 0.2];
    base.armR = [2.6, 0.2];
    base.headRot = Math.sin(w * 2.5) * 0.05;
  } else if (id === "heart") {
    base.armL = [2.5, -0.9];
    base.armR = [2.5, -0.9];
    base.headRot = Math.sin(w * 3) * 0.06;
    base.headY = Math.sin(w * 3) * 0.01;
  } else if (id === "spin") {
    base.yaw = w * 1.0;
    base.armL = [0.9, 0.3];
    base.armR = [0.9, 0.3];
  }
  return base;
}

function arm(ctx: CanvasRenderingContext2D, sx: number, sy: number, side: number, pair: [number, number], s: number, color: string) {
  const l1 = 0.2 * s;
  const l2 = 0.18 * s;
  const a1 = pair[0];
  const a2 = pair[0] + pair[1];
  const ex = sx + Math.sin(a1) * side * l1;
  const ey = sy + Math.cos(a1) * l1;
  const hx = ex + Math.sin(a2) * side * l2;
  const hy = ey + Math.cos(a2) * l2;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 0.075 * s;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = "#f2c9a5";
  ctx.beginPath();
  ctx.arc(hx, hy, 0.042 * s, 0, TAU);
  ctx.fill();
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#e5395a";
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(0, 0.3);
  ctx.bezierCurveTo(-1, -0.4, -0.4, -1, 0, -0.45);
  ctx.bezierCurveTo(0.4, -1, 1, -0.4, 0, 0.3);
  ctx.fill();
  ctx.restore();
}

export function drawMotionFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  face: HTMLCanvasElement,
  motion: MotionDef,
) {
  const s = Math.min(w, h * 0.9);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, motion.backdrop[0]);
  bg.addColorStop(1, motion.backdrop[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const pose = poseFor(motion.id, t % MOTION_SECONDS);
  const cx = w / 2;
  const shoulderY = h * 0.66 + pose.bodyY * s;

  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.93, s * 0.3, s * 0.035, 0, 0, TAU);
  ctx.fill();

  arm(ctx, cx - 0.17 * s, shoulderY + 0.03 * s, -1, pose.armL, s, motion.outfit);
  arm(ctx, cx + 0.17 * s, shoulderY + 0.03 * s, 1, pose.armR, s, motion.outfit);

  ctx.fillStyle = motion.outfit;
  ctx.beginPath();
  ctx.roundRect(cx - 0.22 * s, shoulderY, 0.44 * s, h * 0.33, [0.12 * s, 0.12 * s, 0.02 * s, 0.02 * s]);
  ctx.fill();

  const headW = 0.44 * s;
  const headH = headW * (face.height / face.width);
  const hx = cx + pose.headX * s;
  const hy = shoulderY - headH * 0.52 + pose.headY * s;

  ctx.fillStyle = "#f2c9a5";
  ctx.fillRect(cx - 0.06 * s, shoulderY - 0.06 * s, 0.12 * s, 0.08 * s);

  const front = Math.cos(pose.yaw);
  ctx.save();
  ctx.translate(hx + Math.sin(pose.yaw) * 0.06 * s, hy);
  ctx.rotate(pose.headRot);
  ctx.scale(Math.max(0.12, Math.abs(front)), 1);
  if (front >= 0) {
    ctx.drawImage(face, -headW / 2, -headH / 2, headW, headH);
    if (pose.yaw !== 0) {
      ctx.globalCompositeOperation = "source-atop";
      const g = ctx.createLinearGradient(-headW / 2, 0, headW / 2, 0);
      const side = Math.sin(pose.yaw) > 0 ? 1 : 0;
      g.addColorStop(side, "rgba(0,0,0,0.22)");
      g.addColorStop(1 - side, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-headW / 2, -headH / 2, headW, headH);
      ctx.globalCompositeOperation = "source-over";
    }
  } else {
    ctx.fillStyle = "#3a2f2a";
    ctx.beginPath();
    ctx.ellipse(0, 0, headW / 2, headH / 2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  if (motion.id === "heart") {
    for (let i = 0; i < 6; i++) {
      const p = ((t / MOTION_SECONDS) * 1.5 + i / 6) % 1;
      heart(ctx, cx + Math.sin(i * 2.1 + p * 4) * 0.28 * s, h * 0.35 - p * h * 0.3, 0.035 * s, 1 - p);
    }
  }
  if (motion.id === "dance" || motion.id === "jump") {
    for (let i = 0; i < 8; i++) {
      const p = ((t / MOTION_SECONDS) * 2 + i / 8) % 1;
      ctx.fillStyle = ["#ff5d8f", "#ffc233", "#38b6ff", "#7ed957"][i % 4];
      ctx.globalAlpha = 1 - p;
      ctx.fillRect(w * ((i * 0.137 + 0.08) % 1), h * 0.12 + p * h * 0.4, 0.018 * s, 0.018 * s);
      ctx.globalAlpha = 1;
    }
  }
}
