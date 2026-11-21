// "Confirm without signing up": a bilingual page (Chinese first) the user forwards to a counterparty on WeChat.
// The counterparty can confirm the terms of a matter in one tap, ask for a change in a short note, and upload the
// documents still missing from the matter's checklist. Everything lands in the right contact and matter directly —
// the sender is known from the link, but the content still goes through the same reading and checks (handleIncoming).
//
// Rules: the page never shows Memini's own checks or notes; what was confirmed is an immutable snapshot (+ sha256);
// a link expires (CONFIRM_LINK_DAYS, default 14) and can be disabled; changes after a confirmation raise an alert.
import crypto from "node:crypto";
import type { DB } from "@/lib/db";
import { addDays, newId, nowIso, today } from "@/lib/db";
import { addFacts, currentTerms, formatValue, isConversationSource, parseValue, sameValue, type FactRow } from "./facts";
import { getMatter, matterChecklist, type MatterRow } from "./matters";
import { getEntity, entityLabel, ownNames } from "./entities";
import { randomToken } from "./tokens";
import { appUrl } from "./links";
import { DOC_TYPES, type DocType, type FactKey } from "./domain";
import type { FactValue } from "./schemas";

export const LINK_DAYS = () => Number(process.env.CONFIRM_LINK_DAYS ?? 14);
export const MAX_UPLOADS = 12;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Terms a counterparty can confirm, in the order they are shown, with how a Chinese business partner calls them. */
export const CONFIRM_KEYS: { key: FactKey; zh: string; en: string }[] = [
  { key: "product_model", zh: "产品型号", en: "Product model" },
  { key: "order_qty", zh: "数量", en: "Quantity" },
  { key: "unit_price", zh: "单价", en: "Unit price" },
  { key: "total_amount", zh: "总金额", en: "Total amount" },
  { key: "moq", zh: "起订量", en: "MOQ" },
  { key: "incoterm", zh: "贸易条款", en: "Incoterm" },
  { key: "port", zh: "港口", en: "Port" },
  { key: "lead_time_days", zh: "交期", en: "Lead time" },
  { key: "ship_date", zh: "出货日期", en: "Ship date" },
  { key: "payment_terms", zh: "付款方式", en: "Payment terms" },
  { key: "deposit_pct", zh: "定金比例", en: "Deposit" },
  { key: "packaging", zh: "包装", en: "Packaging" },
  { key: "warranty", zh: "质保", en: "Warranty" },
  { key: "bank_beneficiary_name", zh: "收款户名", en: "Payee (account name)" },
  { key: "bank_name", zh: "开户银行", en: "Bank" },
  { key: "rent_amount", zh: "月租金", en: "Monthly rent" },
  { key: "security_deposit", zh: "押金", en: "Security deposit" },
  { key: "rent_due_day", zh: "每月付款日", en: "Rent due day" },
  { key: "lease_start", zh: "起租日期", en: "Lease start" },
  { key: "lease_end", zh: "到期日期", en: "Lease end" },
  { key: "property_address", zh: "房屋地址", en: "Property address" },
  { key: "salary_amount", zh: "工资", en: "Salary" },
];
const CONFIRM_KEY_SET = new Set(CONFIRM_KEYS.map((k) => k.key));

const PORT_ZH: Record<string, string> = { Shenzhen: "深圳", Ningbo: "宁波", Shanghai: "上海", Guangzhou: "广州", Xiamen: "厦门", Qingdao: "青岛", Tianjin: "天津", "Hong Kong": "香港" };
const CUR_ZH: Record<string, string> = { USD: "美元", CNY: "元", EUR: "欧元", GBP: "英镑", HKD: "港币" };

