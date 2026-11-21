// Spec checks in the database: the open check per user collects what they forward until they start a new one.
import { newId, nowIso, type DB } from "@/lib/db";
import { compare, tally, type Row, type SpecParam } from "./compare";
import { checkTranslation, type IntegrityResult } from "./quantity";
import type { SpecExtraction } from "./schema";

export type CheckRow = { id: string; workspace_id: string; user_id: string; title: string | null; part_name: string | null; part_number: string | null; supplier_name: string | null; status: string; created_at: string; updated_at: string };
export type ItemRow = { id: string; check_id: string; message_id: string | null; ord: number; side: "requirement" | "supplier"; kind: string; title: string; author: string | null; file_path: string | null; text_original: string | null; extracted_json: string; source: string; created_at: string };
export type Segment = { item_id: string; item_title: string; side: ItemRow["side"]; original: string; translation: string; check: IntegrityResult };
export type Note = { item_title: string; text_en: string; quote: string; risk: "low" | "medium" | "high" };
export type CheckView = {
  check: CheckRow; items: (ItemRow & { data: SpecExtraction })[]; rows: Row[]; segments: Segment[]; notes: Note[];
  counts: ReturnType<typeof tally>; translation: { lines: number; verified: number };
};

/** A check stays "current" while the user keeps forwarding; after this long the next forward starts a new one. */
const STALE_MS = Number(process.env.SPEC_CHECK_STALE_MS ?? 6 * 3600_000);

export function currentCheck(db: DB, userId: string): CheckRow | undefined {
  const c = db.prepare(`SELECT * FROM spec_checks WHERE user_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1`).get(userId) as CheckRow | undefined;
  return c && Date.now() - +new Date(c.updated_at) < STALE_MS ? c : undefined;
}

export function newCheck(db: DB, ws: string, userId: string): CheckRow {
  db.prepare(`UPDATE spec_checks SET status = 'closed' WHERE user_id = ? AND status = 'open'`).run(userId);
  const id = newId("chk"), now = nowIso();
  db.prepare(`INSERT INTO spec_checks (id, workspace_id, user_id, status, created_at, updated_at) VALUES (?,?,?,'open',?,?)`).run(id, ws, userId, now, now);
  return db.prepare(`SELECT * FROM spec_checks WHERE id = ?`).get(id) as CheckRow;
}

export function addItem(db: DB, checkId: string, it: { messageId: string | null; side: ItemRow["side"]; kind: string; author: string | null; filePath: string | null; text: string | null; data: SpecExtraction; source: string }) {
  const ord = ((db.prepare(`SELECT MAX(ord) AS n FROM spec_items WHERE check_id = ?`).get(checkId) as { n: number | null }).n ?? 0) + 1;
  const id = newId("si");
  db.prepare(`INSERT INTO spec_items (id, check_id, message_id, ord, side, kind, title, author, file_path, text_original, extracted_json, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, checkId, it.messageId, ord, it.side, it.kind, it.data.title, it.author, it.filePath, it.text, JSON.stringify(it.data), it.source, nowIso());
  // the check takes its name from what it learns (part, part number, supplier), first one wins
  const c = db.prepare(`SELECT * FROM spec_checks WHERE id = ?`).get(checkId) as CheckRow;
  db.prepare(`UPDATE spec_checks SET part_name = ?, part_number = ?, supplier_name = ?, title = ?, updated_at = ? WHERE id = ?`).run(
    c.part_name ?? it.data.part_name, c.part_number ?? it.data.part_number, c.supplier_name ?? (it.side === "supplier" ? it.data.supplier_name : null),
    c.title ?? it.data.part_name ?? it.data.part_number, nowIso(), checkId,
  );
  return id;
}

export function setItemSide(db: DB, itemId: string, side: ItemRow["side"]) {
  db.prepare(`UPDATE spec_items SET side = ? WHERE id = ?`).run(side, itemId);
}

export function getCheck(db: DB, id: string): CheckRow | undefined {
  return db.prepare(`SELECT * FROM spec_checks WHERE id = ?`).get(id) as CheckRow | undefined;
}

export function listChecks(db: DB, ws: string): (CheckRow & { items: number; mismatches: number })[] {
  const checks = db.prepare(`SELECT * FROM spec_checks WHERE workspace_id = ? AND EXISTS (SELECT 1 FROM spec_items i WHERE i.check_id = spec_checks.id) ORDER BY updated_at DESC`).all(ws) as CheckRow[];
  return checks.map((c) => { const v = loadCheck(db, c.id)!; return { ...c, items: v.items.length, mismatches: v.counts.mismatch }; });
}

export function loadCheck(db: DB, id: string): CheckView | undefined {
  const check = getCheck(db, id);
  if (!check) return undefined;
  const items = (db.prepare(`SELECT * FROM spec_items WHERE check_id = ? ORDER BY ord`).all(id) as ItemRow[]).map((i) => ({ ...i, data: JSON.parse(i.extracted_json) as SpecExtraction }));
  const params: SpecParam[] = items.flatMap((i) => i.data.parameters.map((p, k) => ({ ...p, item_id: i.id, item_title: i.title, side: i.side, order: i.ord * 1000 + k })));
  const rows = compare(params);
  const segments: Segment[] = items.flatMap((i) => i.data.segments.map((s) => ({ item_id: i.id, item_title: i.title, side: i.side, original: s.original, translation: s.translation, check: checkTranslation(s.original, s.translation) })));
  const notes: Note[] = items.flatMap((i) => i.data.notes.map((n) => ({ item_title: i.title, ...n })));
  return { check, items, rows, segments, notes, counts: tally(rows), translation: { lines: segments.length, verified: segments.filter((s) => s.check.ok).length } };
}

export const checkTitle = (c: Pick<CheckRow, "title" | "part_name" | "part_number">) =>
  [c.part_name ?? c.title, c.part_number && !(c.part_name ?? c.title ?? "").includes(c.part_number) ? c.part_number : null].filter(Boolean).join(" · ") || "Spec check";
