const g = globalThis as unknown as { __jscResendKey?: string };

export type ResendKeySource = "env" | "saved" | "none";

export function getResendKey(): string {
  return process.env.RESEND_API_KEY || g.__jscResendKey || "";
}

export function resendKeySource(): ResendKeySource {
  if (process.env.RESEND_API_KEY) return "env";
  if (g.__jscResendKey) return "saved";
  return "none";
}

export function resendKeyHint(): string {
  const key = getResendKey();
  return key ? `…${key.slice(-4)}` : "";
}

export function saveResendKey(value: string): void {
  g.__jscResendKey = value;
}

export function clearSavedResendKey(): void {
  g.__jscResendKey = undefined;
}
