// Web bulk upload (blueprint §9 /upload): every file goes through the same core as a WeChat forward.
// Each file is its own group, so one unknown file never blocks the others.
import { NextResponse } from "next/server";
import { appDb, CURRENT_USER } from "@/lib/server";
import { handleIncoming, storeFile } from "@/lib/core/ingest";
import { mimeOf } from "@/lib/core/extract";
import { deliverRaw } from "@/lib/channels/email";

export const runtime = "nodejs";
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const db = await appDb();
  const form = await req.formData();
  const results: { file: string; replies: Awaited<ReturnType<typeof handleIncoming>> }[] = [];
  const text = String(form.get("text") ?? "").trim();
  if (text) results.push({ file: "(pasted text)", replies: await handleIncoming({ userId: CURRENT_USER, channel: "web_upload", items: [{ kind: "text", text }] }, db) });
  for (const v of form.getAll("files")) {
    if (!(v instanceof File)) continue;
    if (v.size > MAX_BYTES) { results.push({ file: v.name, replies: [{ kind: "text", text: `${v.name} is larger than ${MAX_BYTES / 1048576} MB — not read.` }] }); continue; }
    if (/\.eml$/i.test(v.name) || v.type === "message/rfc822") {
      const r = await deliverRaw(Buffer.from(await v.arrayBuffer()), { via: "upload", userId: CURRENT_USER }, db);
      results.push({ file: v.name, replies: r.ok ? r.replies : [{ kind: "text", text: `Couldn't read this email: ${r.reason}` }] });
      continue;
    }
    const p = storeFile(v.name, Buffer.from(await v.arrayBuffer()));
    const mime = mimeOf(p);
    const kind = mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "voice" : "file";
    results.push({ file: v.name, replies: await handleIncoming({ userId: CURRENT_USER, channel: "web_upload", items: [{ kind, filePath: p }] }, db) });
  }
  return NextResponse.json({ results });
}
