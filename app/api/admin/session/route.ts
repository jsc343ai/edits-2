import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  SESSION_SECONDS,
  adminConfigured,
  adminPasscode,
  isAdmin,
  isAdminEmail,
  makeAdminToken,
  safeEqual,
} from "@/lib/server/admin-auth";
import { hmacSha256Hex } from "@/lib/server/hmac";

function startSession() {
  const token = makeAdminToken();
  const res = NextResponse.json({ ok: true, token });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}

export async function GET(req: Request) {
  try {
    const ok = await isAdmin(req).catch(() => false);
    return NextResponse.json({ ok, configured: adminConfigured() });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown";
    console.log("[v0] admin session check failed:", detail);
    return NextResponse.json({ ok: false, configured: false, detail });
  }
}

export async function POST(req: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown;
    code?: unknown;
    token?: unknown;
    passcode?: unknown;
  };

  if (typeof body.passcode === "string") {
    const passcodeEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!isAdminEmail(passcodeEmail) || !safeEqual(body.passcode.trim(), adminPasscode())) {
      return NextResponse.json({ error: "wrong" }, { status: 401 });
    }
    return startSession();
  }

  const apiKey = process.env.RESEND_API_KEY;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const token = typeof body.token === "string" ? body.token : "";
  const [exp, sig] = token.split(".");
  if (!apiKey || !isAdminEmail(email) || !/^\d{6}$/.test(code) || !exp || !sig || Number(exp) < Date.now()) {
    return NextResponse.json({ error: "wrong" }, { status: 401 });
  }
  const expected = hmacSha256Hex(apiKey, `${email}.${code}.${exp}`);
  if (!safeEqual(sig, expected)) {
    return NextResponse.json({ error: "wrong" }, { status: 401 });
  }
  return startSession();
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 0 });
  return res;
}