/** A value as a Chinese counterparty writes it: 4.20美元 · 1,000个 · 15天 · 30% · FOB · 2026年12月15日 */
export function zhValue(key: FactKey, v: FactValue): string {
  if ("amount" in v) {
    const n = v.amount.toLocaleString("en-US", { minimumFractionDigits: v.amount % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return CUR_ZH[v.currency] ? `${n} ${CUR_ZH[v.currency]}` : `${n} ${v.currency}`;
  }
  const x = (v as { value: string | number }).value;
  if (key === "lead_time_days") return `${x} 天`;
  if (key === "deposit_pct") return `${x}%`;
  if (key === "order_qty" || key === "moq") return `${Number(x).toLocaleString("en-US")} 个`;
  if (key === "rent_due_day") return `每月 ${x} 号`;
  if (key === "port") return PORT_ZH[String(x)] ? `${PORT_ZH[String(x)]} ${x}` : String(x);
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) { const [y, m, d] = x.split("-").map(Number); return `${y}年${m}月${d}日`; }
  return String(x);
}

export type SnapshotTerm = { key: FactKey; zh: string; en: string; value_zh: string; value_en: string; value_json: string; fact_id: number };
export type Snapshot = {
  matter_title: string; matter_kind: string; subject: string | null;
  buyer: string; counterparty: string; counterparty_zh: string | null;
  terms: SnapshotTerm[]; created_at: string;
};
export type LinkRow = {
  token: string; workspace_id: string; user_id: string; matter_id: string; entity_id: string | null; terms_json: string; terms_hash: string; docs_json: string;
  contact_name: string | null; status: "open" | "confirmed" | "changes_requested" | "revoked"; created_at: string; expires_at: string;
  opened_at: string | null; open_count: number; upload_count: number;
};

/** Canonical JSON (sorted keys) → sha256: proves later exactly what was on the page when it was confirmed. */
export const snapshotHash = (s: Snapshot) => crypto.createHash("sha256").update(canonical(s)).digest("hex");
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);

// ── what can go on the page ──
export type TermChoice = { key: FactKey; zh: string; en: string; options: { fact_id: number; value_en: string; value_zh: string; source: string; conflict: boolean }[]; default_fact_id: number };

/**
 * The terms of a matter that a counterparty could confirm. When a document and the conversation disagree, the
 * agreed value wins, else what was said in conversation (the alert already says the document must be corrected);
 * the user sees both and can pick before creating the link.
 */
export function termChoices(db: DB, matterId: string): TermChoice[] {
  const views = currentTerms(db, { matterId });
  const out: TermChoice[] = [];
  for (const def of CONFIRM_KEYS) {
    const v = views.find((t) => t.key === def.key);
    if (!v) continue;
    const candidates = [v.current, ...v.conflicting];
    const preferred = candidates.find((f) => f.status === "agreed") ?? candidates.filter((f) => isConversationSource(f.source_type)).sort((a, b) => (a.stated_at < b.stated_at ? 1 : -1))[0] ?? v.current;
    out.push({
      key: def.key, zh: def.zh, en: def.en, default_fact_id: preferred.id,
      options: candidates.map((f) => ({
        fact_id: f.id, value_en: formatValue(f.key, parseValue(f.value_json)), value_zh: zhValue(f.key, parseValue(f.value_json)),
        source: f.source_type === "document" ? (f.source_doc_type ? DOC_TYPES[f.source_doc_type]?.label ?? "document" : "document") : f.source_type === "voice" ? "voice note" : f.source_type, conflict: candidates.length > 1,
      })),
    });
  }
  return out;
}

/** Documents still missing from the matter's checklist (required first). */
export function missingDocs(db: DB, matter: Pick<MatterRow, "id" | "kind">): DocType[] {
  return matterChecklist(db, matter).filter((c) => !c.done).sort((a, b) => Number(b.required) - Number(a.required)).map((c) => c.doc);
}

