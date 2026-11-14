"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, Loader2, Lock, ScanLine, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/lang-context";
import { aspectSize, type Aspect } from "@/lib/compositor";
import {
  GROUP_COLORS,
  JOINT_KEYS,
  PUPPET_MOTIONS,
  PUPPET_SECONDS,
  drawPuppet,
  fitJoints,
  photoPlacement,
  pickPuppetMotion,
  type CustomSwing,
  type OpenPoint,
  PART_LABEL,
  resolveCustom,
  type JointKey,
  type Joints,
} from "@/lib/puppet";
import { EditorView } from "@/components/views/editor-view";
import { MicroPanel } from "@/components/views/micro-panel";
import { NudgePad } from "@/components/views/nudge-pad";
import { HelpNote } from "@/components/views/help-note";
import { SaveDialog, type PendingSave } from "@/components/save-dialog";
import { Range } from "@/components/editor-panels";
import { aiRemoveBackground, canvasToBlob, downloadCanvas, floodClear, loadImage, localAutoCutout, strokeBrush } from "@/lib/cutout";
import {
  aiEstimateDepth,
  DEFAULT_PARALLAX,
  drawParallax,
  makeParallaxRig,
  microCapsules,
  syntheticDepth,
  type CameraPath,
  type MicroMode,
  type MicroPartKey,
  type MicroSetting,
  type ParallaxRig,
} from "@/lib/depth";
import type { EditMode } from "@/components/app-shell";

type AnimStyle = "puppet" | "subject" | "depth";

