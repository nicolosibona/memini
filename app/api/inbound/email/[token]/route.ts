// Webhook for Email-to-Memini: POST /api/inbound/email/<token> with the raw email (message/rfc822), e.g. from the
// Cloudflare Email Worker in scripts/cloudflare-email-worker.js. Also accepts JSON { raw } or Postmark's { RawEmail }.
// Answers at once; the email is read in the background so the sender never times out.
import { after, NextResponse } from "next/server";
import { appDb } from "@/lib/server";
import { resolveToken } from "@/lib/core/tokens";
import { deliverRaw } from "@/lib/channels/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX = 40 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await appDb();
  if (!resolveToken(db, token, "email")) return NextResponse.json({ error: "unknown token" }, { status: 404 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX) return NextResponse.json({ error: "too large" }, { status: 413 });
  let raw: Buffer;
  if ((req.headers.get("content-type") ?? "").includes("json")) {
    const j = (await req.json().catch(() => null)) as { raw?: string; RawEmail?: string } | null;
    const s = j?.raw ?? j?.RawEmail;
    if (!s) return NextResponse.json({ error: "no raw email" }, { status: 400 });
    raw = Buffer.from(s, "utf8");
  } else raw = Buffer.from(await req.arrayBuffer());
  if (!raw.length || raw.length > MAX) return NextResponse.json({ error: "empty or too large" }, { status: 400 });
  after(async () => {
    const r = await deliverRaw(raw, { via: "webhook", token, notify: true }, db).catch((e) => ({ ok: false as const, reason: String(e) }));
    console.log(`[email] webhook: ${r.ok ? `delivered (${r.replies.length} replies)` : `refused: ${r.reason}`}`);
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
