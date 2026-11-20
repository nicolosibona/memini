// WeChat simulator (blueprint §9 /sim): same core as WeChat. Accepts JSON or multipart (files).
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { appDb, CURRENT_USER } from "@/lib/server";
import { handleIncoming, storeFile, type IncomingItem } from "@/lib/core/ingest";
import { DEMO_FILES } from "@/data/demo/fixtures";

export const runtime = "nodejs";

type SimItem = Omit<IncomingItem, "filePath"> & { demoFile?: string; fileField?: string };

export async function POST(req: Request) {
  const db = await appDb();
  let items: SimItem[];
  const files = new Map<string, File>();
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    items = JSON.parse(String(form.get("items") ?? "[]"));
    for (const [k, v] of form.entries()) if (v instanceof File) files.set(k, v);
  } else {
    items = ((await req.json().catch(() => ({}))) as { items?: SimItem[] }).items ?? [];
  }
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ error: "no items" }, { status: 400 });
  const incoming: IncomingItem[] = [];
  for (const it of items) {
    const { demoFile, fileField, ...rest } = it;
    let filePath: string | undefined;
    if (demoFile) {
      if (!DEMO_FILES.some((d) => d.file === demoFile)) return NextResponse.json({ error: "unknown demo file" }, { status: 400 });
      filePath = storeFile(demoFile, fs.readFileSync(path.join(process.cwd(), "data/demo", demoFile)));
    } else if (fileField && files.has(fileField)) {
      const f = files.get(fileField)!;
      if (f.size > 20 * 1024 * 1024) return NextResponse.json({ error: `${f.name} is larger than 20 MB` }, { status: 413 });
      filePath = storeFile(f.name, Buffer.from(await f.arrayBuffer()));
    }
    incoming.push({ ...rest, filePath, receivedAt: new Date().toISOString() });
  }
  const t0 = Date.now();
  const replies = await handleIncoming({ userId: CURRENT_USER, channel: "sim", items: incoming }, db);
  return NextResponse.json({ replies, ms: Date.now() - t0 });
}
