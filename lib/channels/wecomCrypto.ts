// WeCom callback crypto (WXBizMsgCrypt): SHA1 signature + AES-256-CBC with 32-byte PKCS#7 padding.
// Pure Node crypto, no dependencies. Plaintext layout: random(16) | msg_len(4, big-endian) | msg | receiveid.
import crypto from "node:crypto";

export function signature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  return crypto.createHash("sha1").update([token, timestamp, nonce, encrypt].sort().join("")).digest("hex");
}

export function verifySignature(token: string, timestamp: string, nonce: string, encrypt: string, msgSignature: string): boolean {
  const expected = signature(token, timestamp, nonce, encrypt);
  return expected.length === msgSignature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(msgSignature));
}

function keyOf(encodingAesKey: string) {
  const key = Buffer.from(encodingAesKey + "=", "base64");
  if (key.length !== 32) throw new Error("EncodingAESKey must be 43 characters (32 bytes base64)");
  return { key, iv: key.subarray(0, 16) };
}

export function decrypt(encodingAesKey: string, encrypted: string): { message: string; receiveId: string } {
  const { key, iv } = keyOf(encodingAesKey);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  let buf = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) throw new Error("bad padding");
  buf = buf.subarray(0, buf.length - pad);
  const len = buf.readUInt32BE(16);
  return { message: buf.subarray(20, 20 + len).toString("utf8"), receiveId: buf.subarray(20 + len).toString("utf8") };
}

export function encrypt(encodingAesKey: string, message: string, receiveId: string, random16 = crypto.randomBytes(16)): string {
  const { key, iv } = keyOf(encodingAesKey);
  const msg = Buffer.from(message, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(msg.length, 0);
  let buf = Buffer.concat([random16, len, msg, Buffer.from(receiveId, "utf8")]);
  const pad = 32 - (buf.length % 32);
  buf = Buffer.concat([buf, Buffer.alloc(pad, pad)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(buf), cipher.final()]).toString("base64");
}

/** Minimal XML field reader for WeCom's flat callback XML (<Tag><![CDATA[v]]></Tag> or <Tag>v</Tag>). */
export function xmlField(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`));
  return m ? (m[1] ?? m[2] ?? "").trim() : null;
}
