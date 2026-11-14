// A Blob store connected with a custom prefix exposes `<PREFIX>_READ_WRITE_TOKEN`
// instead of the default `BLOB_READ_WRITE_TOKEN`, so look for either.
export function findBlobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find((k) => k.endsWith("_READ_WRITE_TOKEN") && process.env[k]);
  return key ? process.env[key] : undefined;
}
