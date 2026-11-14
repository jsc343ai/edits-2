const g = globalThis as unknown as { __jscFalKey?: string };

export type FalKeySource = "env" | "saved" | "none";

export function getFalKey(): string {
  return process.env.FAL_KEY || g.__jscFalKey || "";
}

export function falKeySource(): FalKeySource {
  if (process.env.FAL_KEY) return "env";
  if (g.__jscFalKey) return "saved";
  return "none";
}

export function falKeyHint(): string {
  const key = getFalKey();
  return key ? `…${key.slice(-4)}` : "";
}

export function saveFalKey(value: string): void {
  g.__jscFalKey = value;
}

export function clearSavedFalKey(): void {
  g.__jscFalKey = undefined;
}
