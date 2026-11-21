// Web app: the user's forwarding address, resetting it, and "Simulate an incoming email" (no mailbox needed).
import { NextResponse } from "next/server";
import { appDb, CURRENT_USER, jsonBody } from "@/lib/server";
import { rotateToken } from "@/lib/core/tokens";
import { inboundAddress, deliverParsed, deliverRaw } from "@/lib/channels/email";
import { forwardedFrom, trimBody, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type ParsedEmail } from "@/lib/core/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await appDb();
  return NextResponse.json(inboundAddress(db, CURRENT_USER));
}

export async function POST(req: Request) {
  const db = await appDb();
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const b = await jsonBody<{ action?: string }>(req);
    if (b?.action !== "rotate") return NextResponse.json({ error: "unknown action" }, { status: 400 });
    rotateToken(db, CURRENT_USER, "email");
    return NextResponse.json(inboundAddress(db, CURRENT_USER));
  }
  // simulate: multipart { from, subject, body, files[] } or { eml }
  const form = await req.formData();
  const eml = form.get("eml");
  if (eml instanceof File && eml.size) {
    const r = await deliverRaw(Buffer.from(await eml.arrayBuffer()), { via: "simulate", userId: CURRENT_USER }, db);
    return r.ok ? NextResponse.json({ replies: r.replies }) : NextResponse.json({ error: r.reason }, { status: 400 });
  }
  const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n");
  const from = String(form.get("from") ?? "").trim().toLowerCase() || null;
  const attachments: ParsedEmail["attachments"] = [];
  for (const f of form.getAll("files")) {
    if (!(f instanceof File) || !f.size || f.size > MAX_ATTACHMENT_BYTES || attachments.length >= MAX_ATTACHMENTS) continue;
    attachments.push({ filename: f.name, mimeType: f.type || "application/octet-stream", content: Buffer.from(await f.arrayBuffer()) });
  }
  const mail: ParsedEmail = {
    messageId: null, from, fromName: String(form.get("fromName") ?? "").trim() || null, to: [], subject: String(form.get("subject") ?? "").trim(),
    date: new Date().toISOString(), body: trimBody(body), forwarded: forwardedFrom(body), authPass: true, attachments, skipped: [],
  };
  if (!mail.body && !attachments.length) return NextResponse.json({ error: "Write a body or attach a file." }, { status: 400 });
  const r = await deliverParsed(mail, { via: "simulate", userId: CURRENT_USER }, db);
  return r.ok ? NextResponse.json({ replies: r.replies }) : NextResponse.json({ error: r.reason }, { status: 400 });
}
