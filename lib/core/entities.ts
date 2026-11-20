// Counterparties (any kind) + identification (blueprint §5, generalized). Principle: NEVER guess.
// Certain only on an exact identifier (credit code, ID/passport number) or an exact strong-alias name of exactly one
// entity, coming from an identifying party role (seller, issuer, subject, authority, landlord…), with nothing pointing elsewhere.
import type { DB } from "@/lib/db";
import { newId, nowIso } from "@/lib/db";
import { checkCreditCode, nameSimilarity, normalizeCreditCode, normalizeName } from "./normalize";
import { ENTITY_KINDS, SELF_KINDS, type EntityKind } from "./domain";

export type ClueKind = "credit_code" | "id_number" | "legal_name" | "name_variant" | "wechat_nickname" | "chat_title";
/** strong = from an identifying role on a document (§5.2); weak = nicknames, chat titles, names typed in a chat. */
export type Clue = { kind: ClueKind; value: string; strong: boolean; role?: string; partyKind?: string };

export type EntityLite = {
  id: string; kind: EntityKind; label: string; display_name: string; legal_name_zh: string | null; legal_name_en: string | null;
  credit_code: string | null; id_number: string | null; last_activity_at: string | null;
};
export type Candidate = { id: string; label: string; display_name: string; kind: EntityKind; reason: string };
export type Resolution = {
  certainId: string | null;
  candidates: Candidate[];
  guessId: string | null;
  guessReason: string | null;
  conflict: string | null;
  newName: string | null; // an identifying name that matches nobody → "➕ New: <name>"
  newKind: EntityKind | null;
};

type AliasRow = { entity_id: string; kind: ClueKind; value_norm: string; strength: "strong" | "weak" };

const normClue = (c: Pick<Clue, "kind" | "value">) =>
  c.kind === "credit_code" ? normalizeCreditCode(c.value) ?? "" : c.kind === "id_number" ? c.value.toUpperCase().replace(/\s/g, "") : normalizeName(c.value);

export const entityLabel = (e: Pick<EntityLite, "label" | "display_name">) => (e.label && e.label !== e.display_name ? `${e.label} – ${e.display_name}` : e.display_name);

export function listEntities(db: DB, workspaceId: string, opts: { kinds?: EntityKind[]; includeSelf?: boolean } = {}): EntityLite[] {
  const rows = db
    .prepare(`SELECT id, kind, label, display_name, legal_name_zh, legal_name_en, credit_code, id_number, last_activity_at FROM entities WHERE workspace_id = ? ORDER BY last_activity_at DESC, created_at`)
    .all(workspaceId) as EntityLite[];
  return rows.filter((r) => (!opts.kinds || opts.kinds.includes(r.kind)) && (opts.includeSelf || !SELF_KINDS.includes(r.kind)));
}

export function ownNames(db: DB, workspaceId: string): string[] {
  const ws = db.prepare(`SELECT own_names FROM workspaces WHERE id = ?`).get(workspaceId) as { own_names: string } | undefined;
  const selfEntities = listEntities(db, workspaceId, { kinds: SELF_KINDS, includeSelf: true }).flatMap((e) => [e.display_name, e.legal_name_zh, e.legal_name_en]);
  return [...(JSON.parse(ws?.own_names ?? "[]") as string[]), ...selfEntities.filter(Boolean)] as string[];
}

/** Map a party role + party kind to the entity kind we'd create for a new counterparty. */
export function kindForRole(role: string | undefined, partyKind?: string, docMatterKind?: string): EntityKind {
  if (partyKind === "government" || role === "authority") return "government";
  if (role === "landlord") return "landlord";
  if (role === "employer") return "other";
  if (role === "customer") return "customer";
  if (role === "agent") return "service_provider";
  if (docMatterKind === "tax" || docMatterKind === "company") return "service_provider";
  if (docMatterKind === "logistics") return "logistics";
  if (docMatterKind === "lease") return "landlord";
  return "supplier";
}

