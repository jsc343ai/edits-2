"use client";

import { useId, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/lang-context";

export function HelpNote({
  children,
  showLabel,
  hideLabel,
}: {
  children: React.ReactNode;
  showLabel?: string;
  hideLabel?: string;
}) {
  const { L } = useLang();
  const [open, setOpen] = useState(false);
  const id = useId();
  const show = showLabel ?? L("查看說明", "Show help");
  const hide = hideLabel ?? L("收起說明", "Hide help");

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp className="size-4" aria-hidden="true" />
        {open ? hide : show}
      </Button>
      {open && (
        <div id={id} className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
