"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/lang-context";
import { Chip, Nudge, Range } from "@/components/editor-panels";
import {
  DEFAULT_ANCHORS,
  DEFAULT_LIFE,
  DEFAULT_MAKEUP,
  elementSize,
  type Anchors,
  type Asset,
  type Clip,
  type Life,
  type Makeup,
} from "@/lib/compositor";
import { aiRemoveBackground, canvasToBlob, loadImage, localAutoCutout, strokeBrush } from "@/lib/cutout";
import { aiEstimateDepth, syntheticDepth } from "@/lib/depth";

type Patch = (patch: Partial<Clip>) => void;

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl bg-secondary p-4 text-sm text-muted-foreground">{text}</p>;
}

export function FramePanel({ clip, onUpdate, onSave }: { clip?: Clip; onUpdate: Patch; onSave?: () => void }) {
  const { L } = useLang();
  if (!clip) return <Empty text={L("請先選擇一張相片或片段。", "Select a photo or clip first.")} />;
  if (clip.type === "video") {
    const total = Math.max(0.5, clip.srcDuration);
    return (
      <div className="flex flex-col gap-3 rounded-xl bg-secondary p-3">
        <h3 className="text-sm font-semibold">{L("短片剪輯", "Trim clip")}</h3>
        <Range
          label={L("剪前端", "Trim start")}
          value={clip.trimStart}
          min={0}
          max={total}
          step={0.1}
          suffix="s"
          onChange={(v) => onUpdate({ trimStart: Math.min(v, clip.trimEnd - 0.5) })}
        />
        <Range
          label={L("剪後端", "Trim end")}
          value={clip.trimEnd}
          min={0}
          max={total}
          step={0.1}
          suffix="s"
          onChange={(v) => onUpdate({ trimEnd: Math.max(v, clip.trimStart + 0.5) })}
        />
        <Range
          label={L("原音音量", "Original volume")}
          value={clip.volume}
          min={0}
          max={1}
          step={0.1}
          onChange={(v) => onUpdate({ volume: v })}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSave}>{L("儲存", "Save")}</Button>
          <Button variant="outline" onClick={() => onUpdate({ trimStart: 0, trimEnd: total })}>
            {L("還原", "Reset")}
          </Button>
        </div>
      </div>
    );
  }
  const crop = clip.crop ?? { zoom: 1, ox: 0, oy: 0 };
  const set = (p: Partial<typeof crop>) => onUpdate({ crop: { ...crop, ...p } });
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-secondary p-3">
      <h3 className="text-sm font-semibold">{L("相片剪輯：大小與位置", "Crop: size and position")}</h3>
      <Range label={L("放大", "Zoom")} value={crop.zoom} min={1} max={3} step={0.05} onChange={(v) => set({ zoom: v })} suffix="x" />
      <Range label={L("左右", "Left/Right")} value={crop.ox} min={-1} max={1} step={0.05} onChange={(v) => set({ ox: v })} />
      <Range label={L("上下", "Up/Down")} value={crop.oy} min={-1} max={1} step={0.05} onChange={(v) => set({ oy: v })} />
      <Button variant="outline" className="self-start" onClick={() => onUpdate({ crop: undefined })}>
        {L("還原", "Reset")}
      </Button>
    </div>
  );
}

export function MakeupPanel({
  clip,
  onUpdate,
  onApplyAll,
  face = true,
}: {
  clip?: Clip;
  onUpdate: Patch;
  onApplyAll?: (m: Makeup) => void;
  face?: boolean;
}) {
  const { L } = useLang();
  if (!clip) return <Empty text={L("請先選擇一張相片。", "Select a photo first.")} />;
  const m = clip.makeup ?? DEFAULT_MAKEUP;
  const a = clip.anchors ?? DEFAULT_ANCHORS;
  const setM = (p: Partial<Makeup>) => onUpdate({ makeup: { ...m, ...p } });
  const setA = (p: Partial<Anchors>) => onUpdate({ anchors: { ...a, ...p } });
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-secondary p-3">
      <h3 className="text-sm font-semibold">{L("色彩調整", "Color adjust")}</h3>
      <Range label={L("亮度", "Brightness")} value={m.bright} min={0.6} max={1.5} step={0.05} onChange={(v) => setM({ bright: v })} />
      <Range label={L("對比", "Contrast")} value={m.contrast} min={0.6} max={1.6} step={0.05} onChange={(v) => setM({ contrast: v })} />
      <Range label={L("飽和", "Saturation")} value={m.sat} min={0} max={2} step={0.05} onChange={(v) => setM({ sat: v })} />
      <Range label={L("冷暖", "Warmth")} value={m.warm} min={-1} max={1} step={0.1} onChange={(v) => setM({ warm: v })} />
      {face && (
        <>
          <h3 className="pt-1 text-sm font-semibold">{L("相片彩妝", "Photo makeup")}</h3>
          <Range label={L("美肌", "Smooth")} value={m.smooth} min={0} max={1} step={0.1} onChange={(v) => setM({ smooth: v })} />
          <Range label={L("腮紅", "Blush")} value={m.blush} min={0} max={1} step={0.1} onChange={(v) => setM({ blush: v })} />
          <Range label={L("唇彩", "Lips")} value={m.lip} min={0} max={1} step={0.1} onChange={(v) => setM({ lip: v })} />
          <p className="text-xs text-muted-foreground">
            {L("請把下方的臉部與嘴巴位置對準相片中的人物。", "Place the face and mouth markers on the person in the photo.")}
          </p>
          <Nudge x={a.fx} y={a.fy} onMove={(x, y) => setA({ fx: x, fy: y })} />
          <Range label={L("臉大小", "Face size")} value={a.fs} min={0.08} max={0.4} step={0.01} onChange={(v) => setA({ fs: v })} />
          <Nudge x={a.mx} y={a.my} onMove={(x, y) => setA({ mx: x, my: y })} />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onUpdate({ makeup: undefined })}>
          {L("還原", "Reset")}
        </Button>
        {onApplyAll && (
          <Button variant="secondary" onClick={() => onApplyAll(m)}>
            {L("套用到全部相片", "Apply to all photos")}
          </Button>
        )}
      </div>
    </div>
  );
}