export function resolveEntity(db: DB, opts: { workspaceId: string; clues: Clue[]; recentEntityId?: string | null; includeSelf?: boolean; preferKinds?: EntityKind[] }): Resolution {
  const own = ownNames(db, opts.workspaceId).map(normalizeName);
  const entities = listEntities(db, opts.workspaceId, { includeSelf: opts.includeSelf });
  const byId = new Map(entities.map((e) => [e.id, e]));
  const aliases = db
    .prepare(`SELECT a.entity_id, a.kind, a.value_norm, a.strength FROM entity_aliases a JOIN entities e ON e.id = a.entity_id WHERE e.workspace_id = ?`)
    .all(opts.workspaceId) as AliasRow[];

  // your own company/people are never a counterparty clue (§5.2: the buyer on the PI); invalid codes identify nobody
  const clues = opts.clues.filter(
    (c) => c.value?.trim() &&
      !(c.kind !== "credit_code" && c.kind !== "id_number" && !opts.includeSelf && own.includes(normalizeName(c.value))) &&
      (c.kind !== "credit_code" || checkCreditCode(c.value).valid),
  );

  const exact = (c: Clue): Set<string> => {
    const norm = normClue(c);
    const hits = new Set<string>();
    if (!norm) return hits;
    if (c.kind === "credit_code" || c.kind === "id_number") {
      for (const e of entities) if ((c.kind === "credit_code" ? e.credit_code : e.id_number?.toUpperCase()) === norm) hits.add(e.id);
      for (const a of aliases) if (a.kind === c.kind && a.value_norm === norm && byId.has(a.entity_id)) hits.add(a.entity_id);
    } else {
      for (const a of aliases) if (a.strength === "strong" && (a.kind === "legal_name" || a.kind === "name_variant") && a.value_norm === norm && byId.has(a.entity_id)) hits.add(a.entity_id);
      for (const e of entities) if ([e.legal_name_zh, e.legal_name_en].some((n) => n && normalizeName(n) === norm)) hits.add(e.id);
    }
    return hits;
  };

  const strong = clues.filter((c) => c.strong);
  const results = strong.map((clue) => ({ clue, hits: exact(clue) }));
  const pointed = new Set<string>();
  for (const r of results) for (const id of r.hits) pointed.add(id);
  const unmatched = results.filter((r) => r.hits.size === 0 && (r.clue.kind === "legal_name" || r.clue.kind === "name_variant"));

  let certainId: string | null = null, conflict: string | null = null, newName: string | null = null, newKind: EntityKind | null = null;
  if (pointed.size === 1 && results.every((r) => r.hits.size <= 1)) {
    const e = byId.get([...pointed][0])!;
    // any other identifying name in the same group must look like this entity (e.g. its English name)
    const stray = unmatched.filter((r) => ![e.display_name, e.legal_name_zh, e.legal_name_en].some((n) => n && nameSimilarity(n, r.clue.value) >= 0.85));
    if (!stray.length) certainId = e.id;
    else conflict = describeConflict(results, byId, stray[0].clue.value);
  } else if (pointed.size > 1) {
    conflict = describeConflict(results, byId);
  }
  if (!certainId && !pointed.size && unmatched.length) {
    const distinct = [...new Map(unmatched.map((r) => [normalizeName(r.clue.value), r.clue])).values()];
    const zh = distinct.filter((c) => /[一-鿿]/.test(c.value)), en = distinct.filter((c) => !/[一-鿿]/.test(c.value));
    if (zh.length <= 1 && en.length <= 1) {
      const pick = zh[0] ?? en[0];
      newName = pick.value;
      newKind = kindForRole(pick.role, pick.partyKind);
    } else conflict = `The documents name different organizations (${distinct.slice(0, 2).map((c) => c.value).join(" / ")}) — possibly a middleman or a mistake.`;
  }

  // ── menu order: exact > similar name > weak nickname/chat title > recent context > recent activity ──
  const score = new Map<string, { s: number; reason: string }>();
  const bump = (id: string, s: number, reason: string) => { const c = score.get(id); if (!c || c.s < s) score.set(id, { s, reason }); };
  for (const r of results) for (const id of r.hits) bump(id, 100, `matches "${r.clue.value}"`);
  for (const c of clues.filter((c) => c.kind === "legal_name" || c.kind === "name_variant"))
    for (const e of entities) {
      const sim = Math.max(...[e.display_name, e.legal_name_zh, e.legal_name_en].map((n) => (n ? nameSimilarity(n, c.value) : 0)));
      if (sim >= 0.6) bump(e.id, 50 + sim * 40, `name similar to "${c.value}"`);
    }
  for (const c of clues.filter((c) => c.kind === "wechat_nickname" || c.kind === "chat_title")) {
    const owners = [...new Set(aliases.filter((a) => a.strength === "weak" && a.value_norm === normalizeName(c.value) && byId.has(a.entity_id)).map((a) => a.entity_id))];
    if (owners.length === 1) bump(owners[0], 40, `${c.kind === "chat_title" ? "chat" : "nickname"} "${c.value}" seen before`); // ambiguous nicknames don't rank (§5.11)
  }
  if (opts.recentEntityId && byId.has(opts.recentEntityId)) bump(opts.recentEntityId, 20, "the last one you talked to");
  // what the content is about orders the rest of the menu (a quote → suppliers first); it never makes anything certain
  for (const e of entities) if (opts.preferKinds?.includes(e.kind)) bump(e.id, 10, "");

  const ordered = [...entities].sort((a, b) => (score.get(b.id)?.s ?? 0) - (score.get(a.id)?.s ?? 0) || (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? ""));
  const candidates = ordered.slice(0, 4).map((e) => ({ id: e.id, label: e.label, display_name: e.display_name, kind: e.kind, reason: score.get(e.id)?.reason ?? "" }));
  const top = ordered[0] && score.get(ordered[0].id);
  const guessId = !certainId && !conflict && top && top.s >= 20 && top.reason ? ordered[0].id : null;
  return { certainId, candidates, guessId, guessReason: guessId ? top!.reason : null, conflict, newName, newKind };
}

