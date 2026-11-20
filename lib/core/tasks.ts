// Tasks & deadlines: promises from counterparties, deadlines from authorities, renewals derived from expiry dates,
// recurring payments (rent). Everything with a date lands here, so "what's due" is one query.
import type { DB } from "@/lib/db";
import { addDays, nowIso, today } from "@/lib/db";
import { DOC_TYPES, type DocType, type TaskKind, type TaskWho } from "./domain";
import { parseValue, type FactRow } from "./facts";

export type TaskRow = {
  id: number; workspace_id: string; entity_id: string | null; matter_id: string | null; kind: TaskKind; who: TaskWho; what: string;
  due_at: string | null; source_message_id: string | null; source_document_id: string | null; source_rule: string | null; status: "open" | "done" | "cancelled"; created_at: string;
};
type Ctx = { workspaceId: string; entityId: string | null; matterId: string | null; messageId?: string | null; documentId?: string | null };

export function addTask(db: DB, ctx: Ctx, t: { kind: TaskKind; who: TaskWho; what: string; due: string | null; rule?: string }): number | null {
  if (t.rule && db.prepare(`SELECT 1 FROM tasks WHERE workspace_id = ? AND source_rule = ?`).get(ctx.workspaceId, t.rule)) return null; // derived tasks are created once
  const due = t.due && /^\d{4}-\d{2}-\d{2}/.test(t.due) ? t.due.slice(0, 10) : null;
  return Number(db.prepare(`INSERT INTO tasks (workspace_id, entity_id, matter_id, kind, who, what, due_at, source_message_id, source_document_id, source_rule, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'open', ?)`)
    .run(ctx.workspaceId, ctx.entityId, ctx.matterId, t.kind, t.who, t.what, due, ctx.messageId ?? null, ctx.documentId ?? null, t.rule ?? null, nowIso()).lastInsertRowid);
}

/** A document that expires creates its own renewal reminder, `expiryLeadDays` before (domain.ts). */
export function deriveDocumentTasks(db: DB, ctx: Ctx & { documentId: string }, d: { doc_type: DocType; title: string; expires_at: string | null }) {
  if (!d.expires_at) return;
  const lead = (DOC_TYPES[d.doc_type] as { expiryLeadDays?: number }).expiryLeadDays;
  if (!lead) return;
  const verb = d.doc_type === "lease_contract" ? "Renew or give notice on" : "Renew";
  addTask(db, ctx, { kind: "renewal", who: "me", what: `${verb} ${d.title} (expires ${d.expires_at.slice(0, 10)})`, due: addDays(d.expires_at, -lead), rule: `renewal:${ctx.documentId}` });
}

/** Facts that are really deadlines (filing deadline, appointment) become tasks too. */
export function deriveFactTasks(db: DB, ctx: Ctx, facts: FactRow[]) {
  for (const f of facts) {
    const v = parseValue(f.value_json) as { value: string };
    if (f.key === "filing_deadline") addTask(db, ctx, { kind: "deadline", who: "authority", what: "Filing deadline", due: v.value, rule: `fact:${f.matter_id}:${f.key}:${v.value}` });
    if (f.key === "appointment_date") addTask(db, ctx, { kind: "appointment", who: "me", what: "Appointment", due: v.value, rule: `fact:${f.matter_id}:${f.key}:${v.value}` });
  }
}

/** Recurring obligations: next rent payment for every open lease with a known due day. Idempotent. */
export function ensureRecurring(db: DB, workspaceId: string, now = today()) {
  const leases = db.prepare(`SELECT m.id, m.entity_id, m.title FROM matters m WHERE m.workspace_id = ? AND m.kind = 'lease' AND m.status IN ('open','waiting')`).all(workspaceId) as { id: string; entity_id: string | null; title: string }[];
  for (const l of leases) {
    const day = db.prepare(`SELECT value_json FROM facts WHERE matter_id = ? AND key = 'rent_due_day' AND status NOT IN ('superseded','rejected') ORDER BY stated_at DESC LIMIT 1`).get(l.id) as { value_json: string } | undefined;
    const rent = db.prepare(`SELECT value_json FROM facts WHERE matter_id = ? AND key = 'rent_amount' AND status NOT IN ('superseded','rejected') ORDER BY CASE source_type WHEN 'document' THEN 0 ELSE 1 END, stated_at DESC LIMIT 1`).get(l.id) as { value_json: string } | undefined;
    // rent reminders start once there is a lease (contract on file or a start date), not during negotiation
    const signed = db.prepare(`SELECT 1 FROM documents WHERE matter_id = ? AND doc_type = 'lease_contract' UNION SELECT 1 FROM facts WHERE matter_id = ? AND key = 'lease_start' AND status NOT IN ('superseded','rejected')`).get(l.id, l.id);
    if (!day || !signed) continue;
    const d = Number((parseValue(day.value_json) as { value: number }).value);
    if (!(d >= 1 && d <= 28)) continue;
    const [y, m] = now.split("-").map(Number);
    let due = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (due < now) due = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const amount = rent ? (parseValue(rent.value_json) as { amount: number; currency: string }) : null;
    const what = `Pay rent${amount ? ` (${amount.currency} ${amount.amount.toLocaleString("en-US")})` : ""} – ${l.title}`;
    const rule = `rent:${l.id}:${due.slice(0, 7)}`;
    // the amount follows the latest contract: refresh the open reminder instead of keeping a stale figure
    if (addTask(db, { workspaceId, entityId: l.entity_id, matterId: l.id }, { kind: "payment", who: "me", what, due, rule }) === null)
      db.prepare(`UPDATE tasks SET what = ? WHERE workspace_id = ? AND source_rule = ? AND status = 'open'`).run(what, workspaceId, rule);
  }
}

export function listTasks(db: DB, workspaceId: string, opts: { status?: string; entityId?: string; matterId?: string; withinDays?: number } = {}) {
  const where = ["t.workspace_id = ?"], args: unknown[] = [workspaceId];
  if (opts.status) { where.push("t.status = ?"); args.push(opts.status); }
  if (opts.entityId) { where.push("t.entity_id = ?"); args.push(opts.entityId); }
  if (opts.matterId) { where.push("t.matter_id = ?"); args.push(opts.matterId); }
  if (opts.withinDays != null) { where.push("t.due_at IS NOT NULL AND t.due_at <= ?"); args.push(addDays(today(), opts.withinDays)); }
  return db.prepare(
    `SELECT t.*, e.label AS entity_label, e.display_name AS entity_name, m.title AS matter_title, m.kind AS matter_kind FROM tasks t
     LEFT JOIN entities e ON e.id = t.entity_id LEFT JOIN matters m ON m.id = t.matter_id
     WHERE ${where.join(" AND ")} ORDER BY t.due_at IS NULL, t.due_at, t.id`,
  ).all(...args) as (TaskRow & { entity_label: string | null; entity_name: string | null; matter_title: string | null; matter_kind: string | null })[];
}
