// How a fact enters memory (blueprint §4.5, generalized to any counterparty or matter).
// Never overwrite: new values sit next to old ones; "current" is a computed view.
import type { DB } from "@/lib/db";
import { nowIso } from "@/lib/db";
import { DOC_TYPES, factDef, type DocType, type FactKey } from "./domain";
import type { FactValue } from "./schemas";
import { normalizeName } from "./normalize";

export type SaidBy = "counterparty" | "me" | "document" | "registry" | "user_report";
export type SourceType = "chat" | "voice" | "document" | "registry" | "manual";
export type FactStatus = "proposed" | "agreed" | "superseded" | "disputed" | "rejected";

export type FactRow = {
  id: number; workspace_id: string; entity_id: string | null; matter_id: string | null; key: FactKey; value_json: string;
  said_by: SaidBy; source_type: SourceType; source_doc_type: DocType | null; source_message_id: string | null; source_document_id: string | null;
  quote_original: string | null; quote_translated: string | null; stated_at: string; status: FactStatus; confidence: number; created_at: string;
};

export type CandidateFact = {
  key: FactKey; value: FactValue; said_by: SaidBy; source_type: SourceType; source_doc_type?: DocType | null;
  source_message_id?: string | null; source_document_id?: string | null; quote_original?: string | null; quote_translated?: string | null;
  stated_at: string; confidence?: number;
};

export const isDocumentSource = (t: SourceType) => t === "document" || t === "registry";
export const isConversationSource = (t: SourceType) => t === "voice" || t === "chat";

// ── values ──
export function makeValue(key: FactKey, v: { number?: number | null; text?: string | null; currency?: string | null }): FactValue | null {
  const type = factDef(key)?.type ?? "text";
  if (type === "money") {
    const num = v.number ?? (v.text ? Number(String(v.text).replace(/[^\d.]/g, "")) : NaN);
    return Number.isFinite(num) && num !== 0 ? { amount: num, currency: (v.currency ?? "USD").toUpperCase().replace("RMB", "CNY") } : null;
  }
  if (type === "number") {
    const num = v.number ?? (v.text ? Number(String(v.text).replace(/[^\d.]/g, "")) : NaN);
    return Number.isFinite(num) ? { value: num } : null;
  }
  const t = (v.text ?? (v.number != null ? String(v.number) : null))?.trim();
  if (!t) return null;
  if (type === "date") return { value: normalizeDate(t) ?? t };
  return { value: key === "incoterm" ? t.toUpperCase() : t };
}

