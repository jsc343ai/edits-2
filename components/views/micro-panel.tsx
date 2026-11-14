"use client";

import { Button } from "@/components/ui/button";
import { useLang } from "@/components/lang-context";
import { HelpNote } from "@/components/views/help-note";
import { Range } from "@/components/editor-panels";
import { MICRO_MODE_LABEL, MICRO_PART_LABEL, type MicroMode, type MicroPartKey, type MicroSetting } from "@/lib/depth";

const MODES: MicroMode[] = ["rotate", "shift", "bob", "swing"];

const GROUPS: { zh: string; en: string; keys: MicroPartKey[] }[] = [
  { zh: "全身／部位", en: "Whole body / region", keys: ["whole", "head", "body", "arms", "legs"] },
  { zh: "頭部", en: "Head", keys: ["eyes", "ears", "mouth"] },
  { zh: "手部", en: "Arms", keys: ["upperArm", "foreArm", "wrist"] },
  { zh: "身體", en: "Body", keys: ["shoulder", "upperBody", "lowerBody"] },
  { zh: "腿部", en: "Legs", keys: ["thigh", "calf"] },
];

interface Props {
  micro: MicroSetting;
  onMicro: (next: MicroSetting) => void;
  mode: MicroMode;
  onMode: (m: MicroMode) => void;
  amount: number;
  onAmount: (v: number) => void;
  speed: number;
  onSpeed: (v: number) => void;
  adjust: boolean;
  onAdjust: (v: boolean) => void;
}

export function MicroPanel({ micro, onMicro, mode, onMode, amount, onAmount, speed, onSpeed, adjust, onAdjust }: Props) {
  const { L } = useLang();
  const count = Object.values(micro).filter(Boolean).length;

  const toggle = (key: MicroPartKey) => {
    const next = { ...micro };
    if (next[key] === mode) delete next[key];
    else next[key] = mode;
    onMicro(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{L("1. 先選微動方式", "1. Pick a motion type")}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={L("微動方式", "Motion type")}>
        {MODES.map((m) => (
          <Button key={m} type="button" role="radio" aria-checked={mode === m} variant={mode === m ? "default" : "outline"} onClick={() => onMode(m)}>
            {L(MICRO_MODE_LABEL[m].zh, MICRO_MODE_LABEL[m].en)}
          </Button>
        ))}
      </div>

      <p className="text-sm font-medium">{L("2. 再點要動的部位（再點一次取消）", "2. Tap the parts to move (tap again to remove)")}</p>
      {GROUPS.map((g) => (
        <fieldset key={g.zh} className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-muted-foreground">{L(g.zh, g.en)}</legend>
          <div className="flex flex-wrap gap-2">
            {g.keys.map((k) => {
              const set = micro[k];
              return (
                <Button key={k} type="button" size="sm" aria-pressed={!!set} variant={set ? "default" : "outline"} onClick={() => toggle(k)}>
                  {L(MICRO_PART_LABEL[k].zh, MICRO_PART_LABEL[k].en)}
                  {set && <span className="text-xs opacity-80">{L(MICRO_MODE_LABEL[set].shortZh, MICRO_MODE_LABEL[set].shortEn)}</span>}
                </Button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <Range label={L("微動幅度", "Motion size")} value={amount} min={0.1} max={1} step={0.05} onChange={onAmount} />
      <Range label={L("微動速度（每 4 秒循環次數）", "Motion speed (loops per 4 s)")} value={speed} min={1} max={3} step={1} onChange={onSpeed} suffix="x" />

      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={adjust ? "default" : "outline"} aria-pressed={adjust} onClick={() => onAdjust(!adjust)}>
          {adjust ? L("完成部位位置", "Done placing") : L("調整部位位置", "Adjust positions")}
        </Button>
        <Button type="button" variant="outline" disabled={count === 0} onClick={() => onMicro({})}>
          {L("清除全部微動", "Clear all")}
        </Button>
      </div>
      <HelpNote>
        {adjust
          ? L(
              "畫面已暫停。拖動圓點對準頭、肩、手、髖、膝、腳；黃色圈是目前選到的部位範圍。眼、耳、口是依頭的大小推算的位置。",
              "The preview is paused. Drag the dots onto the head, shoulders, hands, hips, knees and feet. Yellow circles show the chosen parts. Eyes, ears and mouth are estimated from the head size.",
            )
          : count > 0
            ? L(`已選 ${count} 個部位。若動的位置沒對準，按「調整部位位置」。`, `${count} part(s) chosen. If a motion looks misplaced, press Adjust positions.`)
            : L("還沒有選部位。不選也可以，只有鏡頭的立體飄移。", "No part chosen yet. You can skip this and keep only the camera drift.")}
      </HelpNote>
    </div>
  );
}
