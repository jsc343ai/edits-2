"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Button, buttonVariants } from "@/components/ui/button";
import { encodeGif, quantize as quantizeFrame } from "@/lib/gif";
import { SWAP_TEMPLATES } from "@/lib/swap-templates";
import { DEFAULT_HEAD, DEFAULT_STYLE, FACE_SIZE, TRACK_W, applyMotion, createEraseMask, drawFaceOverlay, drawSwapFrame, interpolateHead, matchPatch, paintMask, pointToFace, prepareFace, toGray, toMotion, trackStep, type FaceStyle, type HeadKey, type HeadPose, type MotionKey } from "@/lib/local-swap";

function SliderRow({ label, value, min, max, step, onChange, format, disabled, nudge: nudgeProp }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; disabled?: boolean; nudge?: number }) {
  const nudge = nudgeProp ?? step;
  const bump = (dir: number) => {
    if (!nudge) return;
    const next = Math.min(max, Math.max(min, Number((value + dir * nudge).toFixed(4))));
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-muted-foreground">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <div className="flex items-center gap-2">
        {nudge ? (
          <button type="button" onClick={() => bump(-1)} disabled={disabled || value <= min} aria-label={`${label} 微調減少`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-lg font-semibold text-secondary-foreground active:bg-accent disabled:opacity-50">
            {"−"}
          </button>
        ) : null}
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} className="w-full accent-primary disabled:opacity-50" aria-label={label} />
        {nudge ? (
          <button type="button" onClick={() => bump(1)} disabled={disabled || value >= max} aria-label={`${label} 微調增加`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-lg font-semibold text-secondary-foreground active:bg-accent disabled:opacity-50">
            +
          </button>
        ) : null}
      </div>
    </div>
  );
}

async function fetchVideoBlob(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  if (blob.size < 10000) throw new Error(`檔案太小（${blob.size} bytes）`);
  return blob;
}

async function fetchClipAsBlobUrl(templateId: string) {
  const tpl = SWAP_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) throw new Error("找不到範本");
  let blob: Blob;
  try {
    blob = await fetchVideoBlob(tpl.clipUrl);
  } catch (localError) {
    if (!tpl.sourceUrl) throw localError;
    blob = await fetchVideoBlob(`/api/fal/download?url=${encodeURIComponent(tpl.sourceUrl)}&name=clip.mp4`);
  }
  return URL.createObjectURL(new Blob([blob], { type: "video/mp4" }));
}