const PRESETS: [string, string, Partial<Life>][] = [
  ["說話", "Talking", { mouth: 0.7, legs: 0, arms: 0, cloth: 0, speed: 1 }],
  ["唱歌", "Singing", { mouth: 1, legs: 0, arms: 0.2, cloth: 0, speed: 0.7 }],
  ["走路", "Walking", { mouth: 0, legs: 0.8, arms: 0.6, cloth: 0, speed: 1 }],
  ["舞動", "Dancing", { mouth: 0, legs: 1, arms: 1, cloth: 0.3, speed: 1.7 }],
  ["風吹衣動", "Wind in clothes", { mouth: 0, legs: 0, arms: 0, cloth: 0.9, speed: 1 }],
];

function SubjectPanel({ clip, asset, onUpdate }: { clip: Clip; asset?: Asset; onUpdate: Patch }) {
  const { L } = useLang();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [action, setAction] = useState<"erase" | "restore">("erase");
  const [size, setSize] = useState(4);
  const view = useRef<HTMLCanvasElement>(null);
  const original = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const cut = asset?.cutout ?? null;
  const ver = asset?.cutVer ?? 0;

  const ensureOriginal = () => {
    if (!asset || !cut) return null;
    if (!original.current || original.current.width !== cut.width || original.current.height !== cut.height) {
      const c = document.createElement("canvas");
      c.width = cut.width;
      c.height = cut.height;
      c.getContext("2d")?.drawImage(asset.el, 0, 0, c.width, c.height);
      original.current = c;
    }
    return original.current;
  };

  const redraw = () => {
    const v = view.current;
    const base = ensureOriginal();
    if (!v || !cut || !base) return;
    if (v.width !== cut.width) v.width = cut.width;
    if (v.height !== cut.height) v.height = cut.height;
    const x = v.getContext("2d");
    if (!x) return;
    x.clearRect(0, 0, v.width, v.height);
    x.globalAlpha = 0.3;
    x.drawImage(base, 0, 0);
    x.globalAlpha = 1;
    x.drawImage(cut, 0, 0);
  };

  useEffect(redraw, [cut, ver]);

  if (clip.type === "video" || !asset) return null;

  const runCutout = async () => {
    if (asset.el instanceof HTMLVideoElement) return;
    setBusy(true);
    setNote(L("AI 去背中，第一次要下載模型，請稍候…", "Removing the background with AI. The first run downloads a model, please wait."));
    try {
      const nat = elementSize(asset.el);
      const sc = Math.min(1, 1024 / Math.max(nat.w, nat.h));
      const src = document.createElement("canvas");
      src.width = Math.max(1, Math.round(nat.w * sc));
      src.height = Math.max(1, Math.round(nat.h * sc));
      src.getContext("2d")?.drawImage(asset.el, 0, 0, src.width, src.height);
      const out = document.createElement("canvas");
      out.width = src.width;
      out.height = src.height;
      const ox = out.getContext("2d");
      if (!ox) throw new Error("no canvas");
      try {
        const result = await aiRemoveBackground(await canvasToBlob(src));
        const url = URL.createObjectURL(result);
        const img = await loadImage(url);
        ox.drawImage(img, 0, 0, out.width, out.height);
        URL.revokeObjectURL(url);
        setNote(L("去背完成。若有沒切乾淨的地方，用下面的筆刷修。", "Done. Use the brush below to fix any rough spots."));
      } catch {
        ox.clearRect(0, 0, out.width, out.height);
        ox.drawImage(src, 0, 0);
        const d = ox.getImageData(0, 0, out.width, out.height);
        localAutoCutout(d);
        ox.putImageData(d, 0, 0);
        setNote(L("AI 去背沒有成功，改用簡易去背（適合單色背景）。可用筆刷修。", "AI cut-out failed, so the simple cut-out was used (best for plain backgrounds). Fix it with the brush."));
      }
      asset.cutout = out;
      asset.cutVer = (asset.cutVer ?? 0) + 1;
      original.current = null;
      onUpdate({ subjectOnly: true, depthMode: false });
    } catch {
      setNote(L("去背失敗，請換一張相片再試。", "Cut-out failed. Try another photo."));
    } finally {
      setBusy(false);
    }
  };

  const runDepth = async () => {
    if (asset.el instanceof HTMLVideoElement) return;
    setBusy(true);
    setNote(L("AI 估算遠近中，第一次要下載模型，請稍候…", "Estimating depth with AI. The first run downloads a model, please wait."));
    try {
      const nat = elementSize(asset.el);
      const sc = Math.min(1, 640 / Math.max(nat.w, nat.h));
      const src = document.createElement("canvas");
      src.width = Math.max(1, Math.round(nat.w * sc));
      src.height = Math.max(1, Math.round(nat.h * sc));
      src.getContext("2d")?.drawImage(asset.el, 0, 0, src.width, src.height);
      let map: HTMLCanvasElement;
      try {
        map = await aiEstimateDepth(src);
        setNote(L("遠近估算完成。", "Depth estimated."));
      } catch {
        map = syntheticDepth(src.width, src.height, asset.cutout);
        setNote(L("AI 估算沒有成功，改用簡易遠近（下方較近、人物最近）。效果較粗，建議先做 AI 去背。", "AI depth failed, so a simple estimate was used (lower is nearer, the person is nearest). It is rougher, so run the AI cut-out first."));
      }
      asset.depthMap = map;
      asset.depthVer = (asset.depthVer ?? 0) + 1;
      onUpdate({ depthMode: true, subjectOnly: false });
    } catch {
      setNote(L("遠近估算失敗，請換一張相片再試。", "Depth estimation failed. Try another photo."));
    } finally {
      setBusy(false);
    }
  };

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = e.currentTarget;
    const r = v.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * v.width, y: ((e.clientY - r.top) / r.height) * v.height };
  };

  const paint = (to: { x: number; y: number }) => {
    const base = ensureOriginal();
    const x = cut?.getContext("2d");
    if (!cut || !base || !x || !last.current) return;
    strokeBrush(x, base, last.current, to, (cut.width * size) / 100, action);
    last.current = to;
    asset.cutVer = (asset.cutVer ?? 0) + 1;
    redraw();
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-3">
      <h4 className="text-sm font-semibold">{L("人物與背景", "Person and background")}</h4>
      <div className="flex flex-wrap gap-2">
        <Chip active={!clip.subjectOnly && !clip.depthMode} onClick={() => onUpdate({ subjectOnly: false, depthMode: false })}>
          {L("整張一起動（原本點陣）", "Whole photo (original mesh)")}
        </Chip>
        <Chip
          active={!!clip.subjectOnly && !clip.depthMode}
          onClick={() => (cut ? onUpdate({ subjectOnly: true, depthMode: false }) : void runCutout())}
        >
          {L("只動人物，背景固定", "Person only, fixed background")}
        </Chip>
        <Chip
          active={!!clip.depthMode}
          onClick={() => (asset.depthMap ? onUpdate({ depthMode: true, subjectOnly: false }) : void runDepth())}
        >
          {L("深度視差（2.5D 立體鏡頭）", "Depth parallax (2.5D camera)")}
        </Chip>
      </div>
      {clip.depthMode && (
        <div className="flex flex-col gap-2">
          <Range
            label={L("立體強度", "Depth strength")}
            value={clip.depthPower ?? 1}
            min={0.3}
            max={2.5}
            step={0.1}
            onChange={(v) => onUpdate({ depthPower: v })}
          />
          <p className="text-xs text-muted-foreground">
            {cut
              ? L("已有人物遮罩，會用它把人物當成一整塊，減少邊緣拉伸。", "A person mask exists, so the person moves as one block to reduce edge stretching.")
              : L("建議先按「AI 自動去背」，用遮罩修正人物邊緣的拉伸。", "Run the AI cut-out first so the mask can fix stretching at the person's edge.")}
          </p>
          <div>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void runDepth()}>
              {busy ? L("處理中…", "Working…") : L("重新估算遠近", "Re-estimate depth")}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void runCutout()}>
          {busy ? L("處理中…", "Working…") : cut ? L("重新 AI 去背", "Redo AI cut-out") : L("AI 自動去背", "AI cut-out")}
        </Button>
        {cut && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              asset.cutout = null;
              asset.cutVer = (asset.cutVer ?? 0) + 1;
              original.current = null;
              onUpdate({ subjectOnly: false });
            }}
          >
            {L("清除去背", "Clear cut-out")}
          </Button>
        )}
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {cut && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {L("下面的預覽中，亮的是會動的人物，暗的是固定的背景。用手指塗抹來修邊。", "In the preview below, the bright part moves and the dim part stays fixed. Paint with your finger to fix the edge.")}
          </p>
          <canvas
            ref={view}
            aria-label={L("人物遮罩預覽，可塗抹修改", "Person mask preview, paint to edit")}
            className="max-h-72 w-full touch-none rounded-lg border border-border bg-muted object-contain"
            style={{ aspectRatio: `${cut.width} / ${cut.height}` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = point(e);
              last.current = p;
              paint(p);
            }}
            onPointerMove={(e) => {
              if (last.current) paint(point(e));
            }}
            onPointerUp={() => {
              last.current = null;
              onUpdate(clip.depthMode ? { depthMode: true } : { subjectOnly: true });
            }}
            onPointerCancel={() => {
              last.current = null;
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Chip active={action === "erase"} onClick={() => setAction("erase")}>
              {L("擦掉（變背景）", "Erase (to background)")}
            </Chip>
            <Chip active={action === "restore"} onClick={() => setAction("restore")}>
              {L("還原（變人物）", "Restore (to person)")}
            </Chip>
          </div>
          <Range label={L("筆刷大小", "Brush size")} value={size} min={1} max={12} step={1} onChange={setSize} />
        </div>
      )}
    </div>
  );
}

