"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { adminHeaders } from "@/lib/admin-token";
import { LocalSwapLab } from "@/components/admin/local-swap-lab";
import {
  CHARACTERS,
  IMAGE_PRICE,
  MODULES,
  MOTIONS,
  VIDEO_MODELS,
  characterPrompt,
  videoCost,
  type CharacterStyle,
  type ModuleDef,
  type ModuleId,
} from "@/lib/fal-models";

type Kind = "image" | "video";

interface Job {
  endpoint: string;
  requestId: string;
}

async function submit(payload: Record<string, unknown>): Promise<Job> {
  const res = await fetch("/api/fal/run", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<Job> & { error?: string; detail?: string };
  if (!res.ok || !data.endpoint || !data.requestId) {
    throw new Error(data.detail || data.error || "submit_failed");
  }
  return { endpoint: data.endpoint, requestId: data.requestId };
}

async function waitFor(job: Job, onTick: (seconds: number) => void): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 8 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 3000));
    onTick(Math.round((Date.now() - started) / 1000));
    const res = await fetch(
      `/api/fal/run?endpoint=${encodeURIComponent(job.endpoint)}&id=${encodeURIComponent(job.requestId)}`,
      { headers: adminHeaders() },
    );
    const data = (await res.json().catch(() => ({}))) as { status?: string; url?: string; detail?: string; error?: string };
    if (data.status === "COMPLETED" && data.url) return data.url;
    if (data.status === "FAILED" || data.error) throw new Error(data.detail || data.error || "failed");
  }
  throw new Error("timeout");
}

function readAsDataUrl(file: File, maxSide = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load"));
    };
    img.src = url;
  });
}