function fitToPhoto(src: CanvasImageSource, photo: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = photo.width;
  c.height = photo.height;
  c.getContext("2d")?.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function simpleCutout(photo: HTMLCanvasElement): HTMLCanvasElement {
  const c = fitToPhoto(photo, photo);
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return c;
  const data = x.getImageData(0, 0, c.width, c.height);
  localAutoCutout(data);
  x.putImageData(data, 0, 0);
  return c;
}

function opaqueRatio(cut: HTMLCanvasElement): number {
  const w = 64;
  const h = Math.max(8, Math.round((cut.height / cut.width) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return 0.5;
  x.drawImage(cut, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
  return n / (w * h);
}

function fusedSmall(photo: HTMLCanvasElement, cut: HTMLCanvasElement, sw: number): HTMLCanvasElement | null {
  const sh = Math.max(8, Math.round((photo.height / photo.width) * sw));
  const a = document.createElement("canvas");
  a.width = sw;
  a.height = sh;
  const m = document.createElement("canvas");
  m.width = sw;
  m.height = sh;
  const ax = a.getContext("2d", { willReadFrequently: true });
  const mx = m.getContext("2d", { willReadFrequently: true });
  if (!ax || !mx) return null;
  ax.imageSmoothingQuality = "high";
  ax.drawImage(photo, 0, 0, sw, sh);
  mx.drawImage(cut, 0, 0, sw, sh);
  const pix = ax.getImageData(0, 0, sw, sh);
  const alpha = mx.getImageData(0, 0, sw, sh).data;
  const total = sw * sh;
  const known = new Uint8Array(total);
  for (let i = 0; i < total; i++) known[i] = alpha[i * 4 + 3] < 30 ? 1 : 0;
  const trusted = known.slice();
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (known[i]) continue;
      if (x > 0) trusted[i - 1] = 0;
      if (x < sw - 1) trusted[i + 1] = 0;
      if (y > 0) trusted[i - sw] = 0;
      if (y < sh - 1) trusted[i + sw] = 0;
    }
  }
  const d = pix.data;
  const near = (x: number, y: number) => (x >= 0 && x < sw && y >= 0 && y < sh ? y * sw + x : -1);
  let remaining = 0;
  for (let i = 0; i < total; i++) if (!trusted[i]) remaining++;
  for (let pass = 0; pass < 400 && remaining > 0; pass++) {
    const fill: number[] = [];
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = y * sw + x;
        if (trusted[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let c = 0;
        for (const j of [near(x - 1, y), near(x + 1, y), near(x, y - 1), near(x, y + 1)]) {
          if (j < 0 || !trusted[j]) continue;
          r += d[j * 4];
          g += d[j * 4 + 1];
          b += d[j * 4 + 2];
          c++;
        }
        if (c) fill.push(i, r / c, g / c, b / c);
      }
    }
    if (!fill.length) break;
    for (let f = 0; f < fill.length; f += 4) {
      const i = fill[f];
      d[i * 4] = fill[f + 1];
      d[i * 4 + 1] = fill[f + 2];
      d[i * 4 + 2] = fill[f + 3];
      trusted[i] = 1;
      remaining--;
    }
  }
  ax.putImageData(pix, 0, 0);
  return a;
}

function buildLayers(photo: HTMLCanvasElement, cut: HTMLCanvasElement, blend = 0.5): { bg: HTMLCanvasElement; fg: HTMLCanvasElement } {
  const bg = fitToPhoto(photo, photo);
  const bx = bg.getContext("2d");
  if (bx && "filter" in bx) {
    const blurred = document.createElement("canvas");
    blurred.width = photo.width;
    blurred.height = photo.height;
    const tx = blurred.getContext("2d");
    const mask = document.createElement("canvas");
    mask.width = photo.width;
    mask.height = photo.height;
    const mx = mask.getContext("2d");
    if (tx && mx) {
      const fused = fusedSmall(photo, cut, Math.round(72 - blend * 48));
      if (fused) {
        tx.imageSmoothingQuality = "high";
        tx.drawImage(fused, 0, 0, photo.width, photo.height);
      } else {
        tx.filter = `blur(${Math.max(4, photo.width / 40)}px)`;
        tx.drawImage(photo, 0, 0);
      }
      mx.filter = `blur(${Math.max(2, photo.width / 70)}px)`;
      mx.drawImage(cut, 0, 0);
      mx.drawImage(cut, 0, 0);
      tx.filter = "none";
      tx.globalCompositeOperation = "destination-in";
      tx.drawImage(mask, 0, 0);
      bx.drawImage(blurred, 0, 0);
    }
  }
  return { bg, fg: cut };
}

function drawGuides(ctx: CanvasRenderingContext2D, cw: number, ch: number, rig: ParallaxRig, joints: Joints, micro: MicroSetting, target: JointKey | null) {
  const k = Math.min(cw / rig.w, ch / rig.h) * 1.06;
  const ox = (cw - rig.w * k) / 2;
  const oy = (ch - rig.h * k) / 2;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,200,60,0.9)";
  ctx.fillStyle = "rgba(255,200,60,0.16)";
  for (const key of Object.keys(micro) as MicroPartKey[]) {
    if (!micro[key]) continue;
    for (const c of microCapsules(key, joints, rig.w, rig.h)) {
      for (const [x, y] of [
        [c.ax, c.ay],
        [c.bx, c.by],
      ]) {
        ctx.beginPath();
        ctx.arc(ox + x * k, oy + y * k, c.r * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  for (const key of JOINT_KEYS) {
    ctx.beginPath();
    ctx.arc(ox + joints[key].x * rig.w * k, oy + joints[key].y * rig.h * k, Math.max(7, cw * 0.012), 0, Math.PI * 2);
    ctx.fillStyle = key === "head" ? "#ff5d5d" : "#3fb6ff";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  if (target) {
    const cx = ox + joints[target].x * rig.w * k;
    const cy = oy + joints[target].y * rig.h * k;
    const r = Math.max(8, cw * 0.014);
    const arm = r * 3.4;
    const gap = r * 0.9;
    for (const [w, col] of [[5, "#000000"], [2.5, "#ffffff"]] as const) {
      ctx.lineWidth = w;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.4, 0, Math.PI * 2);
      ctx.moveTo(cx - arm, cy);
      ctx.lineTo(cx - gap, cy);
      ctx.moveTo(cx + gap, cy);
      ctx.lineTo(cx + arm, cy);
      ctx.moveTo(cx, cy - arm);
      ctx.lineTo(cx, cy - gap);
      ctx.moveTo(cx, cy + gap);
      ctx.lineTo(cx, cy + arm);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const ASPECTS: Aspect[] = ["9:16", "3:4", "4:5", "1:1", "4:3", "16:9", "2:3", "3:2"];
const MAX_SIDE = 1400;

type Stage = "upload" | "format" | "motion" | "cut" | "mask" | "pose" | "micro" | "preview" | "locked";

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}

async function detectFaceBox(img: HTMLCanvasElement): Promise<{ cx: number; cy: number; h: number } | null> {
  const Ctor = (window as unknown as { FaceDetector?: new (o: object) => { detect: (i: CanvasImageSource) => Promise<DetectedFace[]> } }).FaceDetector;
  if (!Ctor) return null;
  try {
    const found = await new Ctor({ fastMode: true, maxDetectedFaces: 1 }).detect(img);
    const b = found[0]?.boundingBox;
    if (!b) return null;
    return { cx: (b.x + b.width / 2) / img.width, cy: (b.y + b.height / 2) / img.height, h: b.height / img.height };
  } catch {
    return null;
  }
}

function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load"));
    };
    img.src = url;
  });
}

export function AnimateEditor({ mode, onOpenPay }: { mode: EditMode; onOpenPay: () => void }) {
  const { L } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<JointKey | null>(null);
  const [stage, setStageRaw] = useState<Stage>("upload");
  const [history, setHistory] = useState<Stage[]>([]);
  const stageRef = useRef<Stage>("upload");
  stageRef.current = stage;
  const setStage = (next: Stage) => {
    if (next === stageRef.current) return;
    setHistory((h) => [...h, stageRef.current]);
    setStageRaw(next);
  };
  const goBack = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setNudgeTarget(null);
    setAdjust(false);
    if (prev === "pose" && !joints && photoRef.current) {
      setJoints(fitJoints(photoRef.current.width, photoRef.current.height));
    }
    setStageRaw(prev);
  };
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [motionId, setMotionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [joints, setJoints] = useState<Joints | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [style, setStyle] = useState<AnimStyle>("puppet");
  const [layers, setLayers] = useState<{ bg: HTMLCanvasElement; fg: HTMLCanvasElement } | null>(null);
  const [rigReady, setRigReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [strength, setStrength] = useState(DEFAULT_PARALLAX.strength);
  const [cameraPath, setCameraPath] = useState<CameraPath>(DEFAULT_PARALLAX.path);
  const [speed, setSpeed] = useState(DEFAULT_PARALLAX.speed);
  const [focus, setFocus] = useState(DEFAULT_PARALLAX.focus);
  const [breath, setBreath] = useState(DEFAULT_PARALLAX.breath);
  const [dust, setDust] = useState(DEFAULT_PARALLAX.dust);
  const [micro, setMicro] = useState<MicroSetting>({});
  const [microMode, setMicroMode] = useState<MicroMode>("swing");
  const [microAmount, setMicroAmount] = useState(0.6);
  const [microSpeed, setMicroSpeed] = useState(1);
  const [adjust, setAdjust] = useState(false);
  const [ghostFade, setGhostFade] = useState(0.85);
  const [customs, setCustoms] = useState<CustomSwing[]>([]);
  const [pinMode, setPinMode] = useState<"pivot" | "swing" | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState(-1);
  const [swingSize, setSwingSize] = useState(0.5);
  const [blend, setBlend] = useState(0.5);
  const [feather, setFeather] = useState(0.5);
  const [swingWidth, setSwingWidth] = useState(0.05);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [opens, setOpens] = useState<OpenPoint[]>([]);
  const [selectedOpen, setSelectedOpen] = useState(-1);
  const [openPlace, setOpenPlace] = useState<"mouth" | "eye" | null>(null);
  const [duration, setDuration] = useState(8);
  const openDragRef = useRef<number | null>(null);
  const selectedOpenRef = useRef(-1);
  selectedOpenRef.current = selectedOpen;
  const pinDragRef = useRef<{ i: number; which: "pivot" | "swing" } | null>(null);
  const [nudgeTarget, setNudgeTarget] = useState<"pending" | { i: number; which: "pivot" | "swing" } | { joint: JointKey } | null>(null);
  const nudgeTargetRef = useRef(nudgeTarget);
  nudgeTargetRef.current = nudgeTarget;
  const jointNudge: JointKey | null = nudgeTarget && typeof nudgeTarget === "object" && "joint" in nudgeTarget ? nudgeTarget.joint : null;
  const rigRef = useRef<ParallaxRig | null>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const cutRef = useRef<HTMLCanvasElement | null>(null);
  const aiCutRef = useRef<HTMLCanvasElement | null>(null);
  const lastStrokeRef = useRef<{ x: number; y: number } | null>(null);
  const [brushMode, setBrushMode] = useState<"erase" | "restore" | "wand">("erase");
  const [brushSize, setBrushSize] = useState(4);
  const [wandTol, setWandTol] = useState(40);
  const [cutOnly, setCutOnly] = useState(false);
  const [nudgeAll, setNudgeAll] = useState(false);
  const nudgeAllRef = useRef(nudgeAll);
  nudgeAllRef.current = nudgeAll;

  const motion = PUPPET_MOTIONS.find((m) => m.id === motionId) ?? null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      photoRef.current = await loadPhoto(file);
      setLayers(null);
      cutRef.current = null;
      aiCutRef.current = null;
      rigRef.current = null;
      setRigReady(false);
      setStyle("puppet");
      setJoints(null);
      setMicro({});
      setAdjust(false);
      setNudgeTarget(null);
      setCustoms([]);
      setOpens([]);
      setSelectedOpen(-1);
      setOpenPlace(null);
      setPending(null);
      setPinMode(null);
      setSelected(-1);
      setMessage("");
      setHistory(["upload"]);
      setStageRaw("format");
    } catch {
      setMessage(L("相片讀取失敗。", "Could not read that photo."));
    }
  };

  const autoPlace = useCallback(async () => {
    const photo = photoRef.current;
    if (!photo) return;
    setDetecting(true);
    const face = await detectFaceBox(photo);
    setJoints(fitJoints(photo.width, photo.height, face ?? undefined));
    setDetecting(false);
    setMessage(
      face
        ? L("已依人臉位置放好標準骨架，請拖動圓點對齊頭、手、腳。", "A standard skeleton was placed by the face position. Drag the dots onto the head, hands and feet.")
        : L("這個瀏覽器無法自動辨識身體，已放上標準骨架，請拖動圓點對齊。", "This browser cannot detect the body automatically. A standard skeleton was placed; drag the dots to match."),
    );
  }, [L]);

  const goPose = () => {
    setStage("pose");
    if (mode === "ai" && !joints) void autoPlace();
    if (mode === "hand" && !joints && photoRef.current) {
      setJoints(fitJoints(photoRef.current.width, photoRef.current.height));
    }
  };

  const prepare = async (s: AnimStyle): Promise<boolean> => {
    const photo = photoRef.current;
    if (!photo) return false;
    setPreparing(true);
    try {
      if (s === "subject" && !cutRef.current) {
        setMessage(L("AI 去背中，第一次要下載模型，請稍候…", "Removing the background with AI. The first run downloads a model, please wait."));
        let cut: HTMLCanvasElement;
        try {
          const out = await aiRemoveBackground(await canvasToBlob(photo));
          const url = URL.createObjectURL(out);
          try {
            cut = fitToPhoto(await loadImage(url), photo);
          } finally {
            URL.revokeObjectURL(url);
          }
          setMessage("");
        } catch {
          cut = simpleCutout(photo);
          setMessage(L("AI 去背失敗，改用簡易去背，只適合單色背景。", "AI cutout failed, so a simple cutout was used. It only suits plain backgrounds."));
        }
        aiCutRef.current = fitToPhoto(cut, photo);
        cutRef.current = fitToPhoto(cut, photo);
        const ratio = opaqueRatio(cut);
        if (ratio > 0.97 || ratio < 0.03) {
          setMessage(
            L(
              "去背幾乎沒有效果。請在下一步用「點選背景清除」或筆刷手動處理，或按「重新 AI 去背」。",
              "The cutout barely changed anything. In the next step use Tap background or the brush, or press Redo AI cutout.",
            ),
          );
        }
      }
      if (s === "depth" && !rigRef.current) {
        setMessage(L("AI 估算遠近中，第一次要下載模型，請稍候…", "Estimating depth with AI. The first run downloads a model, please wait."));
        let depth: HTMLCanvasElement;
        let aiOk = true;
        try {
          depth = await aiEstimateDepth(photo);
        } catch {
          aiOk = false;
          depth = syntheticDepth(photo.width, photo.height);
        }
        rigRef.current = makeParallaxRig(photo, depth);
        setRigReady(!!rigRef.current);
        if (!rigRef.current) return false;
        if (!joints) await autoPlace();
        if (!aiOk) setMessage(L("AI 遠近估算失敗，改用簡易估算，效果比較粗。", "AI depth failed, so a simple estimate was used. The effect is rougher."));
      }
      return true;
    } finally {
      setPreparing(false);
    }
  };

  const goNext = async () => {
    if (style === "depth") {
      if (await prepare("depth")) setStage("micro");
      return;
    }
    setStage("cut");
  };

  const startCut = async (only = false) => {
    setCutOnly(only);
    if (await prepare("subject")) setStage("mask");
  };

  const redoCut = async () => {
    cutRef.current = null;
    aiCutRef.current = null;
    if (await prepare("subject")) redrawMask();
  };

  const downloadCut = async () => {
    const cut = cutRef.current;
    if (cut) await downloadCanvas(cut, "photo-cutout.png");
  };

  const skipCut = () => {
    setLayers(null);
    goPose();
  };

  const confirmMask = () => {
    const photo = photoRef.current;
    const cut = cutRef.current;
    if (!photo || !cut) return;
    setLayers(buildLayers(photo, cut, blend));
    goPose();
  };

  const resetMask = () => {
    const photo = photoRef.current;
    const ai = aiCutRef.current;
    if (!photo || !ai) return;
    cutRef.current = fitToPhoto(ai, photo);
    redrawMask();
  };

  const redrawMask = useCallback(() => {
    const c = maskRef.current;
    const photo = photoRef.current;
    const cut = cutRef.current;
    if (!c || !photo || !cut) return;
    if (c.width !== photo.width || c.height !== photo.height) {
      c.width = photo.width;
      c.height = photo.height;
    }
    const x = c.getContext("2d");
    if (!x) return;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = "#202020";
    x.fillRect(0, 0, c.width, c.height);
    x.globalAlpha = 0.3;
    x.drawImage(photo, 0, 0);
    x.globalAlpha = 1;
    x.drawImage(cut, 0, 0);
  }, []);

  useEffect(() => {
    const photo = photoRef.current;
    const cut = cutRef.current;
    if (!layers || !photo || !cut) return;
    const timer = window.setTimeout(() => setLayers(buildLayers(photo, cut, blend)), 250);
    return () => window.clearTimeout(timer);
    // 只在融合程度改變時重建背景，避免換圖層時無限重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blend]);

  useEffect(() => {
    if (stage === "mask") redrawMask();
  }, [stage, redrawMask]);

  const maskPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = maskRef.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const paintMask = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const photo = photoRef.current;
    const cut = cutRef.current;
    const cx = cut?.getContext("2d");
    if (!photo || !cut || !cx) return;
    strokeBrush(cx, photo, from, to, (brushSize * photo.width) / 150, brushMode);
    redrawMask();
  };

  const wandClear = (p: { x: number; y: number }) => {
    const cut = cutRef.current;
    const cx = cut?.getContext("2d", { willReadFrequently: true });
    if (!cut || !cx) return;
    const x = Math.min(cut.width - 1, Math.max(0, Math.round(p.x)));
    const y = Math.min(cut.height - 1, Math.max(0, Math.round(p.y)));
    const data = cx.getImageData(0, 0, cut.width, cut.height);
    if (data.data[(y * cut.width + x) * 4 + 3] < 20) return;
    floodClear(data, x, y, wandTol);
    cx.putImageData(data, 0, 0);
    redrawMask();
  };

  const onMaskDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = maskPoint(e);
    if (!p || !maskRef.current) return;
    if (brushMode === "wand") {
      wandClear(p);
      return;
    }
    lastStrokeRef.current = p;
    maskRef.current.setPointerCapture(e.pointerId);
    paintMask(p, p);
  };

  const onMaskMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const last = lastStrokeRef.current;
    const p = maskPoint(e);
    if (!last || !p) return;
    paintMask(last, p);
    lastStrokeRef.current = p;
  };

  const onMaskUp = () => {
    lastStrokeRef.current = null;
  };

  const applyPrompt = () => {
    const hit = pickPuppetMotion(prompt);
    if (hit) {
      setMotionId(hit.id);
      setMessage(L(`已選擇「${hit.zh}」。`, `Picked "${hit.en}".`));
    } else {
      setMessage(L("沒有找到對應的動作，請從下面的清單選一個。", "No matching action found. Pick one from the list below."));
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const photo = photoRef.current;
    if (!canvas || !photo || (stage !== "pose" && stage !== "preview" && stage !== "locked" && stage !== "micro")) return;
    if (style !== "depth" && !joints) return;
    if (style === "depth" && !rigRef.current) return;
    const { w, h } = aspectSize(aspect);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rig = rigRef.current;
    if (style === "depth" && rig) {
      let raf = 0;
      const t0 = performance.now();
      const tick = (now: number) => {
        if (adjust && stage === "micro") {
          drawParallax(ctx, w, h, rig, 0, { path: "push", strength: 0, speed: 1, focus: 0.5, breath: 0, dust: 0 });
          if (joints) drawGuides(ctx, w, h, rig, joints, micro, jointNudge);
        } else {
          drawParallax(ctx, w, h, rig, (now - t0) / 1000, { path: cameraPath, strength, speed, focus, breath, dust, micro, microAmount, microSpeed, joints });
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    if (!joints) return;
    const lay = layers ?? undefined;
    const fx = { customs, opens, selectedOpen, size: swingSize, blend, feather, width: swingWidth };
    if (stage === "pose") {
      drawPuppet(ctx, w, h, photo, joints, null, 0, showSkeleton, lay, ghostFade, { ...fx, showPins: true, pending, selected, target: nudgeTarget });
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      drawPuppet(ctx, w, h, photo, joints, motion, ((now - t0) / 1000) % PUPPET_SECONDS, false, lay, ghostFade, fx);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, aspect, joints, motion, style, layers, strength, rigReady, cameraPath, speed, focus, breath, dust, micro, microAmount, microSpeed, adjust, ghostFade, customs, swingSize, blend, feather, swingWidth, showSkeleton, pending, selected, nudgeTarget, opens, selectedOpen]);

  const toPhotoPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const photo = photoRef.current;
    if (!canvas || !photo) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const base = photoPlacement(photo.width, photo.height, canvas.width, canvas.height);
    const rig = rigRef.current;
    const depthK = style === "depth" && rig ? Math.min(canvas.width / rig.w, canvas.height / rig.h) * 1.06 : 0;
    const s = depthK && rig ? (depthK * rig.w) / photo.width : base.s;
    const ox = depthK && rig ? (canvas.width - rig.w * depthK) / 2 : base.ox;
    const oy = depthK && rig ? (canvas.height - rig.h * depthK) / 2 : base.oy;
    return {
      cx: px,
      cy: py,
      x: Math.min(1, Math.max(0, (px - ox) / s / photo.width)),
      y: Math.min(1, Math.max(0, (py - oy) / s / photo.height)),
      s,
      ox,
      oy,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const photo = photoRef.current;
    const pt = toPhotoPoint(e);
    if (stage === "pose" && style !== "depth" && canvas && photo && pt) {
      if (openPlace) {
        const next = [...opens, { c: { x: pt.x, y: pt.y }, r: openPlace === "mouth" ? 0.05 : 0.035, amount: 0.5, mode: openPlace }];
        setOpens(next);
        setSelectedOpen(next.length - 1);
        setSelected(-1);
        setNudgeTarget(null);
        setOpenPlace(null);
        return;
      }
      if (pinMode === "pivot") {
        setPending({ x: pt.x, y: pt.y });
        setNudgeTarget("pending");
        setPinMode(null);
        return;
      }
      if (pinMode === "swing") {
        if (!pending) {
          setMessage(L("請先按紅色按鈕，在照片上點出軸心點。", "Press the red button first and tap the pivot on the photo."));
          return;
        }
        const next = [...customs, { pivot: pending, swing: { x: pt.x, y: pt.y }, angle: 5 }];
        setCustoms(next);
        setSelected(next.length - 1);
        setNudgeTarget({ i: next.length - 1, which: "swing" });
        setPending(null);
        setPinMode(null);
        setMessage("");
        return;
      }
      let openHit = -1;
      let openD = canvas.width * 0.05;
      opens.forEach((o, i) => {
        const d = Math.hypot(pt.ox + o.c.x * photo.width * pt.s - pt.cx, pt.oy + o.c.y * photo.height * pt.s - pt.cy);
        if (d < openD) {
          openHit = i;
          openD = d;
        }
      });
      if (openHit >= 0) {
        openDragRef.current = openHit;
        setSelectedOpen(openHit);
        setSelected(-1);
        setNudgeTarget(null);
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      let hit: { i: number; which: "pivot" | "swing" } | null = null;
      let hitD = canvas.width * 0.05;
      customs.forEach((c, i) => {
        for (const which of ["pivot", "swing"] as const) {
          const d = Math.hypot(pt.ox + c[which].x * photo.width * pt.s - pt.cx, pt.oy + c[which].y * photo.height * pt.s - pt.cy);
          if (d < hitD) {
            hit = { i, which };
            hitD = d;
          }
        }
      });
      if (hit) {
        pinDragRef.current = hit;
        setSelected((hit as { i: number }).i);
        setNudgeTarget(hit as { i: number; which: "pivot" | "swing" });
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (!showSkeleton) return;
    }
    const canDrag = (stage === "pose" && showSkeleton) || (stage === "micro" && adjust);
    if (!canDrag || !joints || !canvas || !photo || !pt) return;
    let best: JointKey | null = null;
    let bestD = canvas.width * 0.06;
    for (const k of JOINT_KEYS) {
      const jx = pt.ox + joints[k].x * photo.width * pt.s;
      const jy = pt.oy + joints[k].y * photo.height * pt.s;
      const d = Math.hypot(jx - pt.cx, jy - pt.cy);
      if (d < bestD) {
        best = k;
        bestD = d;
      }
    }
    if (best) {
      dragRef.current = best;
      setNudgeTarget({ joint: best });
      canvas.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const key = dragRef.current;
    const pt = toPhotoPoint(e);
    const openIdx = openDragRef.current;
    if (openIdx !== null && pt) {
      setOpens((os) => os.map((o, i) => (i === openIdx ? { ...o, c: { x: pt.x, y: pt.y } } : o)));
      return;
    }
    const pin = pinDragRef.current;
    if (pin && pt) {
      setCustoms((cs) => cs.map((c, i) => (i === pin.i ? { ...c, [pin.which]: { x: pt.x, y: pt.y } } : c)));
      return;
    }
    if (!key || !pt) return;
    setJoints((j) => (j ? { ...j, [key]: { x: pt.x, y: pt.y } } : j));
  };

  const endDrag = () => {
    dragRef.current = null;
    pinDragRef.current = null;
    openDragRef.current = null;
  };

  const nudge = useCallback((dx: number, dy: number) => {
    const target = nudgeTargetRef.current;
    const step = 0.0015;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const move = (p: { x: number; y: number }) => ({ x: clamp(p.x + dx * step), y: clamp(p.y + dy * step) });
    if (nudgeAllRef.current) {
      setJoints((j) => (j ? (Object.fromEntries(JOINT_KEYS.map((k) => [k, move(j[k])])) as Joints) : j));
      setCustoms((cs) => cs.map((c) => ({ ...c, pivot: move(c.pivot), swing: move(c.swing) })));
      setOpens((os) => os.map((o) => ({ ...o, c: move(o.c) })));
      setPending((p) => (p ? move(p) : p));
      return;
    }
    if (!target) {
      const oi = selectedOpenRef.current;
      if (oi >= 0) setOpens((os) => os.map((o, i) => (i === oi ? { ...o, c: move(o.c) } : o)));
      return;
    }
    if (target === "pending") {
      setPending((p) => (p ? move(p) : p));
      return;
    }
    if ("joint" in target) {
      const key = target.joint;
      setJoints((j) => (j ? { ...j, [key]: move(j[key]) } : j));
      return;
    }
    setCustoms((cs) => cs.map((c, i) => (i === target.i ? { ...c, [target.which]: move(c[target.which]) } : c)));
  }, []);

  const nudgeTitle = (() => {
    if (nudgeAll) return L("微調：全選，骨架與紅藍點一起移動", "Fine-tune: all, the skeleton and pins move together");
    if (!nudgeTarget) return "";
    if (nudgeTarget === "pending") return L("微調：紅色軸心點", "Fine-tune: red pivot point");
    if ("joint" in nudgeTarget) return L("微調：人型骨架圓點", "Fine-tune: skeleton dot");
    const color = nudgeTarget.which === "pivot" ? L("紅色軸心點", "red pivot") : L("藍色擺動點", "blue swing point");
    return L(`微調：第 ${nudgeTarget.i + 1} 組的${color}`, `Fine-tune: ${color} of pair ${nudgeTarget.i + 1}`);
  })();

  const exportVideo = useCallback(async (): Promise<File | null> => {
    const canvas = canvasRef.current;
    if (!canvas || typeof MediaRecorder === "undefined") {
      setMessage(L("這個瀏覽器不支援影片輸出。", "This browser cannot export video."));
      return null;
    }
    const mime = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      setMessage(L("這個瀏覽器不支援影片輸出。", "This browser cannot export video."));
      return null;
    }
    setExporting(true);
    setProgress(0);
    const chunks: BlobPart[] = [];
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start();
    const t0 = performance.now();
    const timer = window.setInterval(() => setProgress(Math.min(1, (performance.now() - t0) / 1000 / duration)), 100);
    await new Promise((r) => setTimeout(r, duration * 1000));
    rec.stop();
    await done;
    window.clearInterval(timer);
    setExporting(false);
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    return new File([new Blob(chunks, { type: mime })], `photo-motion.${ext}`, { type: mime });
  }, [L, duration]);

  const downloadVideo = async () => {
    const file = await exportVideo();
    if (!file) return;
    setPendingSave({ blob: file, filename: file.name, onSaved: () => setMessage(L("作品已處理，記得確認相簿或檔案裡有存到。", "Done. Please check your Photos or Files to confirm it was saved.")) });
  };

  const keepEditing = async () => {
    const file = await exportVideo();
    if (file) setVideo(file);
  };

  if (video) {
    return <EditorView key="animate-edit" func="video" mode={mode} onOpenPay={onOpenPay} initialFile={video} initialAspect={aspect} />;
  }

  const steps: { id: Stage; label: string }[] =
    style === "depth"
      ? [
          { id: "upload", label: L("照片", "Photo") },
          { id: "format", label: L("規格", "Format") },
          { id: "motion", label: L("方式", "Method") },
          { id: "micro", label: L("微動", "Micro") },
          { id: "preview", label: L("預覽", "Preview") },
          { id: "locked", label: L("鎖定", "Lock") },
        ]
      : [
          { id: "upload", label: L("照片", "Photo") },
          { id: "format", label: L("規格", "Format") },
          { id: "motion", label: L("方式", "Method") },
          { id: "cut", label: L("去背", "Cutout") },
          { id: "mask", label: L("遮罩", "Mask") },
          { id: "pose", label: L("點陣", "Dots") },
          { id: "preview", label: L("預覽", "Preview") },
          { id: "locked", label: L("鎖定", "Lock") },
        ];
  const at = steps.findIndex((s) => s.id === stage);

  const motionPicker = (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={L("動作形態", "Action type")}>
      <Button type="button" role="radio" aria-checked={motionId === ""} variant={motionId === "" ? "default" : "outline"} onClick={() => setMotionId("")}>
        {L("不用預設", "None")}
      </Button>
      {PUPPET_MOTIONS.map((m) => (
        <Button key={m.id} type="button" role="radio" aria-checked={motionId === m.id} variant={motionId === m.id ? "default" : "outline"} onClick={() => setMotionId(m.id)}>
          {L(m.zh, m.en)}
        </Button>
      ))}
    </div>
  );

  const exportingStatus = exporting && (
    <div className="flex items-center gap-2 text-sm" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {L(`正在輸出影片… ${Math.round(progress * 100)}%`, `Exporting video... ${Math.round(progress * 100)}%`)}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-[calc(10dvh+env(safe-area-inset-bottom))]">
      <ol className="flex items-center gap-1 text-xs" aria-label={L("步驟", "Steps")}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === at ? "step" : undefined}
            className={`flex-1 rounded-full px-1 py-1 text-center ${i === at ? "bg-primary text-primary-foreground" : i < at ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {history.length > 0 && stage !== "upload" && (
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={preparing || exporting} onClick={goBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {L("返回前頁", "Previous page")}
        </Button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={L("選擇人物照片", "Choose a person photo")}
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {(stage === "format" || stage === "motion" || stage === "cut" || stage === "mask" || stage === "pose" || stage === "micro") && (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" disabled={preparing} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" aria-hidden="true" />
            {L("更換照片", "Change photo")}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={preparing || stage === "format"} onClick={() => setStage("format")}>
            {L(`更換規格（${aspect}）`, `Change format (${aspect})`)}
          </Button>
        </div>
      )}

      {stage === "upload" && (
        <section className="flex flex-col gap-3">
          <HelpNote showLabel={L("查看說明", "Show help")} hideLabel={L("收起說明", "Hide help")}>
            {L("請選一張全身、正面、背景單純的人物照片，效果最好。", "Choose a full-body, front-facing photo with a plain background for best results.")}
          </HelpNote>
          <Button type="button" className="h-12" onClick={() => fileRef.current?.click()}>
            <Upload className="size-5" aria-hidden="true" />
            {L("選擇照片", "Choose photo")}
          </Button>
        </section>
      )}

      {stage === "format" && (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">{L("選擇規格（屏幕格式）", "Choose a format (screen shape)")}</p>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={L("屏幕格式", "Screen format")}>
            {ASPECTS.map((a) => (
              <Button key={a} type="button" role="radio" aria-checked={aspect === a} variant={aspect === a ? "default" : "outline"} onClick={() => setAspect(a)}>
                {a}
              </Button>
            ))}
          </div>
          <Button type="button" className="h-12" onClick={() => setStage("motion")}>
            <ArrowRight className="size-5" aria-hidden="true" />
            {L("下一步：選動畫方式", "Next: choose the method")}
          </Button>
        </section>
      )}

      {stage === "motion" && (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">{L("動畫方式", "Animation method")}</p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={L("動畫方式", "Animation method")}>
            {(
              [
                ["puppet", L("1. 骨架紙偶", "1. Skeleton puppet"), L("可選去背或跳過，再用點陣調整身體", "Cut out or skip, then place the skeleton dots")],
                ["subject", L("2. 只動人物，背景固定", "2. Person only, fixed background"), L("建議去背：人物動、背景不動", "Cutout recommended: the person moves, the background stays")],
                ["depth", L("3. 深度視差（2.5D）＋部位微動", "3. Depth parallax (2.5D) + part motion"), L("AI 估算遠近，可選眼、耳、口、手、腳等部位微動", "AI estimates depth; pick eyes, ears, mouth, arms, legs to move")],
              ] as [AnimStyle, string, string][]
            ).map(([id, title, desc]) => (
              <Button
                key={id}
                type="button"
                role="radio"
                aria-checked={style === id}
                variant={style === id ? "default" : "outline"}
                className="h-auto flex-col items-start gap-0.5 whitespace-normal py-2 text-left"
                disabled={preparing}
                onClick={() => setStyle(id)}
              >
                <span>{title}</span>
                <span className="text-xs font-normal opacity-80">{desc}</span>
              </Button>
            ))}
          </div>
          {style !== "depth" && mode === "ai" && (
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) applyPrompt();
                }}
                placeholder={L("說說想要的動作，例如：開心地跳舞", "Describe it, e.g. dance happily")}
                aria-label={L("描述動作", "Describe the action")}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="button" variant="secondary" onClick={applyPrompt}>
                <Wand2 className="size-4" aria-hidden="true" />
                {L("選動作", "Pick")}
              </Button>
            </div>
          )}
          {style !== "depth" && (
            <>
              <p className="text-sm font-medium">{L("動作形態", "Action type")}</p>
              {motionPicker}
            </>
          )}
          {preparing && (
            <div className="flex items-center gap-2 text-sm" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {L("處理中，請稍候…", "Working, please wait...")}
            </div>
          )}
          <Button type="button" className="h-12" disabled={preparing} onClick={() => void goNext()}>
            <ScanLine className="size-5" aria-hidden="true" />
            {style === "depth" ? L("下一步：AI 計算立體深度", "Next: AI depth estimate") : L("下一步：選擇去背或跳過", "Next: cut out or skip")}
          </Button>
        </section>
      )}

      {stage === "cut" && (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">{L("要不要去背？", "Cut out the person?")}</p>
          <HelpNote showLabel={L("查看說明", "Show help")} hideLabel={L("收起說明", "Hide help")}>
            {L(
              "去背後人物會單獨動，背景固定在原位，並可用筆刷修邊。跳過的話，整張照片一起動。",
              "With a cutout the person moves alone while the background stays, and you can brush the edge. If you skip it, the whole photo moves.",
            )}
          </HelpNote>
          {preparing && (
            <div className="flex items-center gap-2 text-sm" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {L("AI 去背中，請稍候…", "Cutting out with AI, please wait...")}
            </div>
          )}
          <Button type="button" className="h-12" variant={style === "subject" ? "default" : "outline"} disabled={preparing} onClick={() => void startCut()}>
            <ScanLine className="size-5" aria-hidden="true" />
            {L("去背，進入去背工程", "Cut out, open the mask editor")}
          </Button>
          <Button type="button" className="h-12" variant={style === "subject" ? "outline" : "default"} disabled={preparing} onClick={skipCut}>
            <ArrowRight className="size-5" aria-hidden="true" />
            {L("跳過，直接點陣佈局", "Skip, go to the dot layout")}
          </Button>
          <Button type="button" className="h-12" variant="outline" disabled={preparing} onClick={() => void startCut(true)}>
            <Wand2 className="size-5" aria-hidden="true" />
            {L("3. 照片去背（單獨輸出透明背景圖）", "3. Photo cutout (save a transparent image)")}
          </Button>
          <Button type="button" variant="ghost" disabled={preparing} onClick={() => setStage("motion")}>
            {L("返回選動畫方式", "Back to methods")}
          </Button>
        </section>
      )}

      {stage === "mask" && (
        <section className="flex flex-col gap-3">
          <HelpNote showLabel={L("查看說明", "Show help")} hideLabel={L("收起說明", "Hide help")}>
            {L(
              "亮的是會動的人物，暗的是固定的背景。用手指塗抹修邊：「擦掉」把多切進來的背景去掉，「補回」把被誤切掉的人物補回來。",
              "The bright part is the person who will move; the dark part is the fixed background. Paint to fix the edge: Erase removes background that was cut in, Restore brings back any part of the person that was cut away.",
            )}
          </HelpNote>
          <canvas
            ref={maskRef}
            className="mx-auto max-h-[60dvh] w-auto max-w-full touch-none rounded-md border border-border"
            aria-label={L("人物遮罩，可用手指塗抹修邊", "Person mask, paint to fix the edge")}
            onPointerDown={onMaskDown}
            onPointerMove={onMaskMove}
            onPointerUp={onMaskUp}
            onPointerCancel={onMaskUp}
          />
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={L("修補工具", "Fix tool")}>
            <Button type="button" role="radio" aria-checked={brushMode === "erase"} variant={brushMode === "erase" ? "default" : "outline"} onClick={() => setBrushMode("erase")}>
              {L("擦掉", "Erase")}
            </Button>
            <Button type="button" role="radio" aria-checked={brushMode === "restore"} variant={brushMode === "restore" ? "default" : "outline"} onClick={() => setBrushMode("restore")}>
              {L("補回", "Restore")}
            </Button>
            <Button type="button" role="radio" aria-checked={brushMode === "wand"} variant={brushMode === "wand" ? "default" : "outline"} onClick={() => setBrushMode("wand")}>
              {L("點選背景清除", "Tap background")}
            </Button>
          </div>
          {brushMode === "wand" ? (
            <>
              <HelpNote showLabel={L("查看說明", "Show help")} hideLabel={L("收起說明", "Hide help")}>
                {L(
                  "在畫面上點一下還沒去掉的背景，系統會清除和那一點顏色相近、而且連在一起的區域。清不乾淨就調高容差再點一次。",
                  "Tap a background area that is still there. Connected areas of a similar colour are cleared. If it is not enough, raise the tolerance and tap again.",
                )}
              </HelpNote>
              <Range label={L("容差（越高清越多）", "Tolerance (higher clears more)")} value={wandTol} min={10} max={120} step={5} onChange={setWandTol} />
            </>
          ) : (
            <Range label={L("筆刷大小", "Brush size")} value={brushSize} min={1} max={14} step={1} onChange={setBrushSize} />
          )}
          {preparing && (
            <div className="flex items-center gap-2 text-sm" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {L("AI 去背中，請稍候…", "Cutting out with AI, please wait...")}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={preparing} onClick={resetMask}>
              {L("還原為 AI 去背結果", "Reset to the AI cutout")}
            </Button>
            <Button type="button" variant="outline" disabled={preparing} onClick={() => void redoCut()}>
              {L("重新 AI 去背", "Redo AI cutout")}
            </Button>
          </div>
          <Button type="button" className="h-12" variant={cutOnly ? "default" : "outline"} onClick={() => void downloadCut()}>
            <Download className="size-5" aria-hidden="true" />
            {L("下載去背圖（透明 PNG）", "Download the cutout (transparent PNG)")}
          </Button>
          <Button type="button" className="h-12" variant={cutOnly ? "outline" : "default"} disabled={preparing} onClick={confirmMask}>
            <Check className="size-5" aria-hidden="true" />
            {L("去背完成，進入點陣佈局", "Mask done, go to the dot layout")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setStage("cut")}>
            {L("返回選去背或跳過", "Back to cutout choice")}
          </Button>
        </section>
      )}

      {(stage === "pose" || stage === "micro" || stage === "preview" || stage === "locked") && (
        <section className="flex flex-col gap-3">
          <div className="sticky top-14 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur-sm">
            <canvas
              ref={canvasRef}
              className="mx-auto max-h-[38dvh] w-auto max-w-full touch-none rounded-md border border-border"
              aria-label={stage === "pose" || (stage === "micro" && adjust) ? L("照片，可點選軸心點與擺動點", "Photo, tap to place pivot and swing points") : L("動態預覽", "Motion preview")}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </div>
          {detecting && (
            <div className="flex items-center gap-2 text-sm" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {L("正在辨識身體位置…", "Detecting the body...")}
            </div>
          )}

          {stage === "pose" && (
            <>
              <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-3">
                <p className="text-sm font-medium">{L("第一步：人型對位", "Step 1: fit the body")}</p>
                <HelpNote showLabel={L("查看說明", "Show help")} hideLabel={L("收起說明", "Hide help")}>
                  {L(
                    "照片上有人型骨架圓點，請拖動圓點對準頭、肩、手肘、手腕、髖、膝、腳。對準後，系統才能判斷你點的位置是哪個部位。",
                    "A body skeleton is drawn on the photo. Drag its dots onto the head, shoulders, elbows, wrists, hips, knees and feet so the app can tell which body part you pick.",
                  )}
                </HelpNote>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" disabled={detecting} onClick={() => void autoPlace()}>
                    <ScanLine className="size-4" aria-hidden="true" />
                    {mode === "ai" ? L("重新 AI 辨識", "Detect again") : L("自動放置骨架", "Auto-place")}
                  </Button>
                  <Button type="button" variant={showSkeleton ? "default" : "outline"} aria-pressed={showSkeleton}
                    onClick={() => {
                      setShowSkeleton((v) => !v);
                      setNudgeTarget((t) => (t && typeof t === "object" && "joint" in t ? null : t));
                    }}
                  >
                    {showSkeleton ? L("對位完成，隱藏骨架", "Done, hide skeleton") : L("顯示骨架，繼續對位", "Show skeleton")}
                  </Button>
                </div>
              </div>
              <HelpNote showLabel={L("查看點陣說明", "Show dot help")} hideLabel={L("收起說明", "Hide help")}>
                {L(
                  "第二步：先按紅色按鈕，在照片上點出軸心點（小紅點，例如肩膀或脖子）。再按藍色按鈕，點出要動的位置（小藍點，例如手腕或頭頂）。系統會判斷這是哪個部位，黃色底色就是會一起擺動的範圍，整個頭、手臂或腿會一起轉，不是只轉一條線。可以重複設定多組，已設好的點可以直接拖動。",
                  "Step 2: press the red button and tap the pivot (red dot, e.g. shoulder or neck). Then press the blue button and tap what should move (blue dot, e.g. wrist or top of head). The app works out which body part it is; the yellow area shows what swings together, so the whole head, arm or leg turns, not just a line. Repeat for more pairs; drag any dot to adjust.",
                )}
              </HelpNote>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={pinMode === "pivot" ? "default" : "outline"} aria-pressed={pinMode === "pivot"} onClick={() => setPinMode(pinMode === "pivot" ? null : "pivot")}>
                  <span className="size-3 rounded-full" style={{ backgroundColor: "#ff3b3b" }} aria-hidden="true" />
                  {L("活動軸心點", "Pivot point")}
                </Button>
                <Button type="button" variant={pinMode === "swing" ? "default" : "outline"} aria-pressed={pinMode === "swing"} onClick={() => setPinMode(pinMode === "swing" ? null : "swing")}>
                  <span className="size-3 rounded-full" style={{ backgroundColor: "#2f7bff" }} aria-hidden="true" />
                  {L("活動擺動點", "Swing point")}
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground" role="status">
                {pinMode === "pivot"
                  ? L("請在照片上點出軸心點。", "Tap the photo to place the pivot.")
                  : pinMode === "swing"
                    ? pending
                      ? L("請在照片上點出擺動點。", "Tap the photo to place the swing point.")
                      : L("請先按紅色按鈕，點出軸心點。", "Place a pivot with the red button first.")
                    : pending
                      ? L("軸心點已設好，請按藍色按鈕，再點出擺動點。", "Pivot set. Press the blue button and tap the swing point.")
                      : customs.length
                        ? L(`已設定 ${customs.length} 組。`, `${customs.length} pair(s) set.`)
                        : L("還沒有設定任何擺動點。", "No swing points yet.")}
              </p>
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">{L("開合動作點（嘴巴、眼睛）", "Open and close points (mouth, eyes)")}</p>
                <HelpNote showLabel={L("查看開合說明", "Show open and close help")} hideLabel={L("收起說明", "Hide help")}>
                  {L(
                    "按「嘴巴開合」後，在照片上點一下嘴巴中央，嘴巴的下半部會上下開合，中間露出暗色。按「眼睛開合」後點一下眼睛，上眼皮會往下蓋，像眨眼。綠色虛線圈就是動的範圍，用「範圍大小」調整，圈住嘴或眼就好。每個眼睛要各點一次。",
                    "Press Mouth open and close, then tap the center of the mouth: the lower half opens and shuts with a dark gap. Press Eye open and close, then tap an eye: the upper lid closes like a blink. The green dashed circle is the area that moves; size it to just cover the mouth or eye. Tap once per eye.",
                  )}
                </HelpNote>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant={openPlace === "mouth" ? "default" : "outline"} aria-pressed={openPlace === "mouth"} onClick={() => { setPinMode(null); setOpenPlace(openPlace === "mouth" ? null : "mouth"); }}>
                    <span className="size-3 rounded-full" style={{ backgroundColor: "#22c55e" }} aria-hidden="true" />
                    {L("嘴巴開合", "Mouth")}
                  </Button>
                  <Button type="button" variant={openPlace === "eye" ? "default" : "outline"} aria-pressed={openPlace === "eye"} onClick={() => { setPinMode(null); setOpenPlace(openPlace === "eye" ? null : "eye"); }}>
                    <span className="size-3 rounded-full" style={{ backgroundColor: "#22c55e" }} aria-hidden="true" />
                    {L("眼睛開合", "Eye")}
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground" role="status">
                  {openPlace
                    ? L("請在照片上點出位置。", "Tap the photo to place it.")
                    : opens.length
                      ? L(`已設定 ${opens.length} 個開合點。`, `${opens.length} open and close point(s) set.`)
                      : L("還沒有設定開合點。", "No open and close points yet.")}
                </p>
                {opens.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {opens.map((o, i) => (
                      <Button key={i} type="button" size="sm" variant={selectedOpen === i ? "default" : "outline"} aria-pressed={selectedOpen === i} onClick={() => { setSelectedOpen(i); setSelected(-1); setNudgeTarget(null); }}>
                        {L(`${i + 1}・${o.mode === "eye" ? "眼睛" : "嘴巴"}`, `${i + 1} ${o.mode === "eye" ? "Eye" : "Mouth"}`)}
                      </Button>
                    ))}
                  </div>
                )}
                {opens[selectedOpen] && (
                  <>
                    <Range
                      label={L("範圍大小", "Area size")}
                      value={opens[selectedOpen].r}
                      min={0.01}
                      max={0.12}
                      step={0.005}
                      onChange={(v) => setOpens((os) => os.map((o, i) => (i === selectedOpen ? { ...o, r: v } : o)))}
                    />
                    <Range
                      label={L("開合幅度", "Open amount")}
                      value={opens[selectedOpen].amount}
                      min={0.1}
                      max={1}
                      step={0.05}
                      onChange={(v) => setOpens((os) => os.map((o, i) => (i === selectedOpen ? { ...o, amount: v } : o)))}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOpens((os) => os.filter((_, i) => i !== selectedOpen));
                        setSelectedOpen(-1);
                      }}
                    >
                      {L(`刪除第 ${selectedOpen + 1} 個開合點`, `Delete point ${selectedOpen + 1}`)}
                    </Button>
                  </>
                )}
              </div>
              {(showSkeleton || nudgeTarget || selectedOpen >= 0) && (
                <NudgePad
                  title={nudgeTarget || nudgeAll ? nudgeTitle : selectedOpen >= 0 ? L("微調：開合點", "Fine-tune: open and close point") : L("微調：請先點選一個圓點", "Fine-tune: tap a dot first")}
                  disabled={!nudgeTarget && !nudgeAll && selectedOpen < 0}
                  all={nudgeAll}
                  onAll={setNudgeAll}
                  singleLabel={L("單選", "Single")}
                  allLabel={L("全選", "Select all")}
                  scopeLabel={L("移動範圍", "Move scope")}
                  hint={L(
                    "先點一下照片上的人型骨架圓點，或紅、藍點，再用方向鍵微調。十字標記就是正在微調的點。點一下走一小格，長按會連續移動，按越久越快。",
                    "Tap a skeleton dot (or a red or blue dot) on the photo, then use the arrows. The crosshair marks the dot being fine-tuned. Tap for one small step; hold to keep moving, faster the longer you hold.",
                  )}
                  doneLabel={L("微調完成", "Done")}
                  onNudge={nudge}
                  onDone={() => setNudgeTarget(null)}
                />
              )}
              {customs.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    {customs.map((c, i) => (
                      <Button key={i} type="button" size="sm" variant={selected === i ? "default" : "outline"} aria-pressed={selected === i} onClick={() => setSelected(i)}>
                        <span className="size-3 rounded-full" style={{ backgroundColor: GROUP_COLORS[i % GROUP_COLORS.length] }} aria-hidden="true" />
                        {L(`第 ${i + 1} 組・${joints ? PART_LABEL[resolveCustom(c, joints, 1, 1, 0.05).part] : ""}`, `Pair ${i + 1}`)}
                      </Button>
                    ))}
                  </div>
                  {customs[selected] && (
                    <>
                      {joints && (
                        <p className="text-xs leading-relaxed text-muted-foreground" role="status">
                          {resolveCustom(customs[selected], joints, 1, 1, 0.05).part === "free"
                            ? L("系統判定：沒有對到人體，會用自由點擺動。請先做人型對位，或把點移到人體上。", "No body part matched; it will swing as a free point. Fit the skeleton first or move the dots onto the body.")
                            : L(`系統判定：${PART_LABEL[resolveCustom(customs[selected], joints, 1, 1, 0.05).part]}，整個部位會一起擺動。`, "Body part detected; the whole part swings together.")}
                        </p>
                      )}
                      <Range
                        label={L(`第 ${selected + 1} 組的擺動角度（0° 到 10°）`, `Swing angle of pair ${selected + 1} (0° to 10°)`)}
                        value={customs[selected].angle}
                        min={0}
                        max={10}
                        step={0.5}
                        onChange={(v) => setCustoms((cs) => cs.map((c, i) => (i === selected ? { ...c, angle: v } : c)))}
                        suffix="°"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setCustoms((cs) => cs.filter((_, i) => i !== selected));
                          setSelected(-1);
                          setNudgeTarget(null);
                        }}
                      >
                        {L(`刪除第 ${selected + 1} 組`, `Delete pair ${selected + 1}`)}
                      </Button>
                    </>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCustoms([]);
                      setSelected(-1);
                      setPending(null);
                      setNudgeTarget(null);
                    }}
                  >
                    {L("清除全部", "Clear all")}
                  </Button>
                </div>
              )}
              <Button type="button" className="h-12" disabled={detecting || !joints} onClick={() => setStage("preview")}>
                <Check className="size-5" aria-hidden="true" />
                {L("點陣完成，預覽測試", "Dots done, preview")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStage("cut")}>
                {L("返回選去背或跳過", "Back to cutout choice")}
              </Button>
            </>
          )}

          {stage === "micro" && (
            <>
              <details className="rounded-md border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{L("鏡頭設定（路徑、強度、速度…）", "Camera settings (path, strength, speed...)")}</summary>
                <div className="mt-3 flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={L("鏡頭路徑", "Camera path")}>
                    {(
                      [
                        ["sway", L("左右飄移", "Sway")],
                        ["vertical", L("上下飄移", "Rise and fall")],
                        ["orbit", L("繞圈", "Orbit")],
                        ["push", L("慢慢推近", "Push in")],
                        ["pull", L("慢慢拉遠", "Pull out")],
                      ] as [CameraPath, string][]
                    ).map(([id, label]) => (
                      <Button key={id} type="button" role="radio" aria-checked={cameraPath === id} variant={cameraPath === id ? "default" : "outline"} onClick={() => setCameraPath(id)}>
                        {label}
                      </Button>
                    ))}
                  </div>
                  <Range label={L("立體強度（移動範圍）", "Depth strength (range)")} value={strength} min={0} max={2} step={0.1} onChange={setStrength} suffix="x" />
                  <Range label={L("鏡頭速度（每 4 秒循環次數）", "Camera speed (loops per 4 s)")} value={speed} min={1} max={3} step={1} onChange={setSpeed} suffix="x" />
                  <Range label={L("聚焦距離（0 遠景、1 近景，這一層不動）", "Focus depth (0 far, 1 near; this layer stays still)")} value={focus} min={0} max={1} step={0.05} onChange={setFocus} />
                  <Range label={L("呼吸感", "Breathing")} value={breath} min={0} max={1} step={0.1} onChange={setBreath} />
                  <Range label={L("浮動光點", "Floating specks")} value={dust} min={0} max={1} step={0.1} onChange={setDust} />
                </div>
              </details>
              <MicroPanel
                micro={micro}
                onMicro={setMicro}
                mode={microMode}
                onMode={setMicroMode}
                amount={microAmount}
                onAmount={setMicroAmount}
                speed={microSpeed}
                onSpeed={setMicroSpeed}
                adjust={adjust}
                onAdjust={setAdjust}
              />
              {adjust && (
                <NudgePad
                  title={jointNudge || nudgeAll ? nudgeTitle : L("微調：請先點選一個圓點", "Fine-tune: tap a dot first")}
                  disabled={!jointNudge && !nudgeAll}
                  all={nudgeAll}
                  onAll={setNudgeAll}
                  singleLabel={L("單選", "Single")}
                  allLabel={L("全選", "Select all")}
                  scopeLabel={L("移動範圍", "Move scope")}
                  hint={L(
                    "先點一下照片上的人型骨架圓點，再用方向鍵微調。十字標記就是正在微調的點。點一下走一小格，長按會連續移動，按越久越快。",
                    "Tap a skeleton dot on the photo, then use the arrows. The crosshair marks the dot being fine-tuned. Tap for one small step; hold to keep moving, faster the longer you hold.",
                  )}
                  doneLabel={L("微調完成", "Done")}
                  onNudge={nudge}
                  onDone={() => setNudgeTarget(null)}
                />
              )}
              <Button
                type="button"
                className="h-12"
                onClick={() => {
                  setAdjust(false);
                  setNudgeTarget(null);
                  setStage("preview");
                }}
              >
                <Check className="size-5" aria-hidden="true" />
                {L("設定完成，預覽", "Settings done, preview")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStage("motion")}>
                {L("返回選動畫方式", "Back to methods")}
              </Button>
            </>
          )}

          {stage === "preview" && (
            <>
              {style !== "depth" && (
                <>
                  {customs.length === 0 && opens.length === 0 && !motion && (
                    <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground" role="status">
                      {L(
                        "目前沒有任何動作。請返回點陣佈局設定軸心點與擺動點，或在下方選一個預設動作。",
                        "There is no motion yet. Go back to the dot layout to set pivot and swing points, or pick a preset action below.",
                      )}
                    </p>
                  )}
                  {customs.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {customs.map((c, i) => (
                          <Button key={i} type="button" size="sm" variant={selected === i ? "default" : "outline"} aria-pressed={selected === i} onClick={() => setSelected(i)}>
                            <span className="size-3 rounded-full" style={{ backgroundColor: GROUP_COLORS[i % GROUP_COLORS.length] }} aria-hidden="true" />
                            {L(`第 ${i + 1} 組・${joints ? PART_LABEL[resolveCustom(c, joints, 1, 1, 0.05).part] : ""}`, `Pair ${i + 1}`)}
                          </Button>
                        ))}
                      </div>
                      {customs[selected] && (
                        <Range
                          label={L(`第 ${selected + 1} 組的擺動角度`, `Swing angle of pair ${selected + 1}`)}
                          value={customs[selected].angle}
                          min={0}
                          max={10}
                          step={0.5}
                          onChange={(v) => setCustoms((cs) => cs.map((c, i) => (i === selected ? { ...c, angle: v } : c)))}
                          suffix="°"
                        />
                      )}
                      <Range label={L("動作大小（全部擺動）", "Motion size (all swings)")} value={swingSize} min={0.1} max={1.5} step={0.1} onChange={setSwingSize} suffix="x" />
                      <Range label={L("活動範圍寬度", "Swing area width")} value={swingWidth} min={0.02} max={0.12} step={0.01} onChange={setSwingWidth} />
                    </>
                  )}
                  <Range label={L("淡化原影像", "Fade original image")} value={ghostFade} min={0} max={1} step={0.05} onChange={setGhostFade} />
                  <Range label={L("融合臨近影像（背景填補）", "Blend with nearby image (background fill)")} value={blend} min={0} max={1} step={0.05} onChange={setBlend} />
                  <Range label={L("邊緣柔化", "Edge softness")} value={feather} min={0} max={1} step={0.05} onChange={setFeather} />
                  <HelpNote showLabel={L("查看說明", "Show help")} hideLabel={L("收起說明", "Hide help")}>
                    {L(
                      "淡化原影像：部位離開原位時，原本位置的影像淡出。融合臨近影像：越高，露出來的背景越像附近的顏色。邊緣柔化：讓動的部位邊緣和背景更自然。",
                      "Fade: the original image fades when a part moves away. Blend: higher makes the revealed background match nearby colours. Softness: smooths the edge of the moving part.",
                    )}
                  </HelpNote>
                  <details className="rounded-md border border-border px-3 py-2">
                    <summary className="cursor-pointer text-sm font-medium">{L("預設動作（選用）", "Preset action (optional)")}</summary>
                    <div className="mt-3">{motionPicker}</div>
                  </details>
                </>
              )}
              <Button type="button" className="h-12" onClick={() => setStage("locked")}>
                <Lock className="size-5" aria-hidden="true" />
                {L("確認鎖定", "Confirm and lock")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setStage(style === "depth" ? "micro" : "pose")}>
                {style === "depth" ? L("返回重做微動", "Back to redo the motion") : L("返回點陣佈局", "Back to the dot layout")}
              </Button>
            </>
          )}

          {stage === "locked" && (
            <>
              <HelpNote showLabel={L("查看說明", "Show help")} hideLabel={L("收起說明", "Hide help")}>
                {L(
                  "已鎖定。接下來可以進入全功能編輯（加文字、音樂、濾鏡等，會有自己的預覽），也可以跳過，直接下載。",
                  "Locked. You can open the full editor (text, music, filters and more, with its own preview), or skip it and download right away.",
                )}
              </HelpNote>
              <div className="flex flex-col gap-2">
            <p className="text-sm font-medium" id="export-length-label">{L("短片長度", "Clip length")}</p>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-labelledby="export-length-label">
              {[4, 8, 12, 16].map((sec) => (
                <Button key={sec} type="button" role="radio" aria-checked={duration === sec} variant={duration === sec ? "default" : "outline"} disabled={exporting} onClick={() => setDuration(sec)}>
                  {L(`${sec} 秒`, `${sec} s`)}
                </Button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {L("動作每 4 秒一個循環，所以長度選 4 的倍數，影片頭尾剛好接上。", "Motion loops every 4 seconds, so lengths in multiples of 4 join up cleanly.")}
            </p>
          </div>
          {exportingStatus}
              <Button type="button" className="h-12" disabled={exporting} onClick={() => void keepEditing()}>
                <ArrowRight className="size-5" aria-hidden="true" />
                {L("進入全功能編輯", "Open the full editor")}
              </Button>
              <Button type="button" variant="outline" className="h-12" disabled={exporting} onClick={() => void downloadVideo()}>
                <Download className="size-5" aria-hidden="true" />
                {L("跳過，直接下載／儲存", "Skip, download now")}
              </Button>
              <Button type="button" variant="ghost" disabled={exporting} onClick={() => setStage("preview")}>
                {L("解除鎖定，返回預覽", "Unlock and go back to the preview")}
              </Button>
            </>
          )}
        </section>
      )}

      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
      <SaveDialog pending={pendingSave} onClose={() => setPendingSave(null)} />
    </div>
  );
}
