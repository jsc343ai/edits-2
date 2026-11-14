import { NextResponse } from "next/server";

export const maxDuration = 60;

function isFalMedia(target: URL): boolean {
  if (target.protocol !== "https:") return false;
  if (target.hostname === "fal.media" || target.hostname.endsWith(".fal.media")) return true;
  return target.hostname === "storage.googleapis.com" && target.pathname.startsWith("/falserverless/");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get("url") ?? "";
  const rawName = searchParams.get("name") ?? "result";
  const name = /^[A-Za-z0-9._-]{1,60}$/.test(rawName) ? rawName : "result";

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  if (!isFalMedia(target)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const upstream = await fetch(target.toString(), { redirect: "error" }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
  }

  const type = upstream.headers.get("content-type") ?? "";
  if (!type.startsWith("video/") && !type.startsWith("image/")) {
    return NextResponse.json({ error: "unsupported" }, { status: 415 });
  }

  const headers = new Headers({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new Response(upstream.body, { status: 200, headers });
}
