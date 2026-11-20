// Matters (pratiche): the unit of work. A purchase from a supplier, a residence-permit renewal, an office lease,
// monthly tax filings… Each kind has a playbook (domain.ts) with a document checklist.
import type { DB } from "@/lib/db";
import { newId, nowIso } from "@/lib/db";
import { DOC_TYPES, MATTER_KINDS, matterKindsFor, type DocType, type MatterKind } from "./domain";
import { nameSimilarity, normalizeName } from "./normalize";

export type MatterRow = {
  id: string; workspace_id: string; kind: MatterKind; title: string; subject: string | null; subject_norm: string | null;
  status: "open" | "waiting" | "done" | "archived"; entity_id: string | null; target_date: string | null; created_at: string; updated_at: string;
};

/** Matters that belong to one counterparty (two suppliers = two purchases); the others are workspace-wide (one tax matter). */
export const COUNTERPARTY_SCOPED: MatterKind[] = ["purchase", "sale", "lease", "hr", "legal"];

/** Product / topic key used to group comparable matters ("65W GaN USB-C charger" ≈ "65w usb-c charger"). */
export function subjectKey(s: string | null | undefined): string | null {
  if (!s) return null;
  const k = normalizeName(s).replace(/(氮化镓|gan|usbc|usb|typec|快充|charger|充电器)/g, (m) => ({ 充电器: "charger", 氮化镓: "gan", typec: "usbc" } as Record<string, string>)[m] ?? m);
  return k || null;
}

export function getMatter(db: DB, id: string) {
  return db.prepare(`SELECT * FROM matters WHERE id = ?`).get(id) as MatterRow | undefined;
}

