// WeCom callback (blueprint §13.3 step 4, §13.4). GET = URL verification; POST = event notification.
// Answer "success" at once and pull messages in the background (WeCom retries slow callbacks).
import { after } from "next/server";
import { decrypt, verifySignature, xmlField } from "@/lib/channels/wecomCrypto";
import { onCallbackEvent } from "@/lib/channels/wecom";

export const runtime = "nodejs";

const cfg = () => ({ token: process.env.WECOM_CALLBACK_TOKEN ?? "", aesKey: process.env.WECOM_ENCODING_AES_KEY ?? "" });

export async function GET(req: Request) {
  const u = new URL(req.url);
  const [sig, ts, nonce, echostr] = ["msg_signature", "timestamp", "nonce", "echostr"].map((k) => u.searchParams.get(k) ?? "");
  const { token, aesKey } = cfg();
  if (!token || !aesKey) return new Response("callback not configured", { status: 500 });
  if (!verifySignature(token, ts, nonce, echostr, sig)) return new Response("bad signature", { status: 401 });
  try {
    return new Response(decrypt(aesKey, echostr).message, { headers: { "content-type": "text/plain" } });
  } catch (e) {
    console.error("[wecom] echostr decrypt failed", e);
    return new Response("decrypt failed", { status: 400 });
  }
}

export async function POST(req: Request) {
  const u = new URL(req.url);
  const [sig, ts, nonce] = ["msg_signature", "timestamp", "nonce"].map((k) => u.searchParams.get(k) ?? "");
  const { token, aesKey } = cfg();
  const body = await req.text();
  const enc = xmlField(body, "Encrypt") ?? "";
  if (!verifySignature(token, ts, nonce, enc, sig)) return new Response("bad signature", { status: 401 });
  let inner: string;
  try {
    inner = decrypt(aesKey, enc).message;
  } catch {
    return new Response("decrypt failed", { status: 400 });
  }
  if (xmlField(inner, "Event") === "kf_msg_or_event") {
    const evToken = xmlField(inner, "Token") ?? "";
    const openKfId = xmlField(inner, "OpenKfId") || process.env.WECOM_OPEN_KFID || "";
    after(() => onCallbackEvent(evToken, openKfId));
  }
  return new Response("success");
}
