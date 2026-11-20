// Signed, expiring links for pages opened from WeChat (blueprint §9 /s/[token], §12).
import crypto from "node:crypto";

const secret = () => process.env.LINK_SECRET ?? process.env.WECOM_ENCODING_AES_KEY ?? "memini-dev-secret";
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (payload: string) => b64u(crypto.createHmac("sha256", secret()).update(payload).digest()).slice(0, 22);

export type LinkTarget = { kind: "e" | "m"; id: string }; // entity or matter

export function signLink(kind: "e" | "m", id: string, ttlDays = 14): string {
  const payload = b64u(JSON.stringify({ k: kind, s: id, e: Date.now() + ttlDays * 86400000 }));
  return `${payload}.${sign(payload)}`;
}

export function verifyLink(token: string): LinkTarget | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { k, s, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { k?: "e" | "m"; s: string; e: number };
    return Date.now() < e ? { kind: k ?? "e", id: s } : null;
  } catch {
    return null;
  }
}

export const appUrl = (p: string) => `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}${p}`;
export const shareUrl = (kind: "e" | "m", id: string) => appUrl(`/s/${signLink(kind, id)}`);