export function LocalSwapLab({ variant = "admin", mode = "hand" }: { variant?: "admin" | "player"; mode?: "hand" | "ai" }) {
  const [templateId, setTemplateId] = useState(SWAP_TEMPLATES[0].id);
  const template = SWAP_TEMPLATES.find((t) => t.id === templateId) ?? SWAP_TEMPLATES[0];
  const { data: clipSrc, error: clipError } = useSWR(template.id, fetchClipAsBlobUrl, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(false);

  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [face, setFace] = useState<HTMLCanvasElement | null>(null);
  const [tone, setTone] = useState(0.2);
  const [style, setStyle] = useState<FaceStyle>(DEFAULT_STYLE);
  const [opacity, setOpacity] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [head, setHead] = useState<HeadPose>(DEFAULT_HEAD);
  const [keys, setKeys] = useState<HeadKey[]>([]);
  const [busy, setBusy] = useState<"idle" | "preview" | "export" | "track">("idle");
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportExt, setExportExt] = useState("webm");
  const [gifSeconds, setGifSeconds] = useState(4);
  const [message, setMessage] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [ratio, setRatio] = useState(9 / 16);
  const [brushOn, setBrushOn] = useState(false);
  const [brushMode, setBrushMode] = useState<"erase" | "restore">("erase");
  const [brushSize, setBrushSize] = useState(0.1);
  const [brushSoft, setBrushSoft] = useState(0.6);
  const [maskVer, setMaskVer] = useState(0);
  const [assistText, setAssistText] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);

  const headRef = useRef(head);
  const keysRef = useRef(keys);
  const faceRef = useRef(face);
  const toneRef = useRef(tone);
  const opacityRef = useRef(opacity);
  headRef.current = head;
  keysRef.current = keys;
  faceRef.current = face;
  toneRef.current = tone;
  opacityRef.current = opacity;

  const [motion, setMotion] = useState<MotionKey[]>([]);
  const [locked, setLocked] = useState(false);
  const [motionText, setMotionText] = useState("");
  const motionRef = useRef(motion);
  const lockedRef = useRef(locked);
  const baseRef = useRef<HeadPose | null>(null);
  motionRef.current = motion;
  lockedRef.current = locked;

  function poseAt(t: number): HeadPose | null {
    if (lockedRef.current && baseRef.current && motionRef.current.length > 0) return applyMotion(baseRef.current, motionRef.current, t);
    return interpolateHead(keysRef.current, t);
  }

  const draw = useCallback((pose?: HeadPose | null) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!video || !canvas || !ctx || canvas.width === 0) return;
    drawFaceOverlay(ctx, video, faceRef.current, pose ?? headRef.current, toneRef.current, opacityRef.current);
  }, []);

  useEffect(() => {
    if (!photo) {
      setFace(null);
      return;
    }
    maskRef.current ??= createEraseMask();
    setFace(prepareFace(photo, crop, style, maskRef.current));
  }, [photo, crop, style, maskVer]);

  useEffect(() => {
    if (!playingRef.current) draw();
  }, [face, tone, opacity, head, draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas && canvas.width === 300 && canvas.height === 150) {
      canvas.width = 540;
      canvas.height = 960;
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (exportUrl) URL.revokeObjectURL(exportUrl);
    };
  }, [exportUrl]);

  function onMeta() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    setDuration(video.duration);
    if (video.videoWidth && video.videoHeight) setRatio(video.videoWidth / video.videoHeight);
    video.currentTime = 0;
    kickFrame();
  }

  function kickFrame() {
    const video = videoRef.current;
    if (!video || video.readyState >= 2 || playingRef.current) return;
    video
      .play()
      .then(() => {
        video.pause();
        video.currentTime = 0;
      })
      .catch(() => {});
  }

  function onFrameReady() {
    setFrameReady(true);
    if (!playingRef.current) draw();
  }

  function onSeeked() {
    const video = videoRef.current;
    if (!video || playingRef.current) return;
    const t = video.currentTime;
    setTime(t);
    const pose = poseAt(t);
    if (pose) setHead(pose);
    draw(pose);
  }

  function seek(t: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t;
  }

  function onPhoto(file: File | undefined) {
    if (!file) return;
    kickFrame();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      maskRef.current = createEraseMask();
      setPhoto(img);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function removePhoto() {
    setPhoto(null);
    setFace(null);
    maskRef.current = createEraseMask();
    setMaskVer((v) => v + 1);
    setKeys([]);
    setLocked(false);
    baseRef.current = null;
    setHead(DEFAULT_HEAD);
    setCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
    setExportUrl(null);
    setMessage(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
    setNotice("已刪除這張大頭照，請重新選一張。");
  }

  function runAssistant() {
    const text = assistText.trim();
    if (!text) return;
    const has = (...words: string[]) => words.some((w) => text.includes(w));
    const notes: string[] = [];
    if (!lockedRef.current) {
      const move = (dx: number, dy: number, ds: number, label: string) => {
        setHead((h) => ({ ...h, x: Math.min(1, Math.max(0, h.x + dx)), y: Math.min(1, Math.max(0, h.y + dy)), size: Math.min(0.6, Math.max(0.05, h.size + ds)) }));
        notes.push(label);
      };
      if (has("放大", "大一點", "變大")) move(0, 0, 0.02, "臉放大一點");
      if (has("縮小", "小一點", "變小")) move(0, 0, -0.02, "臉縮小一點");
      if (has("往左", "向左", "左移", "左邊一點")) move(-0.01, 0, 0, "臉往左移");
      if (has("往右", "向右", "右移", "右邊一點")) move(0.01, 0, 0, "臉往右移");
      if (has("往上", "向上", "上移", "高一點")) move(0, -0.01, 0, "臉往上移");
      if (has("往下", "向下", "下移", "低一點")) move(0, 0.01, 0, "臉往下移");
    }
    if (has("自然", "融合", "柔", "淡化", "突兀")) {
      setStyle((s) => ({ ...s, feather: Math.min(0.7, s.feather + 0.1), soften: Math.min(0.8, s.soften + 0.15), forehead: Math.min(0.6, s.forehead + 0.08) }));
      notes.push("邊緣更柔、額頭更淡");
    }
    if (has("亮一點", "變亮", "提亮")) {
      setStyle((s) => ({ ...s, brightness: Math.min(0.4, s.brightness + 0.06) }));
      notes.push("臉調亮一點");
    }
    if (has("暗一點", "變暗", "調暗")) {
      setStyle((s) => ({ ...s, brightness: Math.max(-0.4, s.brightness - 0.06) }));
      notes.push("臉調暗一點");
    }
    if (has("膚色", "色差")) {
      setTone((v) => Math.min(0.6, v + 0.1));
      notes.push("膚色更貼近範本");
    }
    if (has("還原", "重設", "重來")) {
      setStyle(DEFAULT_STYLE);
      setOpacity(1);
      setTone(0.2);
      notes.push("融合設定已還原");
    }
    setMessage(null);
    setNotice(notes.length > 0 ? `AI 助理已調整：${notes.join("、")}。` : "我聽不懂這個指令。可以說：臉放大一點、往左移、融合自然一點、亮一點、膚色貼近、還原。");
  }

  function pointerToHead(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setHead((h) => ({ ...h, x, y }));
  }

  function brushAt(e: React.PointerEvent<HTMLCanvasElement>) {
    const mask = maskRef.current;
    const canvas = canvasRef.current;
    if (!mask || !canvas || !canvas.height) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const p = pointToFace(nx, ny, headRef.current, canvas.width / canvas.height);
    paintMask(mask, p.u, p.v, brushSize * FACE_SIZE, brushSoft, brushMode === "restore");
    setMaskVer((v) => v + 1);
  }

  function recordKey() {
    const t = Number(time.toFixed(2));
    setKeys((ks) => [...ks.filter((k) => Math.abs(k.t - t) > 0.04), { t, ...head }].sort((a, b) => a.t - b.t));
  }

  function removeKey(t: number) {
    setKeys((ks) => ks.filter((k) => k.t !== t));
  }

  const cancelRef = useRef(false);

  function seekTo(video: HTMLVideoElement, t: number) {
    return new Promise<void>((resolve) => {
      if (Math.abs(video.currentTime - t) < 0.01) {
        resolve();
        return;
      }
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = t;
      setTimeout(resolve, 1500);
    });
  }

  function playThrough(video: HTMLVideoElement, paint: (pose: HeadPose) => void = draw) {
    return new Promise<void>((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        video.removeEventListener("ended", finish);
        video.pause();
        resolve();
      };
      timer = setTimeout(finish, ((video.duration || 10) + 3) * 1000);
      video.addEventListener("ended", finish);
      const tick = () => {
        if (done) return;
        const t = video.currentTime;
        paint(poseAt(t) ?? headRef.current);
        setTime(t);
        if (cancelRef.current || (video.duration && t >= video.duration - 0.05)) {
          finish();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      video
        .play()
        .then(() => {
          rafRef.current = requestAnimationFrame(tick);
        })
        .catch((err) => {
          done = true;
          if (timer) clearTimeout(timer);
          video.removeEventListener("ended", finish);
          reject(err);
        });
    });
  }

  async function preview() {
    const video = videoRef.current;
    if (!video) return;
    setMessage(null);
    cancelRef.current = false;
    playingRef.current = true;
    setBusy("preview");
    try {
      await seekTo(video, 0);
      await playThrough(video);
    } catch {
      setMessage("這個瀏覽器無法連續播放預覽，請改用上面的「播放位置」滑桿逐格查看，或直接按「匯出換臉 Gif」。");
    } finally {
      playingRef.current = false;
      setBusy("idle");
    }
  }

  async function exportGif() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (!duration || canvas.width === 0) {
      setMessage("範本短片還沒有載入完成，請稍等幾秒再試。");
      return;
    }
    setMessage(null);
    setExportUrl(null);
    cancelRef.current = false;
    playingRef.current = true;
    setBusy("export");
    try {
      const fps = 10;
      const frames = Math.max(1, Math.round(Math.min(duration, gifSeconds) * fps));
      const outW = 320;
      const outH = Math.round((outW * canvas.height) / canvas.width);
      const out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      const octx = out.getContext("2d", { willReadFrequently: true });
      if (!octx) throw new Error("no canvas");
      const indexed: Uint8Array[] = [];
      for (let i = 0; i < frames; i++) {
        if (cancelRef.current) break;
        const t = Math.min(i / fps, Math.max(0, duration - 0.05));
        await seekTo(video, t);
        drawSwapFrame(octx, video, faceRef.current, poseAt(t) ?? headRef.current, toneRef.current, opacityRef.current);
        const { data } = octx.getImageData(0, 0, outW, outH);
        indexed.push(quantizeFrame(data, outW, outH));
        setTime(t);
      }
      if (cancelRef.current) {
        setMessage("已取消匯出。");
      } else {
        const blob = encodeGif(indexed, outW, outH, Math.round(100 / fps));
        setExportExt("gif");
        setExportUrl(URL.createObjectURL(blob));
      }
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setMessage(`Gif 匯出失敗（${detail}）。請把括號裡的文字告訴我。`);
    } finally {
      playingRef.current = false;
      setBusy("idle");
    }
  }

  async function exportClip() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
      setMessage("這個瀏覽器不支援錄製影片，請改按「匯出換臉 Gif」。");
      return;
    }
    setMessage(null);
    setExportUrl(null);
    const types = ["video/mp4", "video/webm;codecs=vp9", "video/webm"];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) {
      setMessage("這個瀏覽器沒有可用的影片格式。");
      return;
    }
    setExportExt(mime.startsWith("video/mp4") ? "mp4" : "webm");
    const comp = document.createElement("canvas");
    comp.width = canvas.width;
    comp.height = canvas.height;
    const compCtx = comp.getContext("2d");
    if (!compCtx) return;
    const paintBoth = (pose: HeadPose) => {
      drawSwapFrame(compCtx, video, faceRef.current, pose, toneRef.current, opacityRef.current);
      draw(pose);
    };
    const recorder = new MediaRecorder(comp.captureStream(30), { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    cancelRef.current = false;
    playingRef.current = true;
    setBusy("export");
    try {
      await seekTo(video, 0);
      paintBoth(poseAt(0) ?? headRef.current);
      recorder.start(250);
      await playThrough(video, paintBoth);
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      if (cancelRef.current) {
        setMessage("已取消匯出。");
      } else if (chunks.length === 0) {
        throw new Error("empty recording");
      } else {
        setExportUrl(URL.createObjectURL(new Blob(chunks, { type: mime })));
      }
    } catch {
      if (recorder.state !== "inactive") recorder.stop();
      setMessage("影片匯出失敗：這個瀏覽器無法錄製短片。請改按「匯出換臉 Gif」。");
    } finally {
      playingRef.current = false;
      setBusy("idle");
    }
  }

  async function autoTrack() {
    const video = videoRef.current;
    if (!video || !duration || !video.videoWidth) {
      setMessage("範本短片還沒有載入完成，請稍等幾秒再試。");
      return;
    }
    setMessage(null);
    setNotice(null);
    cancelRef.current = false;
    playingRef.current = true;
    setBusy("track");
    try {
      const startT = Number(video.currentTime.toFixed(2));
      const start = headRef.current;
      const gw = TRACK_W;
      const gh = Math.round((gw * video.videoHeight) / video.videoWidth);
      const tc = document.createElement("canvas");
      tc.width = gw;
      tc.height = gh;
      const tctx = tc.getContext("2d", { willReadFrequently: true });
      if (!tctx) throw new Error("no canvas");
      const grab = async (t: number) => {
        await seekTo(video, t);
        tctx.drawImage(video, 0, 0, gw, gh);
        return toGray(tctx.getImageData(0, 0, gw, gh).data, gw, gh);
      };
      let prev = await grab(startT);
      const ref = prev;
      // Two small patches sit on the brows and eyes, fully inside the head, so the background never leaks into the match.
      const fh0 = start.size * gh;
      const d = Math.max(6, fh0 * 0.16);
      const half = Math.max(5, Math.min(26, Math.round(fh0 * 0.1)));
      const eye = fh0 * 0.08;
      const baseDist = d * 2;
      const cosS = Math.cos(start.rot);
      const sinS = Math.sin(start.rot);
      let ax = start.x * gw - d * cosS + eye * sinS;
      let ay = start.y * gh - d * sinS - eye * cosS;
      let bx = start.x * gw + d * cosS + eye * sinS;
      let by = start.y * gh + d * sinS - eye * cosS;
      const ax0 = ax;
      const ay0 = ay;
      const bx0 = bx;
      const by0 = by;
      // Third patch on the nose is the vertical bar of the crosshair; the brow pair is the horizontal bar.
      const v = fh0 * 0.24;
      const baseV = eye + v;
      let cx = start.x * gw - v * sinS;
      let cy = start.y * gh + v * cosS;
      const cx0 = cx;
      const cy0 = cy;
      let lastA = { dx: 0, dy: 0 };
      let lastB = { dx: 0, dy: 0 };
      let lastC = { dx: 0, dy: 0 };
      const pts: HeadKey[] = [{ t: startT, x: start.x, y: start.y, size: start.size, rot: start.rot }];
      for (let t = startT + 0.05; t <= duration - 0.03; t += 0.05) {
        if (cancelRef.current) break;
        const cur = await grab(t);
        const ra = trackStep(prev, cur, ax, ay, half, 12);
        const rb = trackStep(prev, cur, bx, by, half, 12);
        const rc = trackStep(prev, cur, cx, cy, half, 12);
        const da = ra.score > 45 ? { dx: lastA.dx * 0.7, dy: lastA.dy * 0.7 } : { dx: ra.cx - ax, dy: ra.cy - ay };
        const db = rb.score > 45 ? { dx: lastB.dx * 0.7, dy: lastB.dy * 0.7 } : { dx: rb.cx - bx, dy: rb.cy - by };
        const dc = rc.score > 45 ? { dx: lastC.dx * 0.7, dy: lastC.dy * 0.7 } : { dx: rc.cx - cx, dy: rc.cy - cy };
        lastA = da;
        lastB = db;
        lastC = dc;
        ax += da.dx;
        ay += da.dy;
        bx += db.dx;
        by += db.dy;
        cx += dc.dx;
        cy += dc.dy;
        const refA = matchPatch(ref, cur, ax0, ay0, ax, ay, half, 3);
        const refB = matchPatch(ref, cur, bx0, by0, bx, by, half, 3);
        if (refA.score < 22) {
          ax = refA.cx;
          ay = refA.cy;
        }
        if (refB.score < 22) {
          bx = refB.cx;
          by = refB.cy;
        }
        const refC = matchPatch(ref, cur, cx0, cy0, cx, cy, half, 3);
        if (refC.score < 22) {
          cx = refC.cx;
          cy = refC.cy;
        }
        const midX = (ax + bx) / 2;
        const midY = (ay + by) / 2;
        const ratioH = Math.hypot(bx - ax, by - ay) / baseDist;
        const ratioV = Math.hypot(cx - midX, cy - midY) / baseV;
        const ratio = Math.max(0.5, Math.min(2, ratioH * 0.6 + ratioV * 0.4));
        const rotH = Math.atan2(by - ay, bx - ax);
        const rotV = Math.atan2(-(cx - midX), cy - midY);
        const rotMean = Math.atan2(Math.sin(rotH) * 0.5 + Math.sin(rotV) * 0.5, Math.cos(rotH) * 0.5 + Math.cos(rotV) * 0.5);
        const rot = Math.max(start.rot - 0.8, Math.min(start.rot + 0.8, rotMean));
        const sinR = Math.sin(rot);
        const cosR = Math.cos(rot);
        const mx = ((midX - eye * ratio * sinR) + (cx + v * ratio * sinR)) / 2;
        const my = ((midY + eye * ratio * cosR) + (cy - v * ratio * cosR)) / 2;
        pts.push({ t: Number(t.toFixed(2)), x: mx / gw, y: my / gh, size: Math.max(0.05, Math.min(0.6, start.size * ratio)), rot });
        prev = cur;
        setTime(t);
      }
      const smooth = pts.map((p, i) => {
        const lo = Math.max(0, i - 3);
        const hi = Math.min(pts.length - 1, i + 3);
        const n = hi - lo + 1;
        let sx = 0;
        let sy = 0;
        let ss = 0;
        let sr = 0;
        for (let j = lo; j <= hi; j++) {
          sx += pts[j].x;
          sy += pts[j].y;
          ss += pts[j].size;
          sr += pts[j].rot;
        }
        return { t: p.t, x: sx / n, y: sy / n, size: ss / n, rot: sr / n };
      });
      smooth[0] = pts[0];
      setKeys((ks) => [...ks.filter((k) => k.t < startT - 0.04), ...smooth]);
      await seekTo(video, startT);
      setNotice(cancelRef.current ? "已取消追蹤，已保留追蹤到目前為止的位置。" : `追蹤完成，共記錄 ${pts.length} 格。拖動「播放位置」或按「播放預覽」，看臉有沒有跟著範本頭部移動。`);
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setMessage(`自動追蹤失敗（${detail}）。請把括號裡的文字告訴我。`);
    } finally {
      playingRef.current = false;
      setBusy("idle");
    }
  }

  function saveMotion() {
    const sorted = [...keysRef.current].sort((a, b) => a.t - b.t);
    if (sorted.length < 2) {
      setMessage("請先用上面的追蹤功能，從 0 秒追蹤到結尾，再存成範本移動參數。");
      return;
    }
    if (sorted[0].t > 0.15) {
      setMessage("範本移動參數要從 0 秒開始追蹤，請回到 0 秒重新追蹤。");
      return;
    }
    const m = toMotion(sorted);
    setMotion(m);
    setMotionText(JSON.stringify(m));
    setKeys([]);
    setLocked(false);
    baseRef.current = null;
    setMessage(null);
    setNotice(`已存成範本移動參數（${m.length} 格）。接著請在 0 秒把臉對準範本的頭，再按「整合」。`);
    seek(0);
  }

  function loadMotionText() {
    try {
      const parsed = JSON.parse(motionText) as MotionKey[];
      const ok = Array.isArray(parsed) && parsed.length > 1 && parsed.every((k) => [k.t, k.dx, k.dy, k.s, k.r].every((n) => typeof n === "number" && Number.isFinite(n)));
      if (!ok) throw new Error("format");
      setMotion([...parsed].sort((a, b) => a.t - b.t));
      setKeys([]);
      setLocked(false);
      baseRef.current = null;
      setMessage(null);
      setNotice(`已載入範本移動參數（${parsed.length} 格）。接著請在 0 秒把臉對準範本的頭，再按「整合」。`);
      seek(0);
    } catch {
      setMessage("移動參數格式不對，請貼上完整的文字。");
    }
  }

  function lockIntegration() {
    const video = videoRef.current;
    if (!video) return;
    const tracked = [...keysRef.current].sort((a, b) => a.t - b.t);
    if (motion.length === 0 && tracked.length < 2) {
      setMessage("還沒有移動資料：請先按上面的「自動追蹤」，追蹤完再按整合。");
      return;
    }
    if (!photo) {
      setMessage("請先選大頭照。");
      return;
    }
    if (video.currentTime > 0.15) {
      setMessage("請先按「回到 0 秒」，在 0 秒的畫面把臉對準範本的頭，再按「整合」。");
      return;
    }
    if (motion.length === 0) {
      if (tracked[0].t > 0.15) {
        setMessage("追蹤要從 0 秒開始，請回到 0 秒重新追蹤。");
        return;
      }
      const m = toMotion(tracked);
      motionRef.current = m;
      setMotion(m);
      setKeys([]);
    }
    baseRef.current = { ...headRef.current };
    setLocked(true);
    setMessage(null);
    setNotice("已整合鎖定：臉已經跟範本的移動綁在一起。拖動「播放位置」或按「播放預覽」查看。");
  }

  function unlockIntegration() {
    setLocked(false);
    baseRef.current = null;
    setNotice("已解除鎖定，可以重新對位。");
  }

  const hasPath = (locked && motion.length > 0) || keys.length > 0;
  const trackJson = JSON.stringify(keys.map((k) => ({ t: k.t, x: +k.x.toFixed(3), y: +k.y.toFixed(3), size: +k.size.toFixed(3), rot: +k.rot.toFixed(3) })));
  const working = busy !== "idle";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        免費的換臉編輯，不呼叫 Fal，不扣費。流程：1 選範本、2 選大頭照、3 預覽並對位、4 追蹤並整合、5 融合修飾、6 手工筆刷、7 播放預覽、8 匯出並下載。
      </p>

      <div className="flex flex-col gap-2">
        <label htmlFor="local-template" className="text-sm font-medium">
          1. 選範本短片
        </label>
        <select
          id="local-template"
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value);
            setFrameReady(false);
            setKeys([]);
            setMotion([]);
            setMotionText("");
            setLocked(false);
            baseRef.current = null;
            setExportUrl(null);
          }}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm"
        >
          {SWAP_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.zh}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="local-photo" className="text-sm font-medium">
          2. 選大頭照（正面、清楚、光線均勻）
        </label>
        <input ref={photoInputRef} id="local-photo" type="file" accept="image/*" onChange={(e) => onPhoto(e.target.files?.[0])} className="text-sm" />
        {photo ? (
          <Button type="button" variant="outline" onClick={removePhoto} disabled={working}>
            刪除這張大頭照（編輯壞了，重新選一張）
          </Button>
        ) : null}
      </div>

      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-background pb-2">
        <p className="text-sm font-medium">3. 預覽畫面（選好範本和大頭照後，臉會直接出現在這裡）</p>
        <div className="relative mx-auto overflow-hidden rounded-lg border border-border bg-muted" style={{ aspectRatio: ratio, width: `min(100%, ${(45 * ratio).toFixed(2)}vh)` }}>
        <video
          key={template.id}
          ref={videoRef}
          src={clipSrc}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={onMeta}
          onLoadedData={onFrameReady}
          onCanPlay={onFrameReady}
          onSeeked={onSeeked}
          onError={() => setMessage("範本短片載入失敗，請重新整理頁面，或換一個範本再試。")}
          className="pointer-events-none absolute inset-0 h-full w-full object-fill"
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none object-fill"
          onPointerDown={(e) => {
            if (working) return;
            kickFrame();
            e.currentTarget.setPointerCapture(e.pointerId);
            if (brushOn) brushAt(e);
            else if (!locked) pointerToHead(e);
          }}
          onPointerMove={(e) => {
            if (working || !e.buttons) return;
            if (brushOn) brushAt(e);
            else if (!locked) pointerToHead(e);
          }}
          aria-label="換臉預覽畫面，點選或拖曳可移動臉的位置"
        />
        </div>
        {clipError ? (
          <p role="alert" className="text-xs text-destructive">
            範本短片檔案讀取失敗（{clipError instanceof Error ? clipError.message : "未知原因"}），請把這行文字告訴我。
          </p>
        ) : !clipSrc ? (
          <p role="status" className="text-xs text-muted-foreground">
            正在下載範本短片檔案…
          </p>
        ) : !frameReady ? (
          <p role="status" className="text-xs text-muted-foreground">
            檔案已下載，範本畫面解碼中…如果一直沒出現，請點一下上面的預覽框。
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {photo ? "點選或拖曳畫面，移動臉的位置。也可以用下面的滑桿調整左右、上下、大小和傾斜。" : "請先在上面選大頭照，你的臉就會出現在這個預覽框裡。"}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">3. 對位：把臉對準範本的頭（每個滑桿兩側都有微調按鈕）</p>
        <SliderRow label="播放位置（秒）" value={time} min={0} max={duration || 1} step={0.05} onChange={seek} format={(v) => `${v.toFixed(1)} 秒`} />
        <SliderRow label="臉的左右位置" value={head.x} min={0} max={1} step={0.005} nudge={0.002} format={(v) => v.toFixed(3)} disabled={locked} onChange={(x) => setHead((h) => ({ ...h, x }))} />
        <SliderRow label="臉的上下位置" value={head.y} min={0} max={1} step={0.005} nudge={0.002} format={(v) => v.toFixed(3)} disabled={locked} onChange={(y) => setHead((h) => ({ ...h, y }))} />
        <SliderRow label="臉的大小" value={head.size} min={0.05} max={0.6} step={0.005} nudge={0.003} format={(v) => v.toFixed(3)} disabled={locked} onChange={(size) => setHead((h) => ({ ...h, size }))} />
        <SliderRow label="臉的傾斜" value={head.rot} min={-0.6} max={0.6} step={0.01} nudge={0.005} format={(v) => v.toFixed(3)} disabled={locked} onChange={(rot) => setHead((h) => ({ ...h, rot }))} />
        <Button type="button" onClick={autoTrack} disabled={!photo || !clipSrc || working || locked}>
          {busy === "track" ? `追蹤中 ${time.toFixed(1)} / ${duration.toFixed(0)} 秒` : "記錄這一格的位置，並鎖住範本頭部（自動追蹤到結尾）"}
        </Button>
        <Button type="button" variant="secondary" onClick={recordKey} disabled={!photo || working}>
          只記錄這一格（不追蹤）
        </Button>
        <p className="text-xs text-muted-foreground">
          用法：先拖到 0 秒，把臉對準範本的頭，再按「記錄這一格的位置，並鎖住範本頭部」。臉會跟著範本頭部移動，一直追蹤到影片結束。如果中途臉偏離了，拖到偏離的那一格，重新對準，再按一次同一個按鈕，會從那一格重新鎖住並接著追蹤，前面已經對的部分不會被改掉。
        </p>
        {notice ? (
          <p role="status" className="text-sm text-primary">
            {notice}
          </p>
        ) : null}
        {keys.length > 30 ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            已記錄 {keys.length} 格位置（自動追蹤）。
            <button type="button" onClick={() => setKeys([])} disabled={working} className="underline">
              清除全部
            </button>
          </p>
        ) : keys.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="已記錄的位置">
            {keys.map((k) => (
              <li key={k.t} className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs">
                <button type="button" onClick={() => seek(k.t)} className="underline">
                  {k.t.toFixed(1)} 秒
                </button>
                <button type="button" onClick={() => removeKey(k.t)} aria-label={`刪除 ${k.t.toFixed(1)} 秒的記錄`} className="px-1 text-muted-foreground">
                  刪除
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-primary/40 p-3">
        <p className="text-sm font-medium">4. 整合：鎖住範本的移動</p>
        <p className="text-xs text-muted-foreground">
          範本頭部的移動參數事先記錄好。玩家只要在 0 秒把臉對準範本的頭，按「整合」，系統就把範本的移動整套複製到玩家的臉上，兩邊同步播放，臉不會脫離。
        </p>
        <ol className="list-decimal pl-5 text-xs text-muted-foreground">
          <li>按「回到 0 秒」，範本回到起點。</li>
          <li>在預覽畫面把臉對準範本的頭（位置、大小、傾斜）。</li>
          <li>按「整合」鎖定。</li>
          <li>按「播放預覽」，再匯出。</li>
        </ol>
        <p role="status" className="text-xs text-muted-foreground">
          {motion.length > 0 ? `範本移動參數已就緒（${motion.length} 格）${locked ? "，已整合鎖定" : "，尚未整合"}。` : keys.length >= 2 ? `已追蹤 ${keys.length} 格，回到 0 秒對準頭後，就可以按「整合」。` : variant === "admin" ? "還沒有移動資料：請先用上面的「自動追蹤」，或在下面「範本製作用」載入參數。" : "請先用上面的「自動追蹤」，讓臉跟著範本的頭移動，再回到這裡按「整合」。"}
        </p>
        <Button type="button" variant="outline" onClick={() => seek(0)} disabled={working}>
          回到 0 秒（歸零）
        </Button>
        {locked ? (
          <Button type="button" variant="secondary" onClick={unlockIntegration} disabled={working}>
            解除鎖定，重新對位
          </Button>
        ) : (
          <Button type="button" onClick={lockIntegration} disabled={!photo || (motion.length === 0 && keys.length < 2) || working}>
            整合：鎖住範本的移動
          </Button>
        )}
      </div>

      {variant === "admin" ? (
      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">範本製作用（管理員）：記錄範本移動參數，每支範本只做一次</p>
        <p className="text-xs text-muted-foreground">
          先在 0 秒把臉對準頭，用上面的追蹤按鈕追蹤到結尾。拖動播放位置檢查，哪裡偏了，就拖到那一格重新對準，按「只記錄這一格」修正。滿意後按下面的按鈕，存成範本移動參數。
        </p>
        <Button type="button" variant="secondary" onClick={saveMotion} disabled={keys.length < 2 || working}>
          把目前追蹤結果存成範本移動參數
        </Button>
        <label htmlFor="motion-json" className="text-xs text-muted-foreground">
          範本移動參數（存好後複製給我，我會存進這支範本；也可以貼上之前複製的參數，按「載入」）
        </label>
        <textarea id="motion-json" value={motionText} onChange={(e) => setMotionText(e.target.value)} rows={4} className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs" />
        <Button type="button" variant="outline" onClick={loadMotionText} disabled={!motionText.trim() || working}>
          載入貼上的移動參數
        </Button>
      </div>
      ) : null}

      {mode === "ai" ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 p-3">
          <label htmlFor="assist-text" className="text-sm font-medium">
            AI 助理：用文字告訴我怎麼調整
          </label>
          <div className="flex gap-2">
            <input
              id="assist-text"
              value={assistText}
              onChange={(e) => setAssistText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) runAssistant();
              }}
              placeholder="例如：臉放大一點、往左移、融合自然一點"
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            />
            <Button type="button" variant="secondary" onClick={runAssistant} disabled={!assistText.trim() || working}>
              調整
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">可以說：放大、縮小、往左、往右、往上、往下、融合自然、亮一點、暗一點、膚色貼近、還原。</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">5. 融合修飾與貼臉效果</p>
        <SliderRow label="臉部放大" value={crop.zoom} min={0.6} max={2} step={0.02} onChange={(zoom) => setCrop((c) => ({ ...c, zoom }))} />
        <SliderRow label="臉部左右微調" value={crop.offsetX} min={-0.3} max={0.3} step={0.01} onChange={(offsetX) => setCrop((c) => ({ ...c, offsetX }))} />
        <SliderRow label="臉部上下微調" value={crop.offsetY} min={-0.3} max={0.3} step={0.01} onChange={(offsetY) => setCrop((c) => ({ ...c, offsetY }))} />
        <SliderRow label="膚色貼近範本" value={tone} min={0} max={0.6} step={0.02} onChange={setTone} />
        <p className="pt-1 text-sm font-medium">融合修飾（淡化疊合處）</p>
        <SliderRow label="邊緣淡化（越大越柔）" value={style.feather} min={0.1} max={0.7} step={0.02} onChange={(feather) => setStyle((s) => ({ ...s, feather }))} />
        <SliderRow label="臉形寬度" value={style.width} min={0.6} max={1} step={0.02} onChange={(width) => setStyle((s) => ({ ...s, width }))} />
        <SliderRow label="額頭淡化（讓範本頭髮露出來）" value={style.forehead} min={0} max={0.6} step={0.02} onChange={(forehead) => setStyle((s) => ({ ...s, forehead }))} />
        <SliderRow label="柔化皮膚" value={style.soften} min={0} max={0.8} step={0.05} onChange={(soften) => setStyle((s) => ({ ...s, soften }))} />
        <SliderRow label="亮度（暗 到 亮）" value={style.brightness} min={-0.4} max={0.4} step={0.02} onChange={(brightness) => setStyle((s) => ({ ...s, brightness }))} />
        <SliderRow label="臉的透明度" value={opacity} min={0.5} max={1} step={0.02} onChange={setOpacity} />
        <Button type="button" variant="outline" onClick={() => { setStyle(DEFAULT_STYLE); setOpacity(1); setTone(0.2); }}>
          還原融合設定
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">6. 手工筆刷修飾（臉和範本交界處）</p>
        <p className="text-xs text-muted-foreground">
          打開筆刷後，在預覽畫面上塗抹，會把臉的邊緣擦淡，露出範本。擦的位置會記在臉上，臉移動時修飾也跟著走。擦過頭，改選「還原」塗回來。
        </p>
        <Button type="button" variant={brushOn ? "default" : "outline"} onClick={() => setBrushOn((v) => !v)} aria-pressed={brushOn}>
          {brushOn ? "筆刷已開啟（拖曳預覽畫面就是塗抹，不會移動臉）" : "開啟筆刷"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" variant={brushMode === "erase" ? "secondary" : "outline"} onClick={() => setBrushMode("erase")} aria-pressed={brushMode === "erase"}>
            擦淡
          </Button>
          <Button type="button" size="sm" variant={brushMode === "restore" ? "secondary" : "outline"} onClick={() => setBrushMode("restore")} aria-pressed={brushMode === "restore"}>
            還原
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setBrushSize(0.04)}>
            小筆刷
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setBrushSize(0.1)}>
            中筆刷
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setBrushSize(0.22)}>
            大筆刷
          </Button>
        </div>
        <SliderRow label="筆刷大小" value={brushSize} min={0.02} max={0.3} step={0.01} onChange={setBrushSize} />
        <SliderRow label="筆刷柔邊（越大越柔）" value={brushSoft} min={0.1} max={1} step={0.05} onChange={setBrushSoft} />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            maskRef.current = createEraseMask();
            setMaskVer((v) => v + 1);
          }}
        >
          清除全部筆刷修飾
        </Button>
      </div>

      <p className="text-sm font-medium">7. 播放預覽，滿意後 8. 匯出並下載</p>
      <SliderRow label="Gif 長度（秒）" value={gifSeconds} min={3} max={5} step={1} onChange={setGifSeconds} format={(v) => `${v} 秒`} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button type="button" variant="outline" onClick={preview} disabled={!photo || !hasPath || working}>
          {busy === "preview" ? "預覽中…" : "播放預覽"}
        </Button>
        <Button type="button" onClick={exportGif} disabled={!photo || !hasPath || working}>
          {busy === "export" ? `匯出中 ${time.toFixed(1)} / ${Math.min(duration, gifSeconds).toFixed(0)} 秒` : "匯出換臉 Gif（建議）"}
        </Button>
        <Button type="button" variant="outline" onClick={exportClip} disabled={!photo || !hasPath || working}>
          匯出換臉短片（錄影）
        </Button>
      </div>
      {working ? (
        <Button type="button" variant="outline" onClick={() => (cancelRef.current = true)}>
          取消
        </Button>
      ) : null}
      {!photo ? <p className="text-xs text-muted-foreground">請先選大頭照。</p> : !hasPath ? <p className="text-xs text-muted-foreground">請先記錄頭的位置，或載入範本移動參數並按「整合」。</p> : null}
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}

      {exportUrl ? (
        <div className="flex flex-col gap-2">
          {exportExt === "gif" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={exportUrl} alt="換臉 Gif 成品預覽" className="w-full rounded-lg border border-border" />
          ) : (
            <video src={exportUrl} controls playsInline muted loop className="w-full rounded-lg border border-border" />
          )}
          <a href={exportUrl} download={`local-swap.${exportExt}`} className={buttonVariants({ variant: "default" })}>
            {exportExt === "gif" ? "下載換臉 Gif" : "下載換臉短片"}
          </a>
        </div>
      ) : null}

      {variant === "admin" && keys.length > 0 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="track-json" className="text-xs text-muted-foreground">
            頭部位置記錄（滿意後複製給我，我會存進這支範本，之後玩家就不用再標）
          </label>
          <textarea id="track-json" readOnly value={trackJson} rows={4} className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      ) : null}
    </div>
  );
}
