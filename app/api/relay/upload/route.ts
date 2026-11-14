import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { findBlobToken } from "@/lib/blob-token";

const MAX_AGE_MS = 60 * 60 * 1000;
const MAX_BYTES = 200 * 1024 * 1024;

async function sweepOldRelays(token: string) {
  const { blobs } = await list({ prefix: "relay/", token });
  const expired = blobs.filter((b) => Date.now() - new Date(b.uploadedAt).getTime() > MAX_AGE_MS).map((b) => b.url);
  if (expired.length > 0) await del(expired, { token });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  const token = findBlobToken();
  if (!token) return NextResponse.json({ error: "No Blob token" }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("relay/") || pathname.includes("..")) throw new Error("Invalid path");
        await sweepOldRelays(token).catch(() => {});
        return {
          allowedContentTypes: ["video/*", "image/*"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