export function LifePanel({ clip, onUpdate, asset }: { clip?: Clip; onUpdate: Patch; asset?: Asset }) {
  const { L, lang } = useLang();
  const zh = lang === "zh-TW" || lang === "zh-CN";
  if (!clip) return <Empty text={L("請先選擇一張相片。", "Select a photo first.")} />;
  const life = clip.life ?? DEFAULT_LIFE;
  const a = clip.anchors ?? DEFAULT_ANCHORS;
  const setL = (p: Partial<Life>) => onUpdate({ life: { ...life, ...p } });
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-secondary p-3">
      <h3 className="text-sm font-semibold">{L("相片 AI 動態", "Photo AI motion")}</h3>
  <SubjectPanel clip={clip} asset={asset} onUpdate={onUpdate} />
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(([zhL, enL, p]) => (
          <Chip key={enL} onClick={() => setL(p)} active={false}>
            {zh ? zhL : enL}
          </Chip>
        ))}
        <Chip onClick={() => onUpdate({ life: undefined })} active={false}>
          {L("關閉動態", "Off")}
        </Chip>
      </div>
      <Range label={L("嘴巴", "Mouth")} value={life.mouth} min={0} max={1} step={0.1} onChange={(v) => setL({ mouth: v })} />
      <Range label={L("手部", "Arms")} value={life.arms} min={0} max={1} step={0.1} onChange={(v) => setL({ arms: v })} />
      <Range label={L("腳部", "Legs")} value={life.legs} min={0} max={1} step={0.1} onChange={(v) => setL({ legs: v })} />
      <Range label={L("衣服", "Clothes")} value={life.cloth} min={0} max={1} step={0.1} onChange={(v) => setL({ cloth: v })} />
      <Range label={L("速度", "Speed")} value={life.speed} min={0.4} max={2.5} step={0.1} onChange={(v) => setL({ speed: v })} suffix="x" />
      <Range label={L("腿起點", "Legs start")} value={life.legY} min={0.4} max={0.9} step={0.02} onChange={(v) => setL({ legY: v })} />
      <Range label={L("衣擺起點", "Hem start")} value={life.clothY} min={0.2} max={0.9} step={0.02} onChange={(v) => setL({ clothY: v })} />
      <p className="text-xs text-muted-foreground">
        {L("嘴巴動作需要對準位置：", "Line up the mouth marker with the photo:")}
      </p>
      <Nudge x={a.mx} y={a.my} onMove={(x, y) => onUpdate({ anchors: { ...a, mx: x, my: y } })} />
      <Range
        label={L("嘴巴大小", "Mouth size")}
        value={a.fs}
        min={0.08}
        max={0.4}
        step={0.01}
        onChange={(v) => onUpdate({ anchors: { ...a, fs: v } })}
      />
      <p className="text-xs text-muted-foreground">
        {L(
          "這是依畫面變形製作的動態效果，不是真人動作重建，效果會因相片而異。",
          "These motions are built by warping the image, not by reconstructing the person, so results vary by photo.",
        )}
      </p>
    </div>
  );
}
