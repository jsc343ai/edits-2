let adminToken: string | null = null;

export function setAdminToken(token: string | null) {
  adminToken = token;
}

export function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return adminToken ? { ...extra, "x-admin-token": adminToken } : extra;
}
