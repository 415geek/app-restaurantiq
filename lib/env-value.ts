/** Strip accidental JSON-style quotes from Vercel/dashboard paste mistakes. */
export function envValue(name: string): string | null {
  const raw = process.env[name];
  if (raw == null) return null;
  let v = String(raw).trim();
  if (!v) return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v || null;
}
