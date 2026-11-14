"use client";

import { useCallback, useEffect, useRef } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpNote } from "@/components/views/help-note";

interface NudgePadProps {
  title: string;
  hint: string;
  doneLabel: string;
  disabled?: boolean;
  onNudge: (dx: number, dy: number) => void;
  onDone: () => void;
  all?: boolean;
  onAll?: (all: boolean) => void;
  singleLabel?: string;
  allLabel?: string;
  scopeLabel?: string;
}

const DIRECTIONS = [
  { key: "up", dx: 0, dy: -1, Icon: ArrowUp, label: "上移", pos: "col-start-2 row-start-1" },
  { key: "left", dx: -1, dy: 0, Icon: ArrowLeft, label: "左移", pos: "col-start-1 row-start-2" },
  { key: "right", dx: 1, dy: 0, Icon: ArrowRight, label: "右移", pos: "col-start-3 row-start-2" },
  { key: "down", dx: 0, dy: 1, Icon: ArrowDown, label: "下移", pos: "col-start-2 row-start-3" },
] as const;

export function NudgePad({ title, hint, doneLabel, disabled = false, onNudge, onDone, all = false, onAll, singleLabel = "Single", allLabel = "All", scopeLabel = "Move" }: NudgePadProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeRef = useRef(onNudge);
  nudgeRef.current = onNudge;

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = (dx: number, dy: number) => {
    stop();
    nudgeRef.current(dx, dy);
    let ticks = 0;
    const loop = () => {
      ticks += 1;
      const mult = ticks > 25 ? 4 : ticks > 10 ? 2 : 1;
      nudgeRef.current(dx * mult, dy * mult);
      timerRef.current = setTimeout(loop, 60);
    };
    timerRef.current = setTimeout(loop, 380);
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border px-3 py-3" role="group" aria-label={title}>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <HelpNote>{hint}</HelpNote>
      </div>
      {onAll && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={scopeLabel}>
          <Button type="button" size="sm" role="radio" aria-checked={!all} variant={!all ? "default" : "outline"} onClick={() => onAll(false)}>
            {singleLabel}
          </Button>
          <Button type="button" size="sm" role="radio" aria-checked={all} variant={all ? "default" : "outline"} onClick={() => onAll(true)}>
            {allLabel}
          </Button>
        </div>
      )}
      <div className="mx-auto grid grid-cols-3 grid-rows-3 gap-1.5" style={{ width: "11.5rem" }}>
        {DIRECTIONS.map(({ key, dx, dy, Icon, label, pos }) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            aria-label={label}
            disabled={disabled}
            className={`size-14 touch-none select-none rounded-md p-0 ${pos}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              start(dx, dy);
            }}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                nudgeRef.current(dx, dy);
              }
            }}
          >
            <Icon className="size-6" aria-hidden="true" />
          </Button>
        ))}
      </div>
      <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onDone}>
        <Check className="size-4" aria-hidden="true" />
        {doneLabel}
      </Button>
    </div>
  );
}
