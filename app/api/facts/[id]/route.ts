// Correct a fact: mark agreed (one agreed value per key) or reject a misread.
import { NextResponse } from "next/server";
import { appDb, CURRENT_WS, jsonBody } from "@/lib/server";
import { runAudit } from "@/lib/core/audit";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await jsonBody<{ status?: "agreed" | "rejected" | "proposed" }>(req);
  if (!b?.status || !["agreed", "rejected", "proposed"].includes(b.status)) return NextResponse.json({ error: "status must be agreed, rejected or proposed" }, { status: 400 });
  const db = await appDb();
  const f = db.prepare(`SELECT id, matter_id, entity_id, key FROM facts WHERE id = ? AND workspace_id = ?`).get(id, CURRENT_WS) as { id: number; matter_id: string | null; entity_id: string | null; key: string } | undefined;
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (b.status === "agreed")
    db.prepare(`UPDATE facts SET status = 'proposed' WHERE ${f.matter_id ? "matter_id = ?" : "entity_id = ?"} AND key = ? AND status = 'agreed'`).run(f.matter_id ?? f.entity_id, f.key);
  db.prepare(`UPDATE facts SET status = ? WHERE id = ?`).run(b.status, id);
  await runAudit(db, CURRENT_WS);
  return NextResponse.json({ ok: true });
}
