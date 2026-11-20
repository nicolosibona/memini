// Read-side views over memory, shared by the assistant tools (§8) and the web pages (§9).
import type { DB } from "@/lib/db";
import { currentTerms, formatValue, parseValue, sourceLabel, factLabel, type FactRow, type TermView } from "./facts";
import { openAlerts, trustLight, type AlertRow, type Trust } from "./audit";
import { normalizeName } from "./normalize";
import { getEntity, listEntities, type EntityLite } from "./entities";
import { comparableGroups, getMatter, listMatters, matterChecklist, type MatterRow } from "./matters";
import { listTasks } from "./tasks";
import type { FactKey } from "./domain";

export type DocLite = { id: string; doc_type: string; title: string; file_path: string | null; expires_at: string | null; created_at: string; matter_id: string | null; entity_id: string | null };

const docs = (db: DB, where: string, id: string) =>
  db.prepare(`SELECT id, doc_type, title, file_path, expires_at, created_at, matter_id, entity_id FROM documents WHERE ${where} = ? ORDER BY created_at DESC`).all(id) as DocLite[];

export function entityProfile(db: DB, id: string) {
  const entity = getEntity(db, id);
  if (!entity) return null;
  const matters = listMatters(db, entity.workspace_id, { entityId: id, profile: "china_business" });
  return {
    entity,
    trust: trustLight(db, { entityId: id }) as Trust,
    alerts: openAlerts(db, { entityId: id }),
    company: currentTerms(db, { entityId: id }).filter((t) => ["legal_name_zh", "legal_name_en", "credit_code", "legal_rep", "reg_capital", "business_scope", "registered_address"].includes(t.key)),
    matters: matters.map((m) => ({ ...m, trust: trustLight(db, { matterId: m.id }) as Trust, terms: currentTerms(db, { matterId: m.id }) })),
    tasks: listTasks(db, entity.workspace_id, { entityId: id }),
    contacts: db.prepare(`SELECT name, role, wechat_nickname FROM contacts WHERE entity_id = ?`).all(id) as { name: string; role: string | null; wechat_nickname: string | null }[],
    documents: docs(db, "entity_id", id),
  };
}
export type EntityProfile = NonNullable<ReturnType<typeof entityProfile>>;

export function matterView(db: DB, id: string) {
  const matter = getMatter(db, id);
  if (!matter) return null;
  return {
    matter,
    entity: matter.entity_id ? getEntity(db, matter.entity_id) ?? null : null,
    trust: trustLight(db, { matterId: id }) as Trust,
    alerts: openAlerts(db, { matterId: id }),
    terms: currentTerms(db, { matterId: id }),
    checklist: matterChecklist(db, matter),
    tasks: listTasks(db, matter.workspace_id, { matterId: id }),
    documents: docs(db, "matter_id", id),
  };
}
export type MatterView = NonNullable<ReturnType<typeof matterView>>;

export const termValue = (t: TermView | undefined) => (t ? formatValue(t.key, parseValue(t.current.value_json)) : null);

export const COMPARE_KEYS: FactKey[] = ["unit_price", "moq", "incoterm", "port", "lead_time_days", "payment_terms", "deposit_pct"];

/** Side-by-side terms for purchases of the SAME product (comparable groups). */
export function compareGroup(db: DB, matters: MatterRow[], keys: FactKey[] = COMPARE_KEYS) {
  return matters.map((m) => {
    const v = matterView(db, m.id)!;
    const row: Record<string, { value: string; source: string; fact_id: number; conflicting: boolean } | null> = {};
    for (const k of keys) {
      const t = v.terms.find((x) => x.key === k);
      row[k] = t ? { value: termValue(t)!, source: sourceLabel(t.current), fact_id: t.current.id, conflicting: t.conflicting.length > 0 } : null;
    }
    const hasLicense = !!v.entity && !!db.prepare(`SELECT 1 FROM documents WHERE entity_id = ? AND doc_type = 'business_license'`).get(v.entity.id);
    return {
      matter_id: m.id, title: m.title, entity_id: v.entity?.id ?? null, label: v.entity?.label ?? "", name: v.entity?.display_name ?? m.title,
      trust: v.trust, open_red: v.alerts.filter((a) => a.severity === "red").length, open_amber: v.alerts.filter((a) => a.severity === "amber").length,
      has_license: hasLicense, terms: row,
    };
  });
}

export function comparisons(db: DB, workspaceId: string) {
  return comparableGroups(db, workspaceId).map((g) => ({ subject: g.subject, key: g.key, rows: compareGroup(db, g.matters) }));
}

