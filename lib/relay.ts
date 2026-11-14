import { upload } from "@vercel/blob/client";

const enc = encodeURIComponent;

// The store may be private or public and the access value must match, so try private first.
export async function relayUpload(blob: Blob, filename: string): Promise<string> {
  const contentType = (blob.type || "application/octet-stream").split(";")[0];
  const file = new File([blob], filename, { type: contentType });
  const reasons: string[] = [];

  for (const access of ["private", "public"] as const) {
    try {
      const res = await upload(`relay/${filename}`, file, { access, handleUploadUrl: "/api/relay/upload", contentType });
      if (access === "private") return `${window.location.origin}/api/relay/file?pathname=${enc(res.pathname)}&name=${enc(filename)}`;
      return res.downloadUrl ?? `${res.url}?download=1`;
    } catch (error) {
      reasons.push(`${access}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(reasons.join(" | ").slice(0, 300));
}

export function openInSystemBrowser(url: string) {
  const pi = (window as unknown as { Pi?: { openUrlInSystemBrowser?: (u: string) => unknown } }).Pi;
  if (typeof pi?.openUrlInSystemBrowser === "function") {
    void pi.openUrlInSystemBrowser(url);
    return;
  }
  window.open(url, "_blank");
}
