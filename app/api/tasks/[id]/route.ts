import { NextResponse } from "next/server";
import { appDb, CURRENT_WS, jsonBody } from "@/lib/server";
import { runAudit } from "@/lib/core/audit";
import { ensureRecurring } from "@/lib/core/tasks";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await jsonBody<{ status?: "open" | "done" | "cancelled"; due?: string }>(req);
  if (!b || (b.status && !["open", "done", "cancelled"].includes(b.status)) || (b.due && !/^\d{4}-\d{2}-\d{2}$/.test(b.due))) return NextResponse.json({ error: "bad input" }, { status: 400 });
  const db = await appDb();
  const r = db.prepare(`UPDATE tasks SET status = COALESCE(?, status), due_at = COALESCE(?, due_at) WHERE id = ? AND workspace_id = ?`).run(b.status ?? null, b.due ?? null, id, CURRENT_WS);
  if (!r.changes) return NextResponse.json({ error: "not found" }, { status: 404 });
  ensureRecurring(db, CURRENT_WS); // paying this month's rent creates next month's reminder
  await runAudit(db, CURRENT_WS);
  return NextResponse.json({ ok: true });
}