export type TimelineEvent = { at: string; kind: "message" | "document" | "fact" | "alert"; text: string; ref?: string };
export function timeline(db: DB, scope: { entityId?: string; matterId?: string }, limit = 40): TimelineEvent[] {
  const col = scope.matterId ? "matter_id" : "entity_id";
  const id = scope.matterId ?? scope.entityId;
  const ev: TimelineEvent[] = [];
  for (const m of db.prepare(`SELECT id, kind, original_author, text_original, received_at FROM messages WHERE ${col} = ? AND kind IN ('text','voice','merged')`).all(id) as { id: string; kind: string; original_author: string | null; text_original: string; received_at: string }[])
    ev.push({ at: m.received_at, kind: "message", ref: m.id, text: `${m.original_author ? m.original_author + ": " : ""}${m.text_original?.slice(0, 140) ?? ""}` });
  for (const d of db.prepare(`SELECT id, title, created_at FROM documents WHERE ${col} = ?`).all(id) as { id: string; title: string; created_at: string }[])
    ev.push({ at: d.created_at, kind: "document", ref: d.id, text: d.title });
  for (const f of db.prepare(`SELECT * FROM facts WHERE ${col} = ? AND key IN ('unit_price','incoterm','lead_time_days','moq','deposit_pct','rent_amount','amount_due','expiry_date')`).all(id) as FactRow[])
    ev.push({ at: f.stated_at, kind: "fact", ref: String(f.id), text: `${factLabel(f.key)}: ${formatValue(f.key, parseValue(f.value_json))} (${sourceLabel(f)})${f.status === "superseded" ? " — later changed" : ""}` });
  for (const a of db.prepare(`SELECT * FROM alerts WHERE ${col} = ?`).all(id) as AlertRow[])
    ev.push({ at: a.created_at, kind: "alert", ref: String(a.id), text: `${a.title}${a.status !== "open" ? ` (${a.status})` : ""}` });
  return ev.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

// ── full-text search (FTS5 trigram: works for Chinese) ──
export function indexText(db: DB, ref: { type: "message" | "document"; id: string; workspaceId: string; entityId?: string | null; matterId?: string | null }, text: string) {
  db.prepare(`DELETE FROM search_index WHERE ref_type = ? AND ref_id = ?`).run(ref.type, ref.id);
  if (text.trim()) db.prepare(`INSERT INTO search_index (ref_type, ref_id, workspace_id, entity_id, matter_id, text) VALUES (?,?,?,?,?,?)`).run(ref.type, ref.id, ref.workspaceId, ref.entityId ?? "", ref.matterId ?? "", text);
}
export function reindexScope(db: DB, ref: { type: "message" | "document"; id: string }, entityId: string | null, matterId: string | null) {
  db.prepare(`UPDATE search_index SET entity_id = ?, matter_id = ? WHERE ref_type = ? AND ref_id = ?`).run(entityId ?? "", matterId ?? "", ref.type, ref.id);
}

export function searchMemory(db: DB, workspaceId: string, query: string, opts: { entityId?: string | null; limit?: number } = {}) {
  const terms = query.split(/\s+/).map((t) => t.replace(/["*()]/g, "")).filter((t) => [...t].length >= 3);
  if (!terms.length) return [];
  return db.prepare(
    `SELECT ref_type, ref_id, entity_id, matter_id, snippet(search_index, 5, '«', '»', '…', 12) AS snippet FROM search_index
     WHERE search_index MATCH ? AND workspace_id = ? ${opts.entityId ? "AND entity_id = ?" : ""} ORDER BY rank LIMIT ?`,
  ).all(...[terms.map((t) => `"${t}"`).join(" OR "), workspaceId, ...(opts.entityId ? [opts.entityId] : []), opts.limit ?? 8]) as { ref_type: string; ref_id: string; entity_id: string; matter_id: string; snippet: string }[];
}

/** "Seller 2", "ABC", "Lisa", "the Ningbo one", "my landlord" → entity ids. */
export function findEntityRefs(db: DB, workspaceId: string, text: string): string[] {
  const ents = listEntities(db, workspaceId, { includeSelf: true });
  const t = text.toLowerCase();
  const hits = new Set<string>();
  for (const m of t.matchAll(/seller\s*(\d+)/g)) { const e = ents.find((x) => x.label.toLowerCase() === `seller ${m[1]}`); if (e) hits.add(e.id); }
  const byKind: [RegExp, string][] = [[/landlord|房东/, "landlord"], [/tax (office|bureau)|税务局/, "government"], [/accountant|agent|代理|会计/, "service_provider"], [/bank|银行/, "bank"]];
  for (const [re, kind] of byKind) if (re.test(t)) for (const e of ents.filter((x) => x.kind === kind)) hits.add(e.id);
  const aliases = db.prepare(`SELECT a.entity_id, a.value_raw FROM entity_aliases a JOIN entities e ON e.id = a.entity_id WHERE e.workspace_id = ?`).all(workspaceId) as { entity_id: string; value_raw: string }[];
  const words = normalizeName(text);
  for (const e of ents) {
    const names = [e.display_name, e.legal_name_zh, e.legal_name_en, ...aliases.filter((a) => a.entity_id === e.id).map((a) => a.value_raw)].filter(Boolean) as string[];
    for (const n of names) {
      const tokens = n.split(/[\s,.()（）🌸|·\-–]+/).map((x) => x.toLowerCase()).filter((x) => x.length >= 3 && !GENERIC.has(x));
      if (tokens.some((tok) => new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t) || (/[一-鿿]/.test(tok) && t.includes(tok))) || (normalizeName(n).length >= 4 && words.includes(normalizeName(n)))) hits.add(e.id);
    }
  }
  return [...hits];
}
const GENERIC = new Set(["co.", "ltd", "ltd.", "limited", "technology", "tech", "trading", "electronics", "electronic", "company", "sales", "the", "factory", "industrial", "seller", "shanghai", "office", "bureau", "chat", "with"]);

export type { EntityLite };
