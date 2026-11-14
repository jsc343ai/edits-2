"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Brush, Check, ChevronLeft, Download, Gem, Loader2, ScanFace, Sparkles, Upload, Wand2 } from "lucide-react";
import { PLANNED_TEMPLATES, SWAP_LENGTHS, SWAP_MODULES, SWAP_TEMPLATES, type SwapLength, type SwapModule, type SwapTemplate } from "@/lib/swap-templates";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useLang } from "@/components/lang-context";
import { aspectSize, type Aspect } from "@/lib/compositor";
import { MOTIONS, MOTION_SECONDS, drawMotionFrame, pickMotionByText } from "@/lib/face-motions";
import { EditorView } from "@/components/views/editor-view";
import type { EditMode } from "@/components/app-shell";

const ASPECTS: Aspect[] = ["9:16", "3:4", "4:5", "1:1", "4:3", "16:9", "2:3", "3:2"];
const FACE_W = 256;
const FACE_H = 320;
const MAX_SIDE = 1400;

type Stage = "upload" | "format" | "face" | "motion" | "edit";

interface FaceBox {
  x: number;
  y: number;
  size: number;
}

interface DetectedFace {
  boundingBox: { x: number; y: number; width: number; height: number };
}

async function detectFace(img: HTMLCanvasElement): Promise<FaceBox | null> {
  const Ctor = (window as unknown as { FaceDetector?: new (o: object) => { detect: (i: CanvasImageSource) => Promise<DetectedFace[]> } }).FaceDetector;
  if (!Ctor) return null;
  try {
    const found = await new Ctor({ fastMode: true, maxDetectedFaces: 1 }).detect(img);
    const box = found[0]?.boundingBox;
    if (!box) return null;
    const side = Math.min(img.width, img.height);
    return {
      x: (box.x + box.width / 2) / img.width,
      y: (box.y + box.height / 2) / img.height,
      size: Math.min(1, (box.width * 1.5) / side),
    };
  } catch {
    return null;
  }
}

function cropFace(src: HTMLCanvasElement, box: FaceBox, target: HTMLCanvasElement) {
  const side = Math.min(src.width, src.height);
  const cw = box.size * side;
  const ch = cw * (FACE_H / FACE_W);
  target.width = FACE_W;
  target.height = FACE_H;
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, FACE_W, FACE_H);
  ctx.drawImage(src, box.x * src.width - cw / 2, box.y * src.height - ch / 2, cw, ch, 0, 0, FACE_W, FACE_H);
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  ctx.translate(FACE_W / 2, FACE_H / 2);
  ctx.scale(1, FACE_H / FACE_W);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, FACE_W / 2);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.82, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, FACE_W / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

