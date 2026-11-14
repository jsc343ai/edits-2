import { NextResponse } from "next/server";
import { findBlobToken } from "@/lib/blob-token";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ hasToken: Boolean(findBlobToken()) });
}