// ── creating a link ──
export function createConfirmLink(
  db: DB,
  p: { userId: string; matterId: string; factIds?: number[]; docs?: DocType[]; contactName?: string | null },
): { link: LinkRow; url: string; message_zh: string; snapshot: Snapshot } {
  const matter = getMatter(db, p.matterId);
  if (!matter) throw new Error("unknown matter");
  const entity = matter.entity_id ? getEntity(db, matter.entity_id) : undefined;
  const choices = termChoices(db, matter.id);
  const wanted = p.factIds ? new Set(p.factIds) : null;
  const facts: FactRow[] = [];
  for (const c of choices) {
    const id = wanted ? c.options.map((o) => o.fact_id).find((fid) => wanted.has(fid)) : c.default_fact_id;
    if (id == null) continue;
    const f = db.prepare(`SELECT * FROM facts WHERE id = ? AND matter_id = ?`).get(id, matter.id) as FactRow | undefined;
    if (f && CONFIRM_KEY_SET.has(f.key)) facts.push(f);
  }
  const docs = (p.docs ?? missingDocs(db, matter)).filter((d) => d in DOC_TYPES).slice(0, 8);
  if (!facts.length && !docs.length) throw new Error("Nothing to confirm or collect yet: no terms and no missing documents on this matter.");

  const snapshot: Snapshot = {
    matter_title: matter.title, matter_kind: matter.kind, subject: matter.subject,
    buyer: ownNames(db, matter.workspace_id)[0] ?? "", counterparty: entity ? entityLabel(entity) : "", counterparty_zh: entity?.legal_name_zh ?? null,
    terms: facts.map((f) => {
      const def = CONFIRM_KEYS.find((k) => k.key === f.key)!;
      const v = parseValue(f.value_json);
      return { key: f.key, zh: def.zh, en: def.en, value_zh: zhValue(f.key, v), value_en: formatValue(f.key, v), value_json: f.value_json, fact_id: f.id };
    }),
    created_at: nowIso(),
  };
  const contact = p.contactName ?? (entity ? (db.prepare(`SELECT name FROM contacts WHERE entity_id = ? ORDER BY rowid LIMIT 1`).get(entity.id) as { name: string } | undefined)?.name ?? null : null);
  const link: LinkRow = {
    token: randomToken(), workspace_id: matter.workspace_id, user_id: p.userId, matter_id: matter.id, entity_id: matter.entity_id,
    terms_json: JSON.stringify(snapshot), terms_hash: snapshotHash(snapshot), docs_json: JSON.stringify(docs), contact_name: contact,
    status: "open", created_at: nowIso(), expires_at: `${addDays(today(), LINK_DAYS())}T23:59:59.000Z`, opened_at: null, open_count: 0, upload_count: 0,
  };
  db.prepare(`INSERT INTO share_links (token, workspace_id, user_id, matter_id, entity_id, terms_json, terms_hash, docs_json, contact_name, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(link.token, link.workspace_id, link.user_id, link.matter_id, link.entity_id, link.terms_json, link.terms_hash, link.docs_json, link.contact_name, link.status, link.created_at, link.expires_at);
  const url = confirmUrl(link.token);
  return { link, url, message_zh: forwardMessageZh({ contact, hasTerms: facts.length > 0, docs, url, kind: matter.kind }), snapshot };
}

export const confirmUrl = (token: string) => appUrl(`/c/${token}`);

/** The WeChat message the user forwards with the link: short, polite, says it takes a minute and needs no app. */
export function forwardMessageZh(p: { contact: string | null; hasTerms: boolean; docs: DocType[]; url: string; kind: string }): string {
  const what = p.kind === "lease" ? "租赁条款" : p.kind === "purchase" ? "订单条款" : "相关条款";
  const docsZh = p.docs.map((d) => DOC_TYPES[d].zh).join("、");
  const ask = [p.hasTerms ? `核对并确认一下${what}` : "", p.docs.length ? `上传一下${docsZh}` : ""].filter(Boolean).join("，再");
  return `${p.contact ? `${p.contact}您好` : "您好"}，麻烦您打开下面的链接，${ask}。不用注册，手机上一分钟就好，谢谢！\n${p.url}`;
}

// ── reading a link (public page) ──
export function getLink(db: DB, token: string): LinkRow | null {
  if (!/^[a-z0-9]{16,64}$/.test(token)) return null;
  return (db.prepare(`SELECT * FROM share_links WHERE token = ?`).get(token) as LinkRow | undefined) ?? null;
}
export const isExpired = (l: LinkRow, now = nowIso()) => l.status === "revoked" || now > l.expires_at;

export function markOpened(db: DB, token: string) {
  db.prepare(`UPDATE share_links SET opened_at = COALESCE(opened_at, ?), open_count = open_count + 1 WHERE token = ?`).run(nowIso(), token);
}

export type ConfirmationRow = { id: number; link_token: string; matter_id: string; entity_id: string | null; action: "confirmed" | "changes_requested" | "uploaded"; terms_json: string | null; terms_hash: string | null; note: string | null; message_id: string | null; created_at: string };
export const linkHistory = (db: DB, token: string) => db.prepare(`SELECT * FROM confirmations WHERE link_token = ? ORDER BY id`).all(token) as ConfirmationRow[];

/** Slots on the page: requested documents, done when the matter now has a document of that type. */
export function docSlots(db: DB, link: LinkRow) {
  const have = new Set((db.prepare(`SELECT doc_type FROM documents WHERE matter_id = ?`).all(link.matter_id) as { doc_type: string }[]).map((d) => d.doc_type));
  const bankFact = db.prepare(`SELECT 1 FROM facts WHERE matter_id = ? AND key = 'bank_beneficiary_name' LIMIT 1`).get(link.matter_id);
  return (JSON.parse(link.docs_json) as DocType[]).map((d) => ({
    doc: d, zh: DOC_TYPES[d].zh, en: DOC_TYPES[d].label,
    done: have.has(d) || (d === "proforma_invoice" && have.has("quotation")) || (d === "bank_details" && !!bankFact),
  }));
}

// ── the counterparty's answers ──
const record = (db: DB, l: LinkRow, action: ConfirmationRow["action"], p: { note?: string | null; messageId?: string | null; ip?: string | null; ua?: string | null }) =>
  Number(db.prepare(`INSERT INTO confirmations (link_token, workspace_id, matter_id, entity_id, action, terms_json, terms_hash, note, message_id, ip, user_agent, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(l.token, l.workspace_id, l.matter_id, l.entity_id, action, action === "confirmed" ? l.terms_json : null, action === "confirmed" ? l.terms_hash : null, p.note ?? null, p.messageId ?? null, p.ip ?? null, p.ua?.slice(0, 300) ?? null, nowIso()).lastInsertRowid);

/**
 * "✅ 确认无误": the snapshot becomes what both sides agreed. Each term is stored as the counterparty's own statement
 * (a conversation fact, so a document that still says otherwise keeps its red flag) and marked agreed.
 */
export function confirmTerms(db: DB, token: string, meta: { ip?: string | null; ua?: string | null } = {}): { ok: true; already?: boolean; at: string } | { ok: false; error: string } {
  const l = getLink(db, token);
  if (!l) return { ok: false, error: "not_found" };
  if (l.status === "confirmed") return { ok: true, already: true, at: linkHistory(db, token).find((c) => c.action === "confirmed")?.created_at ?? l.created_at };
  if (isExpired(l)) return { ok: false, error: "expired" };
  const snap = JSON.parse(l.terms_json) as Snapshot;
  if (!snap.terms.length) return { ok: false, error: "nothing_to_confirm" };
  const at = nowIso();
  db.transaction(() => {
    const msgId = newId("msg");
    const text = `已通过确认链接确认条款：${snap.terms.map((t) => `${t.zh} ${t.value_zh}`).join("；")}`;
    db.prepare(`INSERT INTO messages (id, workspace_id, user_id, channel, group_id, direction, kind, intent, text_original, text_translated, entity_id, matter_id, status, received_at) VALUES (?,?,?,?,?,'in','event','content',?,?,?,?,'assigned',?)`)
      .run(msgId, l.workspace_id, l.user_id, "supplier_link", newId("grp"), text, `Confirmed through your link: ${snap.terms.map((t) => `${t.en.toLowerCase()} ${t.value_en}`).join(" · ")}`, l.entity_id, l.matter_id, at);
    const r = addFacts(db, { workspaceId: l.workspace_id, entityId: l.entity_id, matterId: l.matter_id }, snap.terms.map((t) => ({
      key: t.key, value: JSON.parse(t.value_json) as FactValue, said_by: "counterparty", source_type: "chat", source_message_id: msgId,
      quote_original: `${t.zh}：${t.value_zh}（确认链接）`, quote_translated: `${t.en}: ${t.value_en} (confirmed via link)`, stated_at: at, confidence: 1,
    })));
    for (const f of r.saved) {
      db.prepare(`UPDATE facts SET status = 'proposed' WHERE matter_id IS ? AND key = ? AND status = 'agreed'`).run(f.matter_id, f.key); // one agreed value per key
      db.prepare(`UPDATE facts SET status = 'agreed' WHERE id = ?`).run(f.id);
    }
    record(db, l, "confirmed", { messageId: msgId, ...meta });
    db.prepare(`UPDATE share_links SET status = 'confirmed' WHERE token = ?`).run(token);
    db.prepare(`UPDATE matters SET updated_at = ? WHERE id = ?`).run(at, l.matter_id);
  })();
  return { ok: true, at };
}

export function recordChangeRequest(db: DB, token: string, p: { note: string; messageId: string | null; ip?: string | null; ua?: string | null }) {
  const l = getLink(db, token)!;
  record(db, l, "changes_requested", p);
  if (l.status === "open") db.prepare(`UPDATE share_links SET status = 'changes_requested' WHERE token = ?`).run(token);
}

export function recordUpload(db: DB, token: string, p: { fileName: string; ip?: string | null; ua?: string | null }) {
  const l = getLink(db, token)!;
  record(db, l, "uploaded", { note: p.fileName, ip: p.ip, ua: p.ua });
  db.prepare(`UPDATE share_links SET upload_count = upload_count + 1 WHERE token = ?`).run(token);
}

export function revokeLink(db: DB, workspaceId: string, token: string) {
  db.prepare(`UPDATE share_links SET status = 'revoked' WHERE token = ? AND workspace_id = ?`).run(token, workspaceId);
}

export function linksForMatter(db: DB, matterId: string) {
  return db.prepare(`SELECT * FROM share_links WHERE matter_id = ? ORDER BY created_at DESC`).all(matterId) as LinkRow[];
}

/** For the audit: terms confirmed through a link that have changed since (latest confirmation per matter). */
export function changedSinceConfirmation(db: DB, workspaceId: string): { matter_id: string; entity_id: string | null; at: string; changes: { key: FactKey; en: string; was: string; now: string }[] }[] {
  const rows = db.prepare(`SELECT c.* FROM confirmations c WHERE c.workspace_id = ? AND c.action = 'confirmed' AND c.id = (SELECT MAX(id) FROM confirmations c2 WHERE c2.matter_id = c.matter_id AND c2.action = 'confirmed')`).all(workspaceId) as ConfirmationRow[];
  const out = [];
  for (const c of rows) {
    const snap = JSON.parse(c.terms_json ?? "{}") as Snapshot;
    const views = currentTerms(db, { matterId: c.matter_id });
    const changes = [];
    for (const t of snap.terms ?? []) {
      const v = views.find((x) => x.key === t.key);
      if (!v) continue;
      const cur = parseValue(v.current.value_json);
      if (!sameValue(t.key, JSON.parse(t.value_json) as FactValue, cur)) changes.push({ key: t.key, en: t.en, was: t.value_en, now: formatValue(t.key, cur) });
    }
    if (changes.length) out.push({ matter_id: c.matter_id, entity_id: c.entity_id, at: c.created_at, changes });
  }
  return out;
}
