import { NextResponse } from "next/server";
import { appDb, CURRENT_WS, jsonBody } from "@/lib/server";
import { runAudit } from "@/lib/core/audit";
import { subjectKey } from "@/lib/core/matters";
import { nowIso } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await jsonBody<{ status?: string; title?: string; subject?: string; target_date?: string | null }>(req);
  if (!b) return NextResponse.json({ error: "bad JSON" }, { status: 400 });
  if (b.status && !["open", "waiting", "done", "archived"].includes(b.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
  const db = await appDb();
  const m = db.prepare(`SELECT id FROM matters WHERE id = ? AND workspace_id = ?`).get(id, CURRENT_WS);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (b.status) db.prepare(`UPDATE matters SET status = ? WHERE id = ?`).run(b.status, id);
  if (b.title?.trim()) db.prepare(`UPDATE matters SET title = ? WHERE id = ?`).run(b.title.trim().slice(0, 120), id);
  if (b.subject !== undefined) db.prepare(`UPDATE matters SET subject = ?, subject_norm = ? WHERE id = ?`).run(b.subject.trim() || null, subjectKey(b.subject.trim()), id);
  if (b.target_date !== undefined) db.prepare(`UPDATE matters SET target_date = ? WHERE id = ?`).run(b.target_date, id);
  db.prepare(`UPDATE matters SET updated_at = ? WHERE id = ?`).run(nowIso(), id);
  await runAudit(db, CURRENT_WS);
  return NextResponse.json({ ok: true });
}
