// Server → client prop mapping for the interactive components (serializable, no DB rows leaking).
import type { DB } from "@/lib/db";
import { formatValue, parseValue, sourceLabel, factLabel, isDocumentSource, type FactRow, type TermView } from "@/lib/core/facts";
import type { AlertRow } from "@/lib/core/audit";
import type { TaskRow } from "@/lib/core/tasks";
import type { AlertView, FactView, TaskView, TermRowView } from "@/components/Detail";

export function factView(f: FactRow): FactView {
  return {
    id: f.id, value: formatValue(f.key, parseValue(f.value_json)), status: f.status, source: sourceLabel(f), quote: f.quote_original,
    document_id: f.source_document_id, is_document: isDocumentSource(f.source_type),
  };
}

const ORDER = ["unit_price", "price_tier", "total_amount", "moq", "order_qty", "incoterm", "port", "lead_time_days", "sample_lead_time_days", "payment_terms", "deposit_pct",
  "tooling_fee", "sample_fee", "other_fee", "rent_amount", "security_deposit", "rent_due_day", "lease_start", "lease_end", "property_address", "amount_due", "penalty_amount", "filing_deadline", "tax_type", "tax_period",
  "expiry_date", "document_number", "holder_name", "bank_beneficiary_name", "bank_name", "bank_account_country", "product_model", "packaging", "warranty"];
const COMPANY = ["legal_name_zh", "legal_name_en", "credit_code", "legal_rep", "reg_capital", "business_scope", "registered_address"];

export function termRows(terms: TermView[], group: "terms" | "company" | "all" = "terms"): TermRowView[] {
  const pick = (k: string) => (group === "all" ? true : group === "company" ? COMPANY.includes(k) : !COMPANY.includes(k));
  const idx = (k: string) => (ORDER.indexOf(k) === -1 ? 999 : ORDER.indexOf(k));
  return terms.filter((t) => pick(t.key)).sort((a, b) => idx(a.key) - idx(b.key) || a.key.localeCompare(b.key)).map((t) => ({
    key: t.key, label: factLabel(t.key), current: factView(t.current), conflicting: t.conflicting.map(factView), history: t.history.map(factView),
  }));
}

export function alertViews(db: DB, alerts: AlertRow[], links: { matterTitle?: (id: string) => string | null; entityName?: (id: string) => string | null } = {}): AlertView[] {
  return alerts.map((a) => {
    const ids = JSON.parse(a.evidence_fact_ids || "[]") as number[];
    const ev = ids.length ? (db.prepare(`SELECT * FROM facts WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as FactRow[]) : [];
    return {
      id: a.id, severity: a.severity, code: a.code, title: a.title, detail: a.detail, evidence: ev.map((e) => ({ ...factView(e), label: factLabel(e.key) })),
      context: a.matter_id ? { href: `/matters/${a.matter_id}`, label: links.matterTitle?.(a.matter_id) ?? null } : a.entity_id ? { href: `/contacts/${a.entity_id}`, label: links.entityName?.(a.entity_id) ?? null } : null,
    };
  });
}

export function taskViews(tasks: (TaskRow & { entity_label?: string | null; matter_title?: string | null })[]): TaskView[] {
  return tasks.map((t) => ({ id: t.id, what: t.what, due: t.due_at, kind: t.kind, who: t.who, status: t.status, context: t.matter_title ?? t.entity_label ?? null, href: t.matter_id ? `/matters/${t.matter_id}` : t.entity_id ? `/contacts/${t.entity_id}` : null }));
}