export function createMatter(db: DB, workspaceId: string, p: { kind: MatterKind; entityId?: string | null; entityName?: string | null; subject?: string | null; title?: string; targetDate?: string | null }): MatterRow {
  const def = MATTER_KINDS[p.kind] ?? MATTER_KINDS.general;
  const title = p.title ?? (p.kind === "purchase" && p.subject ? `${p.subject}` : def.titleHint.replace("{entity}", p.entityName ?? "").replace("{person}", p.entityName ?? "").replace(/ – $/, "").trim());
  const now = nowIso();
  const m: MatterRow = {
    id: newId("mat"), workspace_id: workspaceId, kind: p.kind, title, subject: p.subject ?? null, subject_norm: subjectKey(p.subject),
    status: "open", entity_id: p.entityId ?? null, target_date: p.targetDate ?? null, created_at: now, updated_at: now,
  };
  db.prepare(`INSERT INTO matters (id, workspace_id, kind, title, subject, subject_norm, status, entity_id, target_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(m.id, m.workspace_id, m.kind, m.title, m.subject, m.subject_norm, m.status, m.entity_id, m.target_date, now, now);
  return m;
}

export type MatterPick = { matter: MatterRow; created: boolean } | { ambiguous: MatterRow[] };

/**
 * Which matter does an item belong to, once the counterparty is known?
 * Deterministic: same kind (+ same counterparty for counterparty-scoped kinds) → one open match, or the one whose
 * subject matches, or a new matter. Several equally plausible → ask (never guess).
 */
export function pickMatter(db: DB, workspaceId: string, p: { kind: MatterKind; entityId: string | null; entityName?: string | null; subject?: string | null; personName?: string | null }): MatterPick {
  const scoped = COUNTERPARTY_SCOPED.includes(p.kind) && p.entityId;
  const open = (scoped
    ? db.prepare(`SELECT * FROM matters WHERE workspace_id = ? AND kind = ? AND entity_id = ? AND status IN ('open','waiting') ORDER BY updated_at DESC`).all(workspaceId, p.kind, p.entityId)
    : db.prepare(`SELECT * FROM matters WHERE workspace_id = ? AND kind = ? AND status IN ('open','waiting') ORDER BY updated_at DESC`).all(workspaceId, p.kind)) as MatterRow[];
  // per-person matters (residence permits): the person's own matter
  const forPerson = p.personName ? open.filter((m) => m.subject && nameSimilarity(m.subject, p.personName!) >= 0.85) : open;
  const pool = p.personName && forPerson.length ? forPerson : p.personName && p.kind === "residence_permit" ? [] : open;
  const key = subjectKey(p.subject);
  if (pool.length === 1) {
    const m = pool[0];
    // a different product from the same supplier is a different purchase
    if (key && m.subject_norm && p.kind === "purchase" && nameSimilarity(m.subject_norm, key) < 0.5) return { matter: createMatter(db, workspaceId, { ...p, subject: p.subject }), created: true };
    if (key && !m.subject) db.prepare(`UPDATE matters SET subject = ?, subject_norm = ? WHERE id = ?`).run(p.subject, key, m.id);
    return { matter: m, created: false };
  }
  if (pool.length > 1) {
    const bySubject = key ? pool.filter((m) => m.subject_norm && nameSimilarity(m.subject_norm, key) >= 0.6) : [];
    if (bySubject.length === 1) return { matter: bySubject[0], created: false };
    return { ambiguous: pool.slice(0, 4) };
  }
  return { matter: createMatter(db, workspaceId, { kind: p.kind, entityId: scoped ? p.entityId : p.entityId ?? null, entityName: p.personName ?? p.entityName, subject: p.subject ?? p.personName ?? null }), created: true };
}

export function touchMatter(db: DB, id: string) {
  db.prepare(`UPDATE matters SET updated_at = ? WHERE id = ?`).run(nowIso(), id);
}

/** Playbook checklist with what's already on file. */
export function matterChecklist(db: DB, m: Pick<MatterRow, "id" | "kind">) {
  const docs = db.prepare(`SELECT doc_type FROM documents WHERE matter_id = ?`).all(m.id) as { doc_type: DocType }[];
  const have = new Set(docs.map((d) => d.doc_type));
  // a proforma that carries bank details covers "bank details"
  const bankFact = db.prepare(`SELECT 1 FROM facts WHERE matter_id = ? AND key = 'bank_beneficiary_name' LIMIT 1`).get(m.id);
  return (MATTER_KINDS[m.kind]?.checklist ?? []).map((c) => ({
    doc: c.doc, label: DOC_TYPES[c.doc].label, zh: DOC_TYPES[c.doc].zh, required: c.required, note: "note" in c ? c.note : undefined,
    done: have.has(c.doc) || (c.doc === "proforma_invoice" && have.has("quotation")) || (c.doc === "bank_details" && !!bankFact),
  }));
}

export function listMatters(db: DB, workspaceId: string, opts: { profile?: string; status?: string[]; entityId?: string } = {}) {
  const kinds = matterKindsFor(opts.profile);
  const rows = db.prepare(`SELECT * FROM matters WHERE workspace_id = ? ${opts.entityId ? "AND entity_id = ?" : ""} ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END, updated_at DESC`)
    .all(...[workspaceId, ...(opts.entityId ? [opts.entityId] : [])]) as MatterRow[];
  return rows.filter((m) => kinds.includes(m.kind) && (!opts.status || opts.status.includes(m.status)));
}

/** Purchases grouped by what is being bought: only these are comparable (two quotes for the same charger). */
export function comparableGroups(db: DB, workspaceId: string) {
  const purchases = (db.prepare(`SELECT * FROM matters WHERE workspace_id = ? AND kind = 'purchase' AND status != 'archived'`).all(workspaceId) as MatterRow[]);
  const groups: { key: string; subject: string; matters: MatterRow[] }[] = [];
  for (const m of purchases) {
    const k = m.subject_norm ?? `__${m.id}`;
    const g = groups.find((x) => x.key === k || (m.subject_norm && !x.key.startsWith("__") && nameSimilarity(x.key, m.subject_norm) >= 0.75));
    if (g) g.matters.push(m);
    else groups.push({ key: k, subject: m.subject ?? m.title, matters: [m] });
  }
  return groups.sort((a, b) => b.matters.length - a.matters.length);
}
