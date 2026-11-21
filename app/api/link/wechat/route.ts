// "Connect WeChat" (blueprint §6.3): contact link with a one-time scene value, shown as a QR code.
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appDb, CURRENT_USER } from "@/lib/server";
import { contactLink, wecomConfigured } from "@/lib/channels/wecom";

export const runtime = "nodejs";

export async function POST() {
  if (!wecomConfigured()) return NextResponse.json({ error: "WeChat is not configured yet (see blueprint §13). Open the WeChat page for setup steps." }, { status: 503 });
  const db = await appDb();
  const scene = crypto.randomBytes(6).toString("hex");
  const code = String(crypto.randomInt(100000, 1000000)); // fallback: type this 6-digit code in the chat
  db.prepare(`INSERT OR REPLACE INTO wecom_state (k, v) VALUES (?, ?)`).run(`link:${scene}`, JSON.stringify({ user: CURRENT_USER, code, exp: Date.now() + 600000 }));
  try {
    return NextResponse.json({ url: await contactLink(scene), code });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
