import { get } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";
import { findBlobToken } from "@/lib/blob-token";

export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get("pathname");
  const rawName = request.nextUrl.searchParams.get("name") ?? "jsc343";
  if (!pathname || !pathname.startsWith("relay/") || pathname.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const filename = rawName.replace(/[^\w.-]/g, "_").slice(0, 80) || "jsc343";

  try {
    const result = await get(pathname, { access: "private", token: findBlobToken() });
    if (!result || result.statusCode === 304) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": result.blob.contentType,
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
