"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, ExternalLink, FolderDown, Share2, Smartphone } from "lucide-react";
import { openInSystemBrowser, relayUpload } from "@/lib/relay";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useLang } from "@/components/lang-context";

export interface PendingSave {
  blob: Blob;
  filename: string;
  beforeSave?: () => Promise<boolean>;
  onSaved: () => void;
}

interface SaveHandle {
  name: string;
  createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
}
type Picker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

const pickerOf = (): Picker | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker);

type Done = "picked" | "download" | "shared" | "opened" | "system";

const kindLabel = (ext: string, zh: boolean) =>
  ext === "gif" ? (zh ? "GIF 動圖" : "GIF animation") : ext === "png" ? (zh ? "PNG 圖片" : "PNG image") : ext === "mp4" || ext === "webm" ? (zh ? "影片" : "Video") : ext.toUpperCase();

const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function defaultPlace(L: (zh: string, en: string) => string) {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return L("iPhone「檔案」App 的「下載項目」。", "The Downloads folder in the Files app.");
  if (/Android/i.test(ua)) return L("手機的「下載」資料夾（「檔案」App 的「下載」）。", "Your phone's Downloads folder (Files app).");
  return L("電腦瀏覽器設定的「下載」資料夾。", "The download folder set in your computer's browser.");
}

