import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/server/admin-auth";
import { hmacSha256Hex, randomSixDigits } from "@/lib/server/hmac";

const CODE_TTL_MS = 10 * 60 * 1000;

export async function POST(req: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isAdminEmail(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const code = randomSixDigits();
  const exp = Date.now() + CODE_TTL_MS;
  const sig = hmacSha256Hex(apiKey, `${email}.${code}.${exp}`);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Jsc343 AI Edits 2 <onboarding@resend.dev>",
      to: [email],
      subject: "Admin login code",
      text: `Your Jsc343 AI Edits 2 admin login code is ${code}. It expires in 10 minutes.`,
    }),
  });
  if (!res.ok) return NextResponse.json({ error: "send_failed" }, { status: 502 });
  return NextResponse.json({ token: `${exp}.${sig}` });
}
