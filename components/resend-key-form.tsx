"use client";

import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminHeaders } from "@/lib/admin-token";

interface KeyStatus {
  source: "env" | "saved" | "none";
  hint: string;
}

const fetchJson = (url: string) => fetch(url, { headers: adminHeaders() }).then((r) => r.json());

export function ResendKeyForm() {
  const { data, mutate } = useSWR<KeyStatus & { error?: string }>(
    "/api/admin/resend-key",
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
      const res = await fetch("/api/admin/resend-key", {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ key: value }),
      });
      if (!res.ok) {
        setNote("金鑰格式不正確，Resend 金鑰是以 re_ 開頭，請重新複製完整的金鑰。");
        return;
      }
      setValue("");
      setNote("已儲存。請回到登入畫面，試著寄一次驗證碼。");
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
      await fetch("/api/admin/resend-key", { method: "DELETE", headers: adminHeaders() });
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
      <label htmlFor="resend-key-input" className="text-sm font-medium">
        管理員專用：貼上 Resend 金鑰（郵件驗證碼）
      </label>
      <p className="text-sm text-muted-foreground">{stateText}</p>
      <Input
        id="resend-key-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="貼上以 re_ 開頭的金鑰"
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
      <p className="text-sm text-muted-foreground">
        這裡儲存的金鑰只暫存在伺服器上，伺服器重啟就會消失，只適合測試。長期使用請加在專案環境變數。
      </p>
      {note ? (
        <p role="status" className="text-sm text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}
