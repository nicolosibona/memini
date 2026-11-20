// The user's verdict on a check: "acknowledged" (cleared up) or "dismissed" (false alarm). Neither is reopened by the audit.
import { NextResponse } from "next/server";
import { appDb, CURRENT_WS, jsonBody } from "@/lib/server";
import { nowIso } from "@/lib/db";

export const runtime = "nodejs";
const ALLOWED = ["open", "acknowledged", "dismissed"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await jsonBody<{ status: (typeof ALLOWED)[number] }>(req);
  if (!b || !ALLOWED.includes(b.status)) return NextResponse.json({ error: `status must be one of ${ALLOWED.join(", ")}` }, { status: 400 });
  const db = await appDb();
  const r = db.prepare(`UPDATE alerts SET status = ?, resolved_at = ? WHERE id = ? AND workspace_id = ?`).run(b.status, b.status === "open" ? null : nowIso(), id, CURRENT_WS);
  return r.changes ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