function HandDrawnFaceSwap({ mode, onOpenPay, onBack, initialFile }: { mode: EditMode; onOpenPay: () => void; onBack: () => void; initialFile?: File }) {
  const { L } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const faceRef = useRef<HTMLCanvasElement | null>(null);
  const facePreviewRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [box, setBox] = useState<FaceBox>({ x: 0.5, y: 0.4, size: 0.6 });
  const [detected, setDetected] = useState<"idle" | "busy" | "found" | "manual">("idle");
  const [motionId, setMotionId] = useState(MOTIONS[0].id);
  const [prompt, setPrompt] = useState("");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [saved, setSaved] = useState(false);

  const motion = MOTIONS.find((m) => m.id === motionId) ?? MOTIONS[0];

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      photoRef.current = await loadPhoto(file);
      setSaved(false);
      setMessage("");
      setStage("format");
    } catch {
      setMessage(L("相片讀取失敗。", "Could not read that photo."));
    }
  };

  const startedRef = useRef(false);
  useEffect(() => {
    if (!initialFile || startedRef.current) return;
    startedRef.current = true;
    void onFile(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const startDetect = async () => {
    const photo = photoRef.current;
    if (!photo) return;
    setStage("face");
    setDetected("busy");
    const found = await detectFace(photo);
    if (found) {
      setBox(found);
      setDetected("found");
    } else {
      setBox({ x: 0.5, y: 0.4, size: 0.6 });
      setDetected("manual");
    }
  };

  useEffect(() => {
    const photo = photoRef.current;
    const target = facePreviewRef.current;
    if (stage !== "face" || !photo || !target) return;
    cropFace(photo, box, target);
  }, [box, stage]);

  const saveFace = () => {
    const photo = photoRef.current;
    if (!photo) return;
    const out = document.createElement("canvas");
    cropFace(photo, box, out);
    faceRef.current = out;
    setSaved(true);
    setStage("motion");
  };

  useEffect(() => {
    if (stage !== "motion") return;
    const canvas = stageRef.current;
    const face = faceRef.current;
    if (!canvas || !face) return;
    const { w, h } = aspectSize(aspect);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      drawMotionFrame(ctx, w, h, ((now - t0) / 1000) % MOTION_SECONDS, face, motion);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, aspect, motion]);

  const applyPrompt = () => {
    const hit = pickMotionByText(prompt);
    if (hit) {
      setMotionId(hit.id);
      setMessage(L(`已選擇「${hit.zh}」。`, `Picked "${hit.en}".`));
    } else {
      setMessage(L("沒有找到對應的動作，請從下面的清單選一個。", "No matching action found. Pick one from the list below."));
    }
  };

  const exportVideo = useCallback(async (): Promise<File | null> => {
    const canvas = stageRef.current;
    if (!canvas || typeof MediaRecorder === "undefined") {
      setMessage(L("這個瀏覽器不支援影片輸出。", "This browser cannot export video."));
      return null;
    }
    const mime = ["video/webm;codecs=vp9", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
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
    const timer = window.setInterval(() => setProgress(Math.min(1, (performance.now() - t0) / 1000 / MOTION_SECONDS)), 100);
    await new Promise((r) => setTimeout(r, MOTION_SECONDS * 1000));
    rec.stop();
    await done;
    window.clearInterval(timer);
    setExporting(false);
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    return new File([new Blob(chunks, { type: mime })], `face-motion.${ext}`, { type: mime });
  }, [L]);

  const makeVideo = async () => {
    const file = await exportVideo();
    if (file) {
      setVideo(file);
      setStage("edit");
    }
  };

  const downloadVideo = async () => {
    const file = await exportVideo();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  if (stage === "edit" && video) {
    return <EditorView key="faceswap-edit" func="video" mode={mode} onOpenPay={onOpenPay} initialFile={video} initialAspect={aspect} />;
  }

  const steps: { id: Stage; label: string }[] = [
    { id: "upload", label: L("大頭照", "Photo") },
    { id: "format", label: L("格式", "Format") },
    { id: "face", label: L("人臉", "Face") },
    { id: "motion", label: L("動作", "Action") },
  ];
  const at = steps.findIndex((s) => s.id === stage);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex items-center gap-1 text-xs" aria-label={L("步驟", "Steps")}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === at ? "step" : undefined}
            className={`flex-1 rounded-full px-2 py-1 text-center ${i === at ? "bg-primary text-primary-foreground" : i < at ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {stage === "upload" && (
        <section className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {L("請選一張清楚、正面、有人臉的大頭貼照片。", "Choose a clear, front-facing photo with one face.")}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={L("選擇大頭貼照片", "Choose a portrait photo")}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button type="button" className="h-12" onClick={() => fileRef.current?.click()}>
            <Upload className="size-5" aria-hidden="true" />
            {L("選擇大頭貼", "Choose portrait")}
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            {L("返回選擇換臉方式", "Back to face-swap methods")}
          </Button>
        </section>
      )}

      {stage === "format" && (
        <section className="flex flex-col gap-3">
          <p className="text-sm font-medium">{L("選擇屏幕格式", "Choose a screen format")}</p>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={L("屏幕格式", "Screen format")}>
            {ASPECTS.map((a) => (
              <Button key={a} type="button" role="radio" aria-checked={aspect === a} variant={aspect === a ? "default" : "outline"} onClick={() => setAspect(a)}>
                {a}
              </Button>
            ))}
          </div>
          <Button type="button" className="h-12" onClick={() => void startDetect()}>
            <ScanFace className="size-5" aria-hidden="true" />
            {L("下一步：辨識人臉", "Next: detect face")}
          </Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            {L("返回選擇模組", "Back to modules")}
          </Button>
        </section>
      )}

      {stage === "face" && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm" role="status">
            {detected === "busy" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>
              {detected === "busy" && L("正在辨識人臉…", "Detecting the face...")}
              {detected === "found" && L("已找到人臉，可微調範圍。", "Face found. You can fine-tune the area.")}
              {detected === "manual" && L("這個瀏覽器無法自動辨識，請用下面的滑桿，把人臉框在中間。", "This browser cannot detect faces automatically. Use the sliders to frame the face.")}
            </span>
          </div>
          <canvas ref={facePreviewRef} className="mx-auto h-48 w-auto rounded-md border border-border bg-muted" aria-label={L("人臉預覽", "Face preview")} />
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              {L("左右位置", "Left / right")}
              <Slider value={[box.x * 100]} min={0} max={100} step={1} onValueChange={([v]) => setBox((b) => ({ ...b, x: v / 100 }))} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {L("上下位置", "Up / down")}
              <Slider value={[box.y * 100]} min={0} max={100} step={1} onValueChange={([v]) => setBox((b) => ({ ...b, y: v / 100 }))} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              {L("範圍大小", "Area size")}
              <Slider value={[box.size * 100]} min={15} max={100} step={1} onValueChange={([v]) => setBox((b) => ({ ...b, size: v / 100 }))} />
            </label>
          </div>
          <Button type="button" className="h-12" disabled={detected === "busy"} onClick={saveFace}>
            <Check className="size-5" aria-hidden="true" />
            {L("儲存人臉並繼續", "Save face and continue")}
          </Button>
        </section>
      )}

      {stage === "motion" && (
        <section className="flex flex-col gap-3">
          <canvas
            ref={stageRef}
            className="mx-auto max-h-[60dvh] w-auto max-w-full rounded-md border border-border"
            aria-label={L("動作預覽", "Action preview")}
          />
          {mode === "ai" && (
            <div className="flex gap-2">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) applyPrompt();
                }}
                placeholder={L("說說想要的動作，例如：揮手打招呼", "Describe the action, e.g. wave hello")}
                aria-label={L("描述動作", "Describe the action")}
                className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="button" variant="secondary" onClick={applyPrompt}>
                <Wand2 className="size-4" aria-hidden="true" />
                {L("選動作", "Pick")}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={L("動作模組", "Action templates")}>
            {MOTIONS.map((m) => (
              <Button key={m.id} type="button" role="radio" aria-checked={motionId === m.id} variant={motionId === m.id ? "default" : "outline"} onClick={() => setMotionId(m.id)}>
                {L(m.zh, m.en)}
              </Button>
            ))}
          </div>
          {exporting && (
            <div className="flex items-center gap-2 text-sm" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {L(`正在輸出影片… ${Math.round(progress * 100)}%`, `Exporting video... ${Math.round(progress * 100)}%`)}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-12" disabled={exporting} onClick={() => void downloadVideo()}>
              <Download className="size-5" aria-hidden="true" />
              {L("下載影片", "Download")}
            </Button>
            <Button type="button" className="h-12" disabled={exporting} onClick={() => void makeVideo()}>
              <ArrowRight className="size-5" aria-hidden="true" />
              {L("繼續編輯", "Keep editing")}
            </Button>
          </div>
          <Button type="button" variant="ghost" onClick={() => setStage("face")}>
            {saved ? L("重新調整人臉", "Adjust the face again") : L("返回", "Back")}
          </Button>
        </section>
      )}

      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

function TemplateCard({ template, selected, onSelect }: { template: SwapTemplate; selected: boolean; onSelect: () => void }) {
  const { L } = useLang();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex flex-col gap-1 rounded-lg border p-2 text-left text-sm ${selected ? "border-primary bg-secondary" : "border-border bg-card"}`}
    >
      {template.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={template.thumbUrl} alt="" className="aspect-[3/4] w-full rounded-md object-cover" />
      ) : (
        <video
          src={template.clipUrl}
          className="aspect-[3/4] w-full rounded-md bg-muted object-cover"
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
      )}
      <span className="font-medium">{L(template.zh, template.en)}</span>
    </button>
  );
}

function ModuleTemplatePicker({ swapModule, length, onBack }: { swapModule: SwapModule; length: SwapLength; onBack: () => void }) {
  const { L } = useLang();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const templates = SWAP_TEMPLATES.filter((t) => t.module === swapModule);
  const hasTemplates = templates.length > 0;
  const info = SWAP_MODULES.find((m) => m.id === swapModule);
  const spec = SWAP_LENGTHS[length];

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <p className="text-sm font-medium">{info ? L(info.zh, info.en) : ""}</p>
        <p className="text-xs text-muted-foreground">
          {L(`輸出規格：${spec.zh}（${spec.seconds} 秒）`, `Output: ${spec.en} (${spec.seconds} sec)`)}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium">{L("選擇人物短片範本", "Choose a character clip")}</p>
        {hasTemplates ? (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={L("範本", "Templates")}>
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} selected={templateId === t.id} onSelect={() => setTemplateId(t.id)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-4 text-sm leading-relaxed">
            <p className="font-medium">{L("範本短片正在製作中", "Character clips are being prepared")}</p>
            <p className="text-muted-foreground">
              {L("第一批 3 組範本完成後，會放在這裡讓你挑選：", "The first 3 clips will appear here:")}
            </p>
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {PLANNED_TEMPLATES.map((p) => (
                <li key={p.en}>{L(p.zh, p.en)}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Button
        type="button"
        className="h-12"
        disabled={!templateId}
        onClick={() => setNotice(L("換臉與 Pi 付款功能即將開通。", "Face swap and Pi payment are coming soon."))}
      >
        <ArrowRight className="size-5" aria-hidden="true" />
        {L("開始換臉", "Start face swap")}
      </Button>
      {notice && (
        <p className="text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}
      <Button type="button" variant="ghost" onClick={onBack}>
        <ChevronLeft className="size-4" aria-hidden="true" />
        {L("返回選擇模組", "Back to modules")}
      </Button>
    </div>
  );
}

type Phase = "setup" | "modules" | "picker" | "puppet";

const MODULE_ICONS = { hand3d: Brush, sim3d: Sparkles, ultra: ScanFace } as const;

export function FaceSwapEditor({ mode, onOpenPay }: { mode: EditMode; onOpenPay: () => void }) {
  const { L } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [length, setLength] = useState<SwapLength>("clip");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [swapModule, setSwapModule] = useState<SwapModule>("hand3d");

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    setPhoto(file);
    setPhotoUrl(URL.createObjectURL(file));
  };

  if (phase === "puppet") {
    return <HandDrawnFaceSwap mode={mode} onOpenPay={onOpenPay} onBack={() => setPhase("modules")} initialFile={photo ?? undefined} />;
  }
  if (phase === "picker") {
    return <ModuleTemplatePicker swapModule={swapModule} length={length} onBack={() => setPhase("modules")} />;
  }

  if (phase === "setup") {
    return (
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">{L("選擇你的大頭照", "Choose your portrait")}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {L("請選一張清楚、正面、光線均勻、不戴墨鏡、只有一張臉的照片。", "Pick a clear, front-facing, evenly lit photo with one face and no sunglasses.")}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={L("選擇大頭貼照片", "Choose a portrait photo")}
            onChange={(e) => onPhoto(e.target.files?.[0])}
          />
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={L("你選的大頭照", "Your chosen portrait")} className="mx-auto h-40 w-auto rounded-md border border-border object-cover" />
          )}
          <Button type="button" variant={photo ? "outline" : "default"} className="h-12" onClick={() => fileRef.current?.click()}>
            <Upload className="size-5" aria-hidden="true" />
            {photo ? L("更換大頭貼", "Change portrait") : L("選擇大頭貼", "Choose portrait")}
          </Button>
        </section>

        <Button type="button" className="h-12" disabled={!photo} onClick={() => setPhase("modules")}>
          <Check className="size-5" aria-hidden="true" />
          {L("確認，選擇換臉模組", "Confirm and choose a module")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={L("你選的大頭照", "Your chosen portrait")} className="size-12 rounded-md object-cover" />
        )}
        <span className="flex-1 text-sm">{L("已選好大頭照", "Portrait selected")}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setPhase("setup")}>
          {L("更改", "Change")}
        </Button>
      </div>

      <p className="text-sm font-medium">{L("選擇換臉模組與輸出格式", "Choose a module and output")}</p>
      {SWAP_MODULES.map((m, index) => {
        const Icon = MODULE_ICONS[m.id];
        return (
          <section key={m.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <h3 className="font-medium">{L(`${["一", "二", "三"][index]}、${m.zh}`, `${index + 1}. ${m.en}`)}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{L(m.descZh, m.descEn)}{" "}
                  {m.id === "ultra"
                    ? L("需到商店選購，使用 Pi 付款。", "Purchase in the store with Pi.")
                    : L("測試期免費。", "Free during testing.")}
                </p>
              </div>
            </div>
            {m.id === "ultra" ? (
              <Button type="button" className="h-12" onClick={onOpenPay}>
                <Gem className="size-5" aria-hidden="true" />
                {L("前往商店選購超仿真模組", "Go to the store")}
              </Button>
            ) : (
            <div className="grid grid-cols-2 gap-2">
              {(["clip", "gif"] as SwapLength[]).map((key) => {
                const item = SWAP_LENGTHS[key];
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    className="h-auto flex-col py-3"
                    onClick={() => {
                      setSwapModule(m.id);
                      setLength(key);
                      setPhase("picker");
                    }}
                  >
                    <span>{key === "clip" ? L("換臉短片", "Face-swap clip") : L("換臉Gif", "Face-swap GIF")}</span>
                    <span className="text-xs font-normal text-muted-foreground">{L(`${item.seconds} 秒`, `${item.seconds} sec`)}</span>
                  </Button>
                );
              })}
            </div>
            )}
          </section>
        );
      })}

      <button
        type="button"
        onClick={() => setPhase("puppet")}
        className="flex items-start gap-3 rounded-lg border border-dashed border-border p-4 text-left"
      >
        <Wand2 className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <span className="flex flex-col gap-1">
          <span className="font-medium">{L("免費紙偶動畫", "Free paper-puppet animation")}</span>
          <span className="text-sm leading-relaxed text-muted-foreground">
            {L("把你的臉放進手繪人物，做成會動的紙偶動畫。直接在手機上完成，可無限次使用。", "Put your face into a hand-drawn character as a moving paper puppet. Made on your phone, unlimited use.")}
          </span>
        </span>
      </button>
    </div>
  );
}
