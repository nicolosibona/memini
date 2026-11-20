// "To file": assign pending items to a contact (existing or new), or skip them.
import { NextResponse } from "next/server";
import { appDb, CURRENT_USER, CURRENT_WS, jsonBody } from "@/lib/server";
import { assignFromWeb, skipFromWeb } from "@/lib/core/ingest";
import { ENTITY_KINDS, type EntityKind } from "@/lib/core/domain";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await jsonBody<{ action: "assign" | "skip"; messageIds: string[]; entityId?: string; name?: string; kind?: EntityKind }>(req);
  if (!b || !Array.isArray(b.messageIds) || !b.messageIds.length) return NextResponse.json({ error: "no items" }, { status: 400 });
  const db = await appDb();
  if (b.action === "skip") { skipFromWeb(db, CURRENT_WS, b.messageIds); return NextResponse.json({ ok: true, replies: [] }); }
  if (!b.entityId) return NextResponse.json({ error: "entityId required (or \"new\" with a name)" }, { status: 400 });
  if (b.entityId === "new" && !b.name?.trim()) return NextResponse.json({ error: "a name is required for a new contact" }, { status: 400 });
  if (b.kind && !(b.kind in ENTITY_KINDS)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  try {
    const replies = await assignFromWeb(db, CURRENT_WS, CURRENT_USER, b.messageIds, { entityId: b.entityId, newName: b.name, newKind: b.kind });
    return NextResponse.json({ ok: true, replies });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
