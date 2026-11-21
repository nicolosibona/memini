// Web chat on the Home page: the same core as the WeChat bot (handleIncoming), so a question gets an answer,
// a pasted message or a file gets read, filed and checked, and menu buttons work the same way.
// Accepts JSON { text } | { menuId } or multipart (text + files).
// Streams NDJSON: {type:"reply"} as each part is ready (fast translation first), then {type:"done"} or {type:"error"}.
import { NextResponse } from "next/server";
import { appDb, CURRENT_USER, jsonBody } from "@/lib/server";
import { handleIncoming, storeFile, type IncomingItem, type OutgoingReply } from "@/lib/core/ingest";
import { mimeOf } from "@/lib/core/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const db = await appDb();
  const items: IncomingItem[] = [];
  const now = new Date().toISOString();

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    for (const v of form.getAll("files")) {
      if (!(v instanceof File)) continue;
      if (v.size > MAX_BYTES) return NextResponse.json({ error: `${v.name} is larger than ${MAX_BYTES / 1048576} MB` }, { status: 413 });
      const p = storeFile(v.name, Buffer.from(await v.arrayBuffer()));
      const mime = mimeOf(p);
      items.push({ kind: mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "voice" : "file", filePath: p, receivedAt: now });
    }
    const text = String(form.get("text") ?? "").trim();
    if (text) items.push({ kind: "text", text, receivedAt: now });
  } else {
    const body = await jsonBody<{ text?: string; menuId?: string }>(req);
    if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    if (body.menuId) items.push({ kind: "text", text: body.text ?? "", menuId: String(body.menuId), receivedAt: now });
    else if (body.text?.trim()) items.push({ kind: "text", text: body.text.trim().slice(0, 8000), receivedAt: now });
  }
  if (!items.length) return NextResponse.json({ error: "Nothing to send" }, { status: 400 });

  const t0 = Date.now();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (o: unknown) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch { /* client went away */ } };
      try {
        // the typing dots already say "working on it", so no "⏳" message on the web — only real content early
        const replies = await handleIncoming({
          userId: CURRENT_USER, channel: "web_chat", items,
          progress: { ack: false, send: async (reply: OutgoingReply) => emit({ type: "reply", reply }) },
        }, db);
        for (const reply of replies) emit({ type: "reply", reply });
        emit({ type: "done", ms: Date.now() - t0 });
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