function useStep() {
  const [busy, setBusy] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");

  async function run(label: string, payload: Record<string, unknown>): Promise<string | null> {
    setBusy(label);
    setSeconds(0);
    setError("");
    try {
      const job = await submit(payload);
      return await waitFor(job, setSeconds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      return null;
    } finally {
      setBusy("");
    }
  }

  return { busy, seconds, error, run };
}

function DownloadLink({ url, name, label }: { url: string; name: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const proxied = `/api/fal/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowUrl(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <a href={proxied} download={name} className={buttonVariants({ variant: "default", size: "sm" })}>
          {label}
        </a>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          另開分頁
        </a>
        <Button type="button" size="sm" variant="outline" onClick={copyLink}>
          {copied ? "已複製" : "複製連結"}
        </Button>
      </div>
      {showUrl ? (
        <input
          readOnly
          value={url}
          aria-label="檔案連結"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
        />
      ) : null}
    </div>
  );
}

function ConfirmButton({
  label,
  cost,
  disabled,
  onConfirm,
  variant = "default",
  size = "default",
}: {
  label: string;
  cost: string;
  disabled?: boolean;
  onConfirm: () => void;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm";
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function click() {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 6000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant={armed ? "destructive" : variant} size={size} disabled={disabled} onClick={click}>
        {armed ? `確定要生成嗎？再按一次（預估 ${cost}）` : label}
      </Button>
      {armed ? (
        <p role="status" className="text-xs text-muted-foreground">
          這會真的扣費，6 秒內再按一次才會執行。
        </p>
      ) : null}
    </div>
  );
}

type SlotState = { status: "idle" | "running" | "done" | "error"; url?: string; error?: string };

function BatchLab({ onUse }: { onUse: (url: string) => void }) {
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  const [style, setStyle] = useState<CharacterStyle>("real");
  const key = (id: string) => `${style}:${id}`;
  const [running, setRunning] = useState(false);

  function patch(id: string, next: SlotState) {
    setSlots((prev) => ({ ...prev, [id]: next }));
  }

  async function makeOne(id: string, prompt: string) {
    patch(id, { status: "running" });
    try {
      const job = await submit({ step: "character", prompt });
      const url = await waitFor(job, () => undefined);
      patch(id, { status: "done", url });
    } catch (e) {
      patch(id, { status: "error", error: e instanceof Error ? e.message : "failed" });
    }
  }

  async function makeAll(onlyMissing: boolean) {
    setRunning(true);
    const todo = CHARACTERS.filter((c) => !onlyMissing || slots[key(c.id)]?.status !== "done");
    const queue = [...todo];
    const workers = Array.from({ length: 3 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        await makeOne(key(c.id), characterPrompt(c, style));
      }
    });
    await Promise.all(workers);
    setRunning(false);
  }

  const doneCount = CHARACTERS.filter((c) => slots[key(c.id)]?.status === "done").length;

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="造型風格" className="flex gap-2">
        <Button type="button" size="sm" variant={style === "real" ? "default" : "outline"} onClick={() => setStyle("real")}>
          寫實 3D 造型
        </Button>
        <Button type="button" size="sm" variant={style === "hand" ? "default" : "outline"} onClick={() => setStyle("hand")}>
          仿真手繪造型
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        每個造型可以單獨生成，每張約 0.04 美元，按兩次才會真的扣費。想先少花錢，只生成一兩張就好。切換分頁不會清掉已生成的圖，但重新整理頁面會。滿意的按「用這張做範本短片」，直接進入下一步。
      </p>
      <ConfirmButton
        disabled={running}
        cost={`約 ${(0.04 * (10 - doneCount)).toFixed(2)} 美元`}
        onConfirm={() => makeAll(doneCount > 0)}
        label={running ? "生成中…" : doneCount > 0 ? `補生成未完成的造型（已完成 ${doneCount}/10）` : "一鍵生成 10 個造型圖"}
      />
      <ul className="grid grid-cols-2 gap-3">
        {CHARACTERS.map((c) => {
          const s = slots[key(c.id)] ?? { status: "idle" as const };
          return (
            <li key={c.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
              <p className="text-sm font-medium">{c.zh}</p>
              {s.status === "done" && s.url ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.url} alt={c.zh} className="w-full rounded-md border border-border" />
                  <DownloadLink url={s.url} name={`${style}-${c.id}.jpg`} label="下載" />
                </>
              ) : null}
              {s.status === "running" ? (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  生成中
                </p>
              ) : null}
              {s.status === "error" ? <p className="text-xs text-destructive">失敗：{s.error}</p> : null}
              {s.status === "idle" ? (
                <ConfirmButton
                  size="sm"
                  variant="outline"
                  disabled={running}
                  cost="約 0.04 美元"
                  label="生成這張（約 0.04 美元）"
                  onConfirm={() => makeOne(key(c.id), characterPrompt(c, style))}
                />
              ) : null}
              {s.status === "done" && s.url ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => onUse(s.url as string)}>
                  用這張做範本短片
                </Button>
              ) : null}
              {s.status === "error" || (s.status === "done" && !running) ? (
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  disabled={running}
                  cost="約 0.04 美元"
                  label="重新生成"
                  onConfirm={() => makeOne(key(c.id), characterPrompt(c, style))}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Result({ url, kind }: { url: string; kind: Kind }) {
  return (
    <div className="flex flex-col gap-2">
      {kind === "video" ? (
        <video
          src={url}
          controls
          playsInline
          muted
          autoPlay
          loop
          preload="auto"
          className="mx-auto max-h-80 w-auto max-w-full rounded-md border border-border bg-muted"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="生成結果" className="mx-auto max-h-80 w-auto max-w-full rounded-md border border-border" />
      )}
      <DownloadLink url={url} name={kind === "video" ? "result.mp4" : "result.jpg"} label="下載結果" />
    </div>
  );
}

function StatusLine({ busy, seconds, error }: { busy: string; seconds: number; error: string }) {
  if (!busy && !error) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {busy ? `${busy}（已等待 ${seconds} 秒）` : `失敗：${error}`}
    </p>
  );
}

function ModelPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-1" role="radiogroup" aria-label="影片模型">
      {VIDEO_MODELS.map((m) => (
        <Button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          variant={value === m.id ? "default" : "outline"}
          className="h-auto justify-start whitespace-normal py-2 text-left"
          onClick={() => onChange(m.id)}
        >
          <span className="flex flex-col">
            <span>{m.label}</span>
            <span className="text-xs opacity-80">
              {m.note}，每秒 {m.pricePerSecond} 美元
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
}

function MotionPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="動態模式">
      {MOTIONS.map((m) => (
        <Button key={m.id} type="button" role="radio" aria-checked={value === m.id} variant={value === m.id ? "default" : "outline"} onClick={() => onChange(m.id)}>
          {m.zh}
        </Button>
      ))}
    </div>
  );
}

function SecondsPicker({ value, onChange }: { value: 5 | 10; onChange: (s: 5 | 10) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="影片長度">
      {([5, 10] as const).map((s) => (
        <Button key={s} type="button" role="radio" aria-checked={value === s} variant={value === s ? "default" : "outline"} onClick={() => onChange(s)}>
          {s} 秒
        </Button>
      ))}
    </div>
  );
}

function AnimateLab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [motionId, setMotionId] = useState(MOTIONS[0].id);
  const [modelId, setModelId] = useState(VIDEO_MODELS[1].id);
  const [seconds, setSeconds] = useState<5 | 10>(5);
  const [video, setVideo] = useState<string | null>(null);
  const step = useStep();

  async function generate() {
    if (!photo) return;
    const motion = MOTIONS.find((m) => m.id === motionId) ?? MOTIONS[0];
    setVideo(null);
    const url = await step.run("正在生成動畫", { step: "video", imageDataUrl: photo, prompt: motion.prompt, modelId, seconds });
    if (url) setVideo(url);
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="選擇完整照片"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setPhoto(await readAsDataUrl(f).catch(() => null));
        }}
      />
      <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
        {photo ? "重新選擇照片" : "選擇完整照片"}
      </Button>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="已選照片" className="mx-auto max-h-48 w-auto rounded-md border border-border" />
      ) : null}
      <MotionPicker value={motionId} onChange={setMotionId} />
      <ModelPicker value={modelId} onChange={setModelId} />
      <SecondsPicker value={seconds} onChange={setSeconds} />
      <ConfirmButton disabled={!photo || !!step.busy} cost={videoCost(modelId, seconds)} label="生成動畫" onConfirm={generate} />
      <StatusLine busy={step.busy} seconds={step.seconds} error={step.error} />
      {video ? <Result url={video} kind="video" /> : null}
    </div>
  );
}

interface SeedVideo {
  url: string;
  seconds: number;
  label: string;
}

function swapCost(seconds: number) {
  return seconds <= 5 ? "約 0.15 美元" : "約 0.30 美元（超過 5 秒加倍）";
}

function SwapLab({
  base,
  onBase,
  seedVideo,
  onClearSeed,
}: {
  base: string | null;
  onBase: (url: string | null) => void;
  seedVideo: SeedVideo | null;
  onClearSeed: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id);
  const [face, setFace] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(seedVideo?.url ?? null);
  const templateSeconds = seedVideo?.seconds ?? 5;
  const [swappedVideo, setSwappedVideo] = useState<string | null>(null);
  const [motionId, setMotionId] = useState(MOTIONS[0].id);
  const [modelId, setModelId] = useState(VIDEO_MODELS[1].id);
  const step = useStep();

  async function makeCharacter() {
    const c = CHARACTERS.find((x) => x.id === characterId) ?? CHARACTERS[0];
    onBase(null);
    setTemplate(null);
    setSwappedVideo(null);
    const url = await step.run("正在設計造型", { step: "character", prompt: c.prompt });
    if (url) onBase(url);
  }

  async function makeTemplate() {
    if (!base) return;
    const motion = MOTIONS.find((m) => m.id === motionId) ?? MOTIONS[0];
    setTemplate(null);
    setSwappedVideo(null);
    const url = await step.run("正在生成範本短片", { step: "video", imageUrl: base, prompt: motion.prompt, modelId, seconds: 5 });
    if (url) setTemplate(url);
  }

  async function swapHead() {
    if (!template || !face) return;
    setSwappedVideo(null);
    const url = await step.run("正在替換片中人頭", { step: "videoSwap", videoUrl: template, faceDataUrl: face });
    if (url) setSwappedVideo(url);
  }

  return (
    <div className="flex flex-col gap-3">
      {seedVideo ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <p className="text-sm font-medium">已帶入範本短片：{seedVideo.label}（{seedVideo.seconds} 秒）</p>
          <Result url={seedVideo.url} kind="video" />
          <Button type="button" variant="outline" size="sm" onClick={onClearSeed}>
            改用其他範本（重新從造型開始）
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm font-medium">1. 選擇造型模型</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="造型模型">
            {CHARACTERS.map((c) => (
              <Button key={c.id} type="button" role="radio" aria-checked={characterId === c.id} variant={characterId === c.id ? "default" : "outline"} onClick={() => setCharacterId(c.id)}>
                {c.zh}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            建議直接到前三個短片模組，做好短片後按「用這支短片做換臉測試」，會自動帶入這裡。
          </p>
          <ConfirmButton disabled={!!step.busy} cost="約 0.04 美元" label="生成造型預覽" onConfirm={makeCharacter} />
          {base ? <Result url={base} kind="image" /> : null}
        </>
      )}

      {!seedVideo && base ? (
        <>
          <p className="text-sm font-medium">2. 把造型做成 5 秒範本人物短片</p>
          <p className="text-xs text-muted-foreground">這就是要永久存進 app 的範本。滿意後請下載，傳給我。</p>
          <MotionPicker value={motionId} onChange={setMotionId} />
          <ModelPicker value={modelId} onChange={setModelId} />
          <ConfirmButton disabled={!!step.busy} cost={videoCost(modelId, 5)} label="生成範本短片" onConfirm={makeTemplate} />
          {template ? <Result url={template} kind="video" /> : null}
        </>
      ) : null}

      {template ? (
        <>
          <p className="text-sm font-medium">3. 選擇大頭照，把片中人頭換成你的臉</p>
          <p className="text-xs text-muted-foreground">
            使用 Pixverse 影片換臉，這支 {templateSeconds} 秒範本{swapCost(templateSeconds)}。請選正面、清楚的大頭照。
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="選擇大頭照"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setFace(await readAsDataUrl(f, 768).catch(() => null));
            }}
          />
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
            {face ? "重新選擇大頭照" : "選擇大頭照"}
          </Button>
          {face ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={face} alt="已選大頭照" className="mx-auto max-h-32 w-auto rounded-md border border-border" />
          ) : null}
          <ConfirmButton disabled={!face || !!step.busy} cost={swapCost(templateSeconds)} label="開始替換人頭" onConfirm={swapHead} />
          {swappedVideo ? <Result url={swappedVideo} kind="video" /> : null}
        </>
      ) : null}
      <StatusLine busy={step.busy} seconds={step.seconds} error={step.error} />
    </div>
  );
}

function ModuleLab({ module, onSwap }: { module: ModuleDef; onSwap: (video: SeedVideo) => void }) {
  const model = VIDEO_MODELS.find((m) => m.id === module.modelId) ?? VIDEO_MODELS[0];
  const characters = CHARACTERS.filter((c) => module.style !== "photo" || !c.id.startsWith("3d-"));
  const [characterId, setCharacterId] = useState(characters[0].id);
  const [motionId, setMotionId] = useState(MOTIONS[0].id);
  const [seconds, setSeconds] = useState<5 | 10>(5);
  const [image, setImage] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const step = useStep();

  async function makeImage() {
    const c = characters.find((x) => x.id === characterId) ?? characters[0];
    setImage(null);
    setVideo(null);
    const url = await step.run("正在設計造型", { step: "character", prompt: characterPrompt(c, module.style) });
    if (url) setImage(url);
  }

  async function makeVideo() {
    if (!image) return;
    const motion = MOTIONS.find((m) => m.id === motionId) ?? MOTIONS[0];
    setVideo(null);
    const url = await step.run("正在生成短片", {
      step: "video",
      imageUrl: image,
      prompt: motion.prompt,
      modelId: model.id,
      seconds,
    });
    if (url) setVideo(url);
  }

  const perSecond = model.pricePerSecond.toFixed(3).replace(/0$/, "");
  const total = (IMAGE_PRICE + model.pricePerSecond * seconds).toFixed(2);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-md bg-muted p-3 text-sm">
        <p className="font-medium">{module.title}</p>
        <p className="text-muted-foreground">{module.desc}</p>
        <p className="text-muted-foreground">
          使用 {model.label}，每秒 {perSecond} 美元，造型圖每張 {IMAGE_PRICE} 美元。
          做一支 {seconds} 秒短片，全部約 {total} 美元。
        </p>
      </div>

      <p className="text-sm font-medium">1. 選擇人物造型</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="人物造型">
        {characters.map((c) => (
          <Button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={characterId === c.id}
            variant={characterId === c.id ? "default" : "outline"}
            onClick={() => setCharacterId(c.id)}
          >
            {c.zh}
          </Button>
        ))}
      </div>
      <ConfirmButton
        disabled={!!step.busy}
        cost={`約 ${IMAGE_PRICE} 美元`}
        label={`生成造型預覽（約 ${IMAGE_PRICE} 美元）`}
        onConfirm={makeImage}
      />
      {image ? <Result url={image} kind="image" /> : null}

      {image ? (
        <>
          <p className="text-sm font-medium">2. 選擇動作與長度，生成短片</p>
          <MotionPicker value={motionId} onChange={setMotionId} />
          <SecondsPicker value={seconds} onChange={setSeconds} />
          <ConfirmButton
            disabled={!!step.busy}
            cost={videoCost(model.id, seconds)}
            label={`生成短片（${videoCost(model.id, seconds)}）`}
            onConfirm={makeVideo}
          />
          {video ? (
            <>
              <Result url={video} kind="video" />
              <Button
                type="button"
                onClick={() => onSwap({ url: video, seconds, label: `${module.title}・${characters.find((x) => x.id === characterId)?.zh ?? ""}` })}
              >
                用這支短片做換臉測試
              </Button>
              <p className="text-xs text-muted-foreground">
                這支短片就是這個模組的範本。滿意後請按「下載結果」保存，再傳給我放進 app，之後玩家就能永久使用。
              </p>
            </>
          ) : null}
        </>
      ) : null}
      <StatusLine busy={step.busy} seconds={step.seconds} error={step.error} />
    </div>
  );
}

const TAB_LABELS: Record<ModuleId | "batch" | "swap" | "animate" | "local", string> = {
  hand: "手繪3D造型模組(短片)",
  d3: "3D仿真造型模組(短片)",
  photo: "Fal ai超仿真模組(短片)",
  local: "本機免費換臉測試",
  swap: "第 9 項 換臉測試",
  animate: "第 10 項 照片動起來",
  batch: "造型圖庫(靜態)",
};

export function FalLab() {
  const [tab, setTab] = useState<ModuleId | "batch" | "swap" | "animate" | "local">("hand");
  const [base, setBase] = useState<string | null>(null);
  const [seedKey, setSeedKey] = useState(0);

  const [seedVideo, setSeedVideo] = useState<SeedVideo | null>(null);

  function useAsSeed(url: string) {
    setBase(url);
    setSeedVideo(null);
    setSeedKey((k) => k + 1);
    setTab("swap");
  }

  function sendToSwap(video: SeedVideo) {
    setSeedVideo(video);
    setSeedKey((k) => k + 1);
    setTab("swap");
  }

  function clearSeed() {
    setSeedVideo(null);
    setBase(null);
    setSeedKey((k) => k + 1);
  }

  return (
    <section aria-label="AI 動畫試作" className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">AI 動畫試作（管理員）</h2>
        <p className="text-sm text-muted-foreground">
          這裡會真的呼叫 Fal 並扣費。每次試作前後，請到 Fal 後台的用量頁，記下餘額差額，就能得到實際單價。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="tablist" aria-label="試作項目">
        {(Object.keys(TAB_LABELS) as (keyof typeof TAB_LABELS)[]).map((id) => (
          <Button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? "default" : "outline"}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </Button>
        ))}
      </div>
      {MODULES.map((m) => (
        <div key={m.id} hidden={tab !== m.id}>
          <ModuleLab module={m} onSwap={sendToSwap} />
        </div>
      ))}
      <div hidden={tab !== "batch"}>
        <BatchLab onUse={useAsSeed} />
      </div>
      <div hidden={tab !== "local"}>
        <LocalSwapLab />
      </div>
      <div hidden={tab !== "swap"}>
        <SwapLab key={seedKey} base={base} onBase={setBase} seedVideo={seedVideo} onClearSeed={clearSeed} />
      </div>
      <div hidden={tab !== "animate"}>
        <AnimateLab />
      </div>
    </section>
  );
}
