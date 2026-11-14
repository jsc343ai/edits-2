"use client";

import { useState } from "react";
import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminHeaders } from "@/lib/admin-token";

interface CheckResult {
  ok: boolean;
  message: string;
  detail?: string;
}

interface KeyStatus {
  source: "env" | "saved" | "none";
  hint: string;
}

const fetchJson = (url: string) => fetch(url, { headers: adminHeaders() }).then((r) => r.json());

function AdminKeyForm() {
  const { data, mutate } = useSWR<KeyStatus & { error?: string }>(
    "/api/admin/fal-key",
    fetchJson,
    { revalidateOnFocus: false },
  );
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  if (!data || data.error) return null;

  async function save() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/admin/fal-key", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ key: value }),
      });
      if (!res.ok) {
        setNote("金鑰格式不正確，請重新複製完整的金鑰。");
        return;
      }
      setValue("");
      setNote("已儲存，請按上方「開始檢查」。");
      await mutate();
    } catch {
      setNote("儲存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch("/api/admin/fal-key", { method: "DELETE", headers: adminHeaders() });
      setNote("已清除。");
      await mutate();
    } finally {
      setBusy(false);
    }
  }

  const stateText =
    data.source === "env"
      ? `目前使用專案環境變數（${data.hint}）`
      : data.source === "saved"
        ? `目前使用管理員儲存的金鑰（${data.hint}）`
        : "目前還沒有金鑰";

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <label htmlFor="fal-key-input" className="text-sm font-medium">
        管理員專用：貼上 Fal 金鑰
      </label>
      <p className="text-sm text-muted-foreground">{stateText}</p>
      <Input
        id="fal-key-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="貼上以 fal_sk_ 開頭的金鑰"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={save}
          disabled={busy || value.trim().length < 20}
          className="flex-1"
        >
          儲存金鑰
        </Button>
        {data.source === "saved" ? (
          <Button type="button" variant="outline" onClick={remove} disabled={busy}>
            清除
          </Button>
        ) : null}
      </div>
      {note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function FalCheckButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/fal-check", { method: "POST" });
      const data = (await res.json()) as CheckResult;
      setResult(data);
    } catch {
      setResult({ ok: false, message: "連不到檢查服務，請稍後再試。" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Fal 金鑰檢查（臨時）"
      className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Fal 金鑰檢查（臨時）</h2>
        <p className="text-sm text-muted-foreground">
          只會上傳一個極小的測試檔，不會生成影片，也不會扣費。
        </p>
      </div>
      <Button type="button" onClick={run} disabled={busy} className="w-full">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {busy ? "檢查中…" : "開始檢查"}
      </Button>
      {result ? (
        <div
          role="status"
          className="rounded-xl border border-border bg-background p-3 text-sm leading-relaxed"
        >
          <p className="font-medium">{result.ok ? "成功：" : "失敗："}{result.message}</p>
          {result.detail ? (
            <p className="mt-1 break-all text-muted-foreground">{result.detail}</p>
          ) : null}
        </div>
      ) : null}
      <AdminKeyForm />
    </section>
  );
}