/** 2026年12月15日 / 2026-12-15 / 2026/12/15 → 2026-12-15 */
export function normalizeDate(s: string): string | null {
  const m = s.match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

export const parseValue = (json: string) => JSON.parse(json) as FactValue;

export function formatValue(key: FactKey | string, v: FactValue): string {
  if ("amount" in v) return `${v.currency} ${v.amount.toLocaleString("en-US", { minimumFractionDigits: v.amount % 1 ? 2 : v.amount < 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  if (key === "deposit_pct") return `${v.value}%`;
  if (key === "lead_time_days" || key === "sample_lead_time_days") return `${v.value} days`;
  if (key === "rent_due_day") return `day ${v.value} of the month`;
  if (typeof v.value === "number") return v.value.toLocaleString("en-US");
  if (factDef(key)?.type === "date") return fmtDay(v.value);
  return v.value;
}

export const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) || !/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export const factLabel = (key: string) => factDef(key)?.label ?? key;

/** Same value? Money within 0.5%, names by normalized form, text case/space-insensitive. */
export function sameValue(key: FactKey, a: FactValue, b: FactValue): boolean {
  if ("amount" in a && "amount" in b) {
    if (a.currency !== b.currency) return false;
    return Math.abs(a.amount - b.amount) / Math.max(Math.abs(a.amount), Math.abs(b.amount), 1e-9) <= 0.005;
  }
  if ("value" in a && "value" in b) {
    if (typeof a.value === "number" && typeof b.value === "number") return a.value === b.value;
    const x = String(a.value), y = String(b.value);
    if (/name|holder|authority/.test(key)) return normalizeName(x) === normalizeName(y);
    return x.replace(/\s/g, "").toLowerCase() === y.replace(/\s/g, "").toLowerCase();
  }
  return false;
}

// ── quote check: blocks most LLM inventions ──
const squash = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export function quoteAppears(quote: string | null | undefined, source: string): boolean {
  if (!quote) return false;
  const q = squash(quote), src = squash(source);
  if (!q) return false;
  if (src.includes(q)) return true;
  const grams = Array.from({ length: Math.max(q.length - 1, 1) }, (_, i) => q.slice(i, i + 2));
  return grams.filter((g) => src.includes(g)).length / grams.length >= 0.8;
}

// ── writing ──
export type AddFactsResult = { saved: FactRow[]; discarded: { fact: CandidateFact; reason: string }[]; superseded: number[] };

/**
 * Facts belong to a matter when there is one (a price is about THIS purchase, not the supplier forever),
 * else to the entity. Comparisons happen within the same matter/entity scope.
 */
export function addFacts(
  db: DB,
  ctx: { workspaceId: string; entityId: string | null; matterId: string | null },
  candidates: CandidateFact[],
  sourceText?: string,
): AddFactsResult {
  const res: AddFactsResult = { saved: [], discarded: [], superseded: [] };
  const scope = ctx.matterId ? "matter_id = ?" : "entity_id = ? AND matter_id IS NULL";
  const scopeId = ctx.matterId ?? ctx.entityId;
  const latestStmt = db.prepare(`SELECT * FROM facts WHERE ${scope} AND key = ? AND status NOT IN ('superseded','rejected') ORDER BY stated_at DESC, id DESC`);
  const insert = db.prepare(
    `INSERT INTO facts (workspace_id, entity_id, matter_id, key, value_json, said_by, source_type, source_doc_type, source_message_id,
      source_document_id, quote_original, quote_translated, stated_at, status, confidence, created_at)
     VALUES (@workspace_id, @entity_id, @matter_id, @key, @value_json, @said_by, @source_type, @source_doc_type, @source_message_id,
      @source_document_id, @quote_original, @quote_translated, @stated_at, @status, @confidence, @created_at)`,
  );
  db.transaction(() => {
    for (const c of candidates) {
      if (sourceText != null && isConversationSource(c.source_type) && !quoteAppears(c.quote_original, sourceText)) {
        res.discarded.push({ fact: c, reason: "quote not found in source" });
        continue;
      }
      const prev = latestStmt.all(scopeId, c.key) as FactRow[];
      const sameKind = prev.find((p) => isDocumentSource(p.source_type) === isDocumentSource(c.source_type));
      // conversation→conversation: the negotiation moved on. document→document: the newer document wins.
      // document vs conversation: never superseded — both stay and the audit compares them.
      if (sameKind && !sameValue(c.key, parseValue(sameKind.value_json), c.value)) {
        const sameSource = (c.source_document_id && sameKind.source_document_id === c.source_document_id) || (!c.source_document_id && c.source_message_id && sameKind.source_message_id === c.source_message_id);
        if (!sameSource && c.stated_at >= sameKind.stated_at) {
          db.prepare(`UPDATE facts SET status = 'superseded' WHERE id = ?`).run(sameKind.id);
          res.superseded.push(sameKind.id);
        }
      }
      const row = {
        workspace_id: ctx.workspaceId, entity_id: ctx.entityId, matter_id: ctx.matterId, key: c.key, value_json: JSON.stringify(c.value),
        said_by: c.said_by, source_type: c.source_type, source_doc_type: c.source_doc_type ?? null, source_message_id: c.source_message_id ?? null,
        source_document_id: c.source_document_id ?? null, quote_original: c.quote_original ?? null, quote_translated: c.quote_translated ?? null,
        stated_at: c.stated_at, status: "proposed" as FactStatus, confidence: c.confidence ?? (c.said_by === "user_report" ? 0.6 : 0.9), created_at: nowIso(),
      };
      const info = insert.run(row);
      res.saved.push({ id: Number(info.lastInsertRowid), ...row } as FactRow);
    }
  })();
  return res;
}

// ── views ──
export type TermView = { key: FactKey; current: FactRow; history: FactRow[]; conflicting: FactRow[] };

/** Current terms of a matter (or of an entity's own facts): latest agreed, else latest proposed; older = history. */
export function currentTerms(db: DB, scope: { matterId?: string; entityId?: string }): TermView[] {
  const rows = (scope.matterId
    ? db.prepare(`SELECT * FROM facts WHERE matter_id = ? AND status != 'rejected' ORDER BY stated_at DESC, id DESC`).all(scope.matterId)
    : db.prepare(`SELECT * FROM facts WHERE entity_id = ? AND status != 'rejected' ORDER BY stated_at DESC, id DESC`).all(scope.entityId)) as FactRow[];
  const byKey = new Map<FactKey, FactRow[]>();
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  const out: TermView[] = [];
  for (const [key, list] of byKey) {
    const active = list.filter((r) => r.status !== "superseded");
    const current = active.find((r) => r.status === "agreed") ?? active[0] ?? list[0];
    const cv = parseValue(current.value_json);
    out.push({
      key, current, history: list.filter((r) => r.id !== current.id && r.status === "superseded"),
      conflicting: active.filter((r) => r.id !== current.id && !sameValue(key, parseValue(r.value_json), cv)),
    });
  }
  return out;
}

export function sourceKind(f: Pick<FactRow, "source_type" | "source_doc_type" | "said_by">): string {
  if (f.source_type === "document") return (f.source_doc_type && DOC_TYPES[f.source_doc_type]?.label.toLowerCase()) || "document";
  return { chat: "chat", voice: "voice note", registry: "registry", manual: "manual entry", document: "document" }[f.source_type] + (f.said_by === "user_report" ? " (your report)" : "");
}

export function sourceLabel(f: Pick<FactRow, "source_type" | "source_doc_type" | "stated_at" | "said_by">): string {
  const d = new Date(f.stated_at);
  return `${sourceKind(f)}, ${isNaN(+d) ? f.stated_at : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** "the Nov 18 voice note" — for sentences. */
export function sourcePhrase(f: Pick<FactRow, "source_type" | "source_doc_type" | "stated_at" | "said_by">): string {
  const d = new Date(f.stated_at);
  return `the ${isNaN(+d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " "}${sourceKind(f)}`;
}
