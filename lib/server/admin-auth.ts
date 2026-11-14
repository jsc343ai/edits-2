import { hmacSha256Hex, safeEqual } from "@/lib/server/hmac";

export { safeEqual };

export const ADMIN_COOKIE = "jsc_admin";
const SESSION_MS = 1000 * 60 * 60 * 8;

const DEFAULT_ADMIN_EMAILS = [
  "jangshch10998@gmail.com",
  "a0935309655@gmail.com",
  "jangshch54343@gmail.com",
];

// Fallback used when the host does not pass environment variables through (e.g. the Pi-hosted address).
const BUILT_IN_PASSCODE = "momokaya123456";

export function adminPasscode(): string {
  return process.env.ADMIN_PASSCODE || BUILT_IN_PASSCODE;
}

export function adminEmails(): string[] {
  const extra = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_ADMIN_EMAILS, ...extra]));
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

function sessionSecret(): string {
  return adminPasscode();
}

export function adminConfigured(): boolean {
  return Boolean(sessionSecret());
}

export function makeAdminToken(): string {
  const secret = sessionSecret();
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${hmacSha256Hex(secret, `admin.${exp}`)}`;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export async function isAdmin(req: Request): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret) return false;
  const token = req.headers.get("x-admin-token") || readCookie(req, ADMIN_COOKIE);
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, hmacSha256Hex(secret, `admin.${exp}`));
}

export const SESSION_SECONDS = SESSION_MS / 1000;