export function SaveDialog({ pending, onClose }: { pending: PendingSave | null; onClose: () => void }) {
  const { L, lang } = useLang();
  const zh = lang === "zh-TW" || lang === "zh-CN";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: Done; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [relayUrl, setRelayUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cleared = useRef(false);
  const canPick = useMemo(() => !!pickerOf(), []);

  const file = useMemo(
    () => (pending ? new File([pending.blob], pending.filename, { type: pending.blob.type || "application/octet-stream" }) : null),
    [pending],
  );
  const canShare = useMemo(() => {
    return !!file && typeof navigator !== "undefined" && typeof navigator.share === "function";
  }, [file]);
  const inFrame = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);

  useEffect(() => {
    setBusy(false);
    setDone(null);
    setError(null);
    setRelayUrl(null);
    setCopied(false);
    cleared.current = false;
    if (!pending) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pending.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  if (!pending) return <AlertDialog open={false} />;

  const ext = pending.filename.split(".").pop() ?? "";
  const mime = pending.blob.type || "application/octet-stream";
  const isVideo = mime.startsWith("video/");

  const guard = async () => {
    if (cleared.current) return true;
    if (pending.beforeSave && !(await pending.beforeSave())) {
      onClose();
      return false;
    }
    cleared.current = true;
    return true;
  };

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await guard()) await fn();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(L("這個方式無法使用，請改用其他方式。", "That did not work. Please try another option."));
    } finally {
      setBusy(false);
    }
  };

  const anchorSave = () => {
    const a = document.createElement("a");
    a.href = previewUrl ?? URL.createObjectURL(pending.blob);
    a.download = pending.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setDone({ kind: "download", name: pending.filename });
  };

  const download = () =>
    act(async () => {
      const picker = pickerOf();
      if (picker) {
        try {
          const handle = await picker({ suggestedName: pending.filename, types: [{ description: kindLabel(ext, zh), accept: { [mime]: [`.${ext}`] } }] });
          const w = await handle.createWritable();
          await w.write(pending.blob);
          await w.close();
          setDone({ kind: "picked", name: handle.name });
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
        }
      }
      anchorSave();
    });

  const share = () =>
    act(async () => {
      if (!file) return;
      if (typeof navigator.canShare === "function" && !navigator.canShare({ files: [file] })) {
        setError(L("這台裝置或瀏覽器不支援分享檔案，請改用「新分頁開啟」後長按儲存。", "This browser cannot share files. Use Open in new tab, then press and hold to save."));
        return;
      }
      await navigator.share({ files: [file], title: pending.filename });
      setDone({ kind: "shared", name: pending.filename });
    });

  const openTab = () =>
    act(async () => {
      const opened = previewUrl ? window.open(previewUrl, "_blank") : null;
      if (!opened) {
        setError(L("Pi 瀏覽器擋下了新分頁。請改用最上面的「用手機瀏覽器下載」，或長按上方預覽的圖片／影片儲存。", "Pi Browser blocked the new tab. Use Download in phone browser at the top, or press and hold the preview above."));
        return;
      }
      setDone({ kind: "opened", name: pending.filename });
    });

  const phoneBrowser = () =>
    act(async () => {
      let url: string;
      try {
        url = await relayUpload(pending.blob, pending.filename);
      } catch (e) {
        const reason = e instanceof Error ? e.message : "";
        let cause = "";
        try {
          const res = await fetch("/api/relay/check", { cache: "no-store" });
          const info = (await res.json()) as { hasToken?: boolean };
          if (info.hasToken === false) cause = L("原因：這個網站沒有雲端讀寫金鑰，請到專案的環境變數加入 Blob 的讀寫金鑰後重新發布。", "Cause: this site has no cloud read-write key. Add the Blob read-write key in project variables and republish.");
          else if (info.hasToken === true) cause = L("金鑰已設定，問題在連線或空間設定。", "The key is set; the problem is the connection or store setup.");
        } catch {
          cause = L("原因：連不到我們的伺服器，可能是 Pi 瀏覽器擋下連線，或網站還沒重新發布。", "Cause: could not reach our server. Pi Browser may be blocking the request, or the site is not republished.");
        }
        setError(
          L("暫時無法送到手機瀏覽器。", "Could not hand this off to your phone browser.") + (cause ? ` ${cause}` : "") + (reason ? ` [${reason}]` : ""),
        );
        return;
      }
      setRelayUrl(url);
      openInSystemBrowser(url);
      setDone({ kind: "system", name: pending.filename });
    });

  const copyRelayUrl = async () => {
    if (!relayUrl) return;
    try {
      await navigator.clipboard.writeText(relayUrl);
      setCopied(true);
    } catch {
      const input = document.getElementById("relay-url") as HTMLInputElement | null;
      input?.focus();
      input?.select();
      setCopied(document.execCommand?.("copy") ?? false);
    }
  };

  const finish = () => {
    const cb = pending.onSaved;
    onClose();
    cb();
  };

  const doneText = (d: { kind: Done; name: string }) => {
    if (d.kind === "picked") return L(`已寫入你選的位置，檔名「${d.name}」。瀏覽器不會透露完整路徑，請用此檔名在你選的資料夾尋找。`, `Written to the place you chose as "${d.name}". Browsers do not reveal the full path; look for that name in the folder you picked.`);
    if (d.kind === "shared") return L("已交給系統分享選單。你在選單中選擇的 App（LINE、相簿、檔案等）會收到檔案。", "Handed to the system share sheet. The app you picked (LINE, Photos, Files...) receives the file.");
    if (d.kind === "system") return L("已在手機的系統瀏覽器打開下載頁。請在那裡按「下載」，或長按影片／圖片選「儲存」。中轉檔約 1 小時後自動清除，本 App 不保留；你下載的那一份由你自己保管。", "The download page opened in your phone's system browser. Tap Download there, or press and hold the video/image and choose Save. The relay copy is removed in about an hour; this app keeps nothing. The copy you download is yours to keep.");
    if (d.kind === "opened") return L("已在新分頁開啟。圖片或影片請長按（或右鍵）選「儲存」，才會真的存到裝置。", "Opened in a new tab. Press and hold (or right-click) and choose Save to store it on your device.");
    return L(
      `已嘗試下載「${d.name}」，但 Pi 瀏覽器可能已擋下，無法確認有沒有存成功。通常會在：${defaultPlace(L)} 若找不到，請按「完成」前改用最上面的「用手機瀏覽器下載」。`,
      `Download attempted as "${d.name}", but Pi Browser may have blocked it and we cannot confirm. Usually in: ${defaultPlace(L)} If you cannot find it, use Download in phone browser at the top before pressing Done.`,
    );
  };

  return (
    <AlertDialog open onOpenChange={() => {}}>
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {done ? <CheckCircle2 className="size-5 text-primary" aria-hidden="true" /> : <FolderDown className="size-5 text-primary" aria-hidden="true" />}
            {done ? L("已處理", "Done") : L("下載或分享作品", "Download or share")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3 text-sm">
              {previewUrl && (
                <div className="flex justify-center rounded-xl bg-secondary p-2">
                  {isVideo ? (
                    <video src={previewUrl} controls playsInline className="max-h-64 rounded-lg" />
                  ) : (
                    <img src={previewUrl} alt={L("作品預覽，可長按儲存", "Preview. Press and hold to save.")} className="max-h-64 rounded-lg object-contain" />
                  )}
                </div>
              )}
              {previewUrl && !done && (
                <p className="rounded-xl bg-secondary p-3 text-foreground">
                  {isVideo
                    ? L(
                        "若按「下載」沒反應（Pi 瀏覽器常見）：先按上面影片的播放鍵，再點右下角「⋮」選「下載」；或用下方「分享」。",
                        "If Download does nothing (common in Pi Browser): use the video's ⋮ menu and choose Download, or use Share below.",
                      )
                    : L(
                        "若按「下載」沒反應（Pi 瀏覽器常見）：直接長按上面的圖片，選「儲存圖片」或「加入照片」即可存到相簿。",
                        "If Download does nothing (common in Pi Browser): press and hold the image above and choose Save Image.",
                      )}
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-secondary p-3 text-foreground">
                <dt className="text-muted-foreground">{L("檔名", "File")}</dt>
                <dd className="break-all font-medium">{pending.filename}</dd>
                <dt className="text-muted-foreground">{L("類型", "Type")}</dt>
                <dd>{kindLabel(ext, zh)}</dd>
                <dt className="text-muted-foreground">{L("大小", "Size")}</dt>
                <dd>{sizeLabel(pending.blob.size)}</dd>
              </dl>
              {done ? (
                <p className="rounded-xl bg-secondary p-3 text-foreground">{doneText(done)}</p>
              ) : null}
              {done?.kind === "system" && relayUrl && (
                <div className="flex flex-col gap-2 rounded-xl bg-secondary p-3 text-foreground">
                  <label htmlFor="relay-url" className="font-medium">
                    {L("如果沒有自動跳到瀏覽器，請複製這個網址，貼到手機的 Chrome 或 Safari 開啟：", "If your browser did not open, copy this link and paste it into Chrome or Safari:")}
                  </label>
                  <input id="relay-url" readOnly value={relayUrl} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs" />
                  <Button type="button" variant="outline" className="h-10 w-full" onClick={copyRelayUrl}>
                    {copied ? L("已複製", "Copied") : L("複製網址", "Copy link")}
                  </Button>
                </div>
              )}
              {!done && (
                <p className="text-muted-foreground">
                  {L(
                    "Pi 瀏覽器常擋下載。最可靠是「用手機瀏覽器下載」：檔案會暫時送到雲端中轉，約 1 小時後自動清除，本 App 不保留你的作品，存好後由你自己保管。",
                    "Pi Browser often blocks downloads. The most reliable way is Download in phone browser: the file is relayed through the cloud and removed in about an hour. This app keeps nothing; once saved, the file is yours.",
                  )}
                </p>
              )}
              {inFrame && !done && (
                <p className="rounded-xl bg-secondary p-3 text-foreground">
                  {L(
                    "目前是在嵌入的預覽視窗中，瀏覽器常會擋下下載與分享。請在正式發布的網址（或 Pi 瀏覽器直接開啟的頁面）操作，才能正常存檔與分享。",
                    "You are in an embedded preview, where browsers often block downloads and sharing. Use the published site (or open the page directly in Pi Browser) to save and share.",
                  )}
                </p>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button className="h-11 w-full" onClick={phoneBrowser} disabled={busy}>
            {busy ? <Spinner /> : <Smartphone className="size-4" aria-hidden="true" />}
            {busy ? L("準備中，請稍候…", "Preparing, please wait...") : L("用手機瀏覽器下載（最可靠）", "Download in phone browser (most reliable)")}
          </Button>
          <Button variant="secondary" className="h-11 w-full" onClick={download} disabled={busy}>
            <Download className="size-4" aria-hidden="true" />
            {canPick ? L("下載（可選資料夾）", "Download (choose folder)") : L("下載", "Download")}
          </Button>
          {canShare && (
            <Button variant="secondary" className="h-11 w-full" onClick={share} disabled={busy}>
              <Share2 className="size-4" aria-hidden="true" />
              {L("分享（LINE、相簿、檔案…）", "Share (LINE, Photos, Files...)")}
            </Button>
          )}
          <Button variant="outline" className="h-11 w-full" onClick={openTab} disabled={busy}>
            <ExternalLink className="size-4" aria-hidden="true" />
            {L("新分頁開啟（長按存圖）", "Open in new tab (press & hold to save)")}
          </Button>
          <div className="flex w-full gap-2">
            <Button variant="ghost" className="h-11 flex-1" onClick={onClose} disabled={busy}>
              {L("取消", "Cancel")}
            </Button>
            {done && (
              <Button className="h-11 flex-1" onClick={finish}>
                {L("完成", "Done")}
              </Button>
            )}
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
