// Workspace settings: profile (scope), your own company/people names (never matched as counterparties), reply language.
import { NextResponse } from "next/server";
import { appDb, CURRENT_WS, jsonBody } from "@/lib/server";
import { PROFILES } from "@/lib/core/domain";
import { isLang } from "@/lib/core/lang";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const b = await jsonBody<{ profile?: string; own_names?: string[]; reply_language?: string }>(req);
  if (!b) return NextResponse.json({ error: "bad JSON" }, { status: 400 });
  if (b.profile && !(b.profile in PROFILES)) return NextResponse.json({ error: "unknown profile" }, { status: 400 });
  if (b.reply_language !== undefined && !isLang(b.reply_language)) return NextResponse.json({ error: "unknown language" }, { status: 400 });
  if (b.own_names && (!Array.isArray(b.own_names) || b.own_names.some((n) => typeof n !== "string"))) return NextResponse.json({ error: "own_names must be a list of names" }, { status: 400 });
  const db = await appDb();
  if (b.profile) db.prepare(`UPDATE workspaces SET profile = ? WHERE id = ?`).run(b.profile, CURRENT_WS);
  if (b.own_names) db.prepare(`UPDATE workspaces SET own_names = ? WHERE id = ?`).run(JSON.stringify(b.own_names.map((n) => n.trim()).filter(Boolean).slice(0, 30)), CURRENT_WS);
  if (b.reply_language) db.prepare(`UPDATE workspaces SET reply_language = ? WHERE id = ?`).run(b.reply_language, CURRENT_WS);
  return NextResponse.json({ ok: true });
}
