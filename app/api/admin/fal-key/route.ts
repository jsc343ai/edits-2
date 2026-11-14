import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/server/admin-auth";
import {
  clearSavedFalKey,
  falKeyHint,
  falKeySource,
  saveFalKey,
} from "@/lib/server/fal-key";

function status() {
  return { source: falKeySource(), hint: falKeyHint() };
}

export async function GET(req: Request) {
  if (!(await isAdmin(req).catch(() => false))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json(status());
}

export async function POST(req: Request) {
  if (!(await isAdmin(req).catch(() => false))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key.length < 20 || key.length > 200 || /\s/.test(key)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  saveFalKey(key);
  return NextResponse.json(status());
}

export async function DELETE(req: Request) {
  if (!(await isAdmin(req).catch(() => false))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  clearSavedFalKey();
  return NextResponse.json(status());
}