function describeConflict(results: { clue: Clue; hits: Set<string> }[], byId: Map<string, EntityLite>, stray?: string) {
  const parts: string[] = [];
  for (const r of results) {
    const who = [...r.hits].map((id) => byId.get(id)?.display_name)[0] ?? r.clue.value;
    const p = `${r.clue.role === "subject" ? "the license belongs to" : r.clue.role === "seller" ? "the proforma is issued by" : `the ${r.clue.role ?? "document"} is`} ${who}`;
    if (!parts.includes(p)) parts.push(p);
  }
  if (stray && !parts.some((p) => p.includes(stray))) parts.push(`another document names ${stray}`);
  const s = parts.slice(0, 2).join(", but ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} — possibly a middleman or a mistake.`;
}

// ── learning (§5.11) ──
export function learnAliases(db: DB, entityId: string, clues: Clue[], source: "document" | "user_choice" | "manual"): number[] {
  const learned: number[] = [];
  for (const c of clues) {
    const norm = normClue(c);
    if (!norm || (c.kind === "credit_code" && !checkCreditCode(c.value).valid)) continue;
    const strength = c.kind === "wechat_nickname" || c.kind === "chat_title" || !c.strong ? "weak" : "strong";
    const kind: ClueKind = !c.strong && c.kind === "legal_name" ? "name_variant" : c.kind;
    const row = db.prepare(`SELECT id FROM entity_aliases WHERE entity_id = ? AND kind = ? AND value_norm = ?`).get(entityId, kind, norm) as { id: number } | undefined;
    if (row) db.prepare(`UPDATE entity_aliases SET times_confirmed = times_confirmed + 1 WHERE id = ?`).run(row.id);
    else learned.push(Number(db.prepare(`INSERT INTO entity_aliases (entity_id, kind, value_raw, value_norm, strength, source, times_confirmed, created_at) VALUES (?,?,?,?,?,?,1,?)`).run(entityId, kind, c.value, norm, strength, source, nowIso()).lastInsertRowid));
  }
  // identifiers from a license / ID document become the entity's key, if free
  const code = clues.find((c) => c.kind === "credit_code" && c.strong && c.role === "subject" && checkCreditCode(c.value).valid);
  if (code) {
    const norm = normalizeCreditCode(code.value)!;
    if (!db.prepare(`SELECT 1 FROM entities WHERE credit_code = ? AND id != ?`).get(norm, entityId)) db.prepare(`UPDATE entities SET credit_code = COALESCE(credit_code, ?) WHERE id = ?`).run(norm, entityId);
  }
  const zh = clues.find((c) => c.kind === "legal_name" && c.strong && /[一-鿿]/.test(c.value) && (c.role === "subject" || c.role === "authority" || c.role === "landlord"));
  if (zh) db.prepare(`UPDATE entities SET legal_name_zh = COALESCE(legal_name_zh, ?) WHERE id = ?`).run(zh.value, entityId);
  return learned;
}

export function createEntity(
  db: DB, workspaceId: string,
  p: { kind: EntityKind; display_name: string; legal_name_zh?: string | null; legal_name_en?: string | null; credit_code?: string | null; id_number?: string | null },
): EntityLite {
  const now = nowIso();
  const kind = ENTITY_KINDS[p.kind] ? p.kind : "other";
  // suppliers keep the short "Seller N" label the user knows from WeChat; others are named by themselves
  const label = kind === "supplier"
    ? `Seller ${(db.prepare(`SELECT COUNT(*) AS n FROM entities WHERE workspace_id = ? AND kind = 'supplier'`).get(workspaceId) as { n: number }).n + 1}`
    : shortName(p.display_name);
  const slug = normalizeName(p.legal_name_en ?? p.display_name).replace(/[^a-z0-9]/g, "").slice(0, 18);
  const e: EntityLite = {
    id: `ent_${slug ? slug + "_" : ""}${newId("x").slice(-6)}`, kind, label, display_name: shortName(p.display_name),
    legal_name_zh: p.legal_name_zh ?? (/[一-鿿]/.test(p.display_name) ? p.display_name : null), legal_name_en: p.legal_name_en ?? null,
    credit_code: p.credit_code && checkCreditCode(p.credit_code).valid ? normalizeCreditCode(p.credit_code) : null, id_number: p.id_number ?? null, last_activity_at: now,
  };
  db.prepare(`INSERT INTO entities (id, workspace_id, kind, label, display_name, legal_name_zh, legal_name_en, credit_code, id_number, registry_status, last_activity_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(e.id, workspaceId, e.kind, e.label, e.display_name, e.legal_name_zh, e.legal_name_en, e.credit_code, e.id_number, "unknown", now, now);
  const clues: Clue[] = [{ kind: "name_variant", value: p.display_name, strong: true }];
  if (e.legal_name_zh) clues.push({ kind: "legal_name", value: e.legal_name_zh, strong: true });
  if (e.legal_name_en) clues.push({ kind: "legal_name", value: e.legal_name_en, strong: true });
  if (e.id_number) clues.push({ kind: "id_number", value: e.id_number, strong: true });
  learnAliases(db, e.id, clues, "manual");
  return e;
}

/** "深圳市ABC科技有限公司" → "深圳ABC科技"; "Shenzhen ABC Technology Co., Ltd." → "Shenzhen ABC Technology" */
export function shortName(name: string): string {
  return name.replace(/(股份有限公司|有限责任公司|有限公司)$/, "").replace(/^(.{2,3}?)市/, "$1")
    .replace(/[,\s]*(Co\.?,?\s*Ltd\.?|Company Limited|Limited|Ltd\.?|Inc\.?)$/i, "").trim() || name;
}

export function getEntity(db: DB, id: string) {
  return db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id) as (EntityLite & { workspace_id: string; registry_status: string | null; notes: string | null }) | undefined;
}
