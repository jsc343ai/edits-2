import { NextResponse } from "next/server";
import { findBlobToken } from "@/lib/blob-token";

export const dynamic = "force-dynamic";

export async function GET() {
  // Names only, never values, so the creator can see what the server actually received.
  const blobLikeNames = Object.keys(process.env).filter((k) => /blob|token/i.test(k)).sort();
  return NextResponse.json({ hasToken: Boolean(findBlobToken()), blobLikeNames });
}
