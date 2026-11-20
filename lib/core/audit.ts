// Audit engine (blueprint §7, generalized). Deterministic, pure computeAlerts() + runAudit() that persists them.
// Rule families:
//   1. document vs conversation, per matter — any fact key with a `compare` rule in domain.ts (price, Incoterm, rent, salary…)
//   2. payee checks, per matter — beneficiary vs the counterparty's legal name, personal / offshore accounts
//   3. counterparty identity — credit code, registry status/name, business scope, seller vs license, certificates
//   4. documents — expired / expiring (lead time per document type)
//   5. matters — required documents missing when a deadline approaches
//   6. tasks — overdue promises and deadlines, deadlines coming up
import type { DB } from "@/lib/db";
import { addDays, nowIso, today } from "@/lib/db";
import { lookupRegistry, ACTIVE_STATUSES, type RegistryRecord } from "@/lib/adapters/registry";
import { checkCreditCode, looksLikePerson, nameSimilarity } from "./normalize";
import { formatValue, fmtDay, isConversationSource, isDocumentSource, parseValue, sameValue, sourceKind, sourceLabel, sourcePhrase, factLabel, type FactRow } from "./facts";
import { DOC_TYPES, FACT_DEFS, MATTER_KINDS, SELF_KINDS, type DocType, type EntityKind, type FactKey, type MatterKind } from "./domain";
import type { DocumentExtraction } from "./schemas";

export type Severity = "red" | "amber" | "info";
export type AlertCandidate = {
  code: string; severity: Severity; title: string; detail: string; evidence_fact_ids: number[];
  entity_id: string | null; matter_id: string | null; dedupe_key: string;
};
export type AlertRow = Omit<AlertCandidate, "evidence_fact_ids"> & { id: number; workspace_id: string; evidence_fact_ids: string; status: "open" | "resolved" | "dismissed" | "acknowledged"; created_at: string; resolved_at: string | null };

type EntityIn = { id: string; kind: EntityKind; display_name: string; legal_name_zh: string | null; legal_name_en: string | null; credit_code: string | null; registry: RegistryRecord | null };
type MatterIn = { id: string; kind: MatterKind; title: string; entity_id: string | null; target_date: string | null; checklist: { label: string; required: boolean; done: boolean }[] };
type DocIn = { id: string; doc_type: DocType; title: string; entity_id: string | null; matter_id: string | null; expires_at: string | null; extracted: DocumentExtraction | null };
type TaskIn = { id: number; kind: string; who: string; what: string; due_at: string | null; status: string; entity_id: string | null; matter_id: string | null };
export type AuditInput = { today: string; facts: FactRow[]; entities: EntityIn[]; matters: MatterIn[]; documents: DocIn[]; tasks: TaskIn[] };

const conv = (f: FactRow) => isConversationSource(f.source_type) || f.said_by === "user_report";
const docf = (f: FactRow) => isDocumentSource(f.source_type) && f.source_type !== "registry";
const latest = (facts: FactRow[], key: FactKey, pred: (f: FactRow) => boolean) =>
  facts.filter((f) => f.key === key && pred(f)).sort((a, b) => (a.stated_at < b.stated_at ? 1 : a.stated_at > b.stated_at ? -1 : b.id - a.id))[0];
const val = (f: FactRow) => parseValue(f.value_json);
const fmt = (f: FactRow) => formatValue(f.key, val(f));
const str = (f: FactRow | undefined) => (f ? String((val(f) as { value: unknown }).value ?? "") : "");
const num = (f: FactRow) => { const v = val(f); return "amount" in v ? v.amount : Number((v as { value: unknown }).value); };
const docName = (f: FactRow) => sourceKind(f);

export function computeAlerts(input: AuditInput): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const push = (a: Omit<AlertCandidate, "dedupe_key"> & { dedupe_key?: string }) =>
    out.push({ ...a, dedupe_key: a.dedupe_key ?? (a.evidence_fact_ids.length ? `${a.code}:${[...a.evidence_fact_ids].sort((x, y) => x - y).join(",")}` : `${a.code}:${a.matter_id ?? a.entity_id}:${a.title}`) });
  const entity = new Map(input.entities.map((e) => [e.id, e]));
  const matter = new Map(input.matters.map((m) => [m.id, m]));

  // scopes = matters (+ loose facts per entity)
  const scopes = new Map<string, FactRow[]>();
  for (const f of input.facts) {
    const k = f.matter_id ? `m:${f.matter_id}` : f.entity_id ? `e:${f.entity_id}` : null;
    if (k) scopes.set(k, [...(scopes.get(k) ?? []), f]);
  }

  // license names per entity (from any matter), for payee/seller/holder checks
  const licenseNames = (entityId: string | null) => {
    if (!entityId) return [] as string[];
    const e = entity.get(entityId);
    const lic = input.facts.filter((f) => f.entity_id === entityId && f.source_doc_type === "business_license" && (f.key === "legal_name_zh" || f.key === "legal_name_en")).map(str);
    return [...new Set([...lic, e?.legal_name_zh, e?.legal_name_en].filter(Boolean) as string[])];
  };
  const isMatch = (names: string[], n: string) => names.some((x) => nameSimilarity(x, n) >= 0.9);

  for (const [scopeKey, facts] of scopes) {
    const matterId = scopeKey.startsWith("m:") ? scopeKey.slice(2) : null;
    const m = matterId ? matter.get(matterId) : undefined;
    const entityId = m?.entity_id ?? facts[0]?.entity_id ?? null;
    const base = { entity_id: entityId, matter_id: matterId };

    // 1. document vs conversation for every comparable key
    for (const [key, def] of Object.entries(FACT_DEFS) as [FactKey, (typeof FACT_DEFS)[FactKey]][]) {
      if (!("compare" in def)) continue;
      const c = latest(facts, key, conv), d = latest(facts, key, docf);
      if (!c || !d) continue;
      const cmp = def.compare as { code: string; severity: Severity; when?: "differs" | "higher" | "longer" };
      const differs = !sameValue(key, val(c), val(d));
      const bad = cmp.when === "higher" || cmp.when === "longer" ? num(d) > num(c) : differs;
      if (!bad) continue;
      const port = key === "incoterm" ? latest(facts, "port", conv) : undefined;
      const title =
        key === "incoterm" ? `Incoterm changed: ${fmt(d)} on the ${docName(d)}, but ${sourcePhrase(c)} said ${fmt(c)}${port ? ` ${fmt(port)}` : ""}.`
        : key === "lead_time_days" ? `Longer lead time: ${fmt(d)} on the ${docName(d)} vs ${fmt(c)} promised in ${sourcePhrase(c)}.`
        : key === "deposit_pct" ? `Higher deposit: ${fmt(d)} on the ${docName(d)} vs ${fmt(c)} agreed in ${sourcePhrase(c)}.`
        : `${factLabel(key)} changed: ${fmt(d)} on the ${docName(d)} vs ${fmt(c)} in ${sourcePhrase(c)}.`;
      const detail = key === "incoterm" ? "A different Incoterm moves freight and export costs onto you. Ask for a corrected document before paying."
        : cmp.severity === "red" ? "The document must match what was agreed. Ask for a corrected version before signing or paying." : "";
      push({ ...base, code: cmp.code, severity: cmp.severity, title, detail, evidence_fact_ids: [c.id, d.id] });
    }
    // fees that appear only on a document
    for (const key of ["tooling_fee", "sample_fee", "other_fee"] as FactKey[]) {
      const d = latest(facts, key, docf);
      if (d && !facts.some((f) => f.key === key && conv(f)))
        push({ ...base, code: "NEW_FEE", severity: "amber", title: `New fee on the ${docName(d)}: ${fmt(d)} (${factLabel(key).toLowerCase()}), never mentioned in conversation.`, detail: "", evidence_fact_ids: [d.id] });
    }

    // 2. who gets the money
    const ben = latest(facts, "bank_beneficiary_name", () => true);
    const e = entityId ? entity.get(entityId) : undefined;
    if (ben && e && !SELF_KINDS.includes(e.kind)) {
      const name = str(ben);
      const names = licenseNames(entityId);
      if (looksLikePerson(name))
        push({ ...base, code: "PERSONAL_ACCOUNT", severity: "red", title: `Payee "${name}" looks like a private person, not ${e.display_name}.`, detail: "Paying a personal account leaves you no recourse. Ask for the company's corporate account (对公账户).", evidence_fact_ids: [ben.id] });
      else if (names.length && !isMatch(names, name))
        push({ ...base, code: "BENEFICIARY_MISMATCH", severity: "red", title: `Payee (${name}) is NOT the company on the ${licenseNames(entityId).length > (e.legal_name_zh ? 1 : 0) ? "license" : "contract"} (${names[0]}).`, detail: "→ Don't pay until this is cleared up.", evidence_fact_ids: [ben.id] });
    }
    const country = latest(facts, "bank_account_country", () => true);
    if (country && e?.credit_code) {
      const c = str(country).toUpperCase();
      if (c && !["CN", "CHN", "CHINA", "中国", "PRC", "MAINLAND CHINA"].includes(c))
        push({ ...base, code: "OFFSHORE_ACCOUNT", severity: "amber", title: `Bank account in ${str(country)} for a mainland Chinese company.`, detail: "Common for trading companies, but worth a question.", evidence_fact_ids: [country.id] });
    }

    // certificates vs the deal
    const holder = latest(facts, "cert_holder", () => true);
    if (holder && e && licenseNames(entityId).length && !isMatch(licenseNames(entityId), str(holder)))
      push({ ...base, code: "CERT_HOLDER_MISMATCH", severity: "amber", title: `Certificate holder (${str(holder)}) is not ${e.display_name}.`, detail: "Borrowed certificates are common. Ask for one in the supplier's own name.", evidence_fact_ids: [holder.id] });
    const certModels = facts.filter((f) => f.key === "cert_model").map((f) => str(f).toUpperCase().replace(/\s/g, ""));
    const model = latest(facts, "product_model", (f) => f.source_doc_type !== "certificate");
    if (certModels.length && model && !certModels.includes(str(model).toUpperCase().replace(/\s/g, "")))
      push({ ...base, code: "CERT_MODEL_MISMATCH", severity: "amber", title: `Certificate covers ${certModels.join(", ")}, but the model you're buying is ${str(model)}.`, detail: "", evidence_fact_ids: [model.id] });
  }

  // 3. counterparty identity
  for (const e of input.entities) {
    if (SELF_KINDS.includes(e.kind)) continue;
    const ef = input.facts.filter((f) => f.entity_id === e.id);
    const base = { entity_id: e.id, matter_id: null };
    for (const f of ef.filter((x) => x.key === "credit_code")) {
      const chk = checkCreditCode(str(f));
      if (!chk.valid)
        push({ ...base, code: "CREDIT_CODE_INVALID", severity: "red", title: `Credit code ${chk.normalized ?? str(f)} on the ${docName(f)} is not valid (${chk.reason === "check_digit" ? "wrong check digit" : chk.reason}).`, detail: "Either a misread or a forged document. Ask for a clearer copy and verify on gsxt.gov.cn.", evidence_fact_ids: [f.id] });
    }
    if (e.registry) {
      if (!ACTIVE_STATUSES.includes(e.registry.status))
        push({ ...base, code: "REGISTRY_INACTIVE", severity: "red", title: `${e.registry.legal_name_zh} is ${e.registry.status} in the company registry (not active).`, detail: "A revoked or deregistered company cannot legally trade or sign.", evidence_fact_ids: [] });
      const lic = latest(ef, "legal_name_zh", (f) => f.source_doc_type === "business_license");
      if (lic && nameSimilarity(str(lic), e.registry.legal_name_zh) < 0.9)
        push({ ...base, code: "REGISTRY_NAME_MISMATCH", severity: "red", title: `License name ${str(lic)} doesn't match the registry (${e.registry.legal_name_zh}) for the same credit code.`, detail: "Strong sign of an altered license.", evidence_fact_ids: [lic.id] });
    }
    if (e.kind === "supplier") {
      const scope = latest(ef, "business_scope", () => true);
      const text = str(scope) || e.registry?.business_scope || "";
      if (text && !/生产|制造|加工|manufactur|production/i.test(text))
        push({ ...base, code: "SCOPE_MISMATCH", severity: "amber", title: "Business scope doesn't include manufacturing: probably a trading company, not a factory.", detail: text.slice(0, 160), evidence_fact_ids: scope ? [scope.id] : [] });
    }
  }
  // seller on a proforma vs license company
  for (const d of input.documents) {
    const seller = d.extracted?.parties?.find((p) => p.role === "seller");
    if (!seller || !d.entity_id) continue;
    const names = licenseNames(d.entity_id);
    const hasLicense = input.facts.some((f) => f.entity_id === d.entity_id && f.source_doc_type === "business_license");
    if (hasLicense && names.length && !isMatch(names, seller.name) && !(seller.name_alt && isMatch(names, seller.name_alt)))
      push({ entity_id: d.entity_id, matter_id: d.matter_id, code: "SELLER_LICENSE_MISMATCH", severity: "amber", title: `The ${d.title} is issued by ${seller.name}, not by the company on the license (${names[0]}).`, detail: "Possibly a middleman or a mistake.", evidence_fact_ids: [], dedupe_key: `SELLER_LICENSE_MISMATCH:${d.id}` });
  }

  // 4. documents that expire
  for (const d of input.documents) {
    if (!d.expires_at) continue;
    const lead = (DOC_TYPES[d.doc_type] as { expiryLeadDays?: number }).expiryLeadDays ?? 30;
    const exp = d.expires_at.slice(0, 10);
    const base = { entity_id: d.entity_id, matter_id: d.matter_id, evidence_fact_ids: [] as number[] };
    if (exp < input.today) push({ ...base, code: "DOC_EXPIRED", severity: "red", title: `${d.title} expired on ${fmtDay(exp)}.`, detail: "", dedupe_key: `DOC_EXPIRED:${d.id}` });
    else if (addDays(exp, -lead) <= input.today) push({ ...base, code: "DOC_EXPIRING", severity: "amber", title: `${d.title} expires on ${fmtDay(exp)} — act now (${lead} days' notice needed).`, detail: "", dedupe_key: `DOC_EXPIRING:${d.id}` });
  }

  // 5. matters: required documents missing while a deadline is near
  for (const m of input.matters) {
    const missing = m.checklist.filter((c) => c.required && !c.done).map((c) => c.label);
    if (!missing.length) continue;
    // only real deadlines make missing paperwork urgent (not the other side's promises, not routine payments)
    const due = [m.target_date, ...input.tasks.filter((t) => t.matter_id === m.id && t.status === "open" && t.due_at && t.who !== "counterparty" && ["deadline", "renewal", "appointment"].includes(t.kind)).map((t) => t.due_at!)].filter(Boolean).sort()[0];
    if (due && addDays(due.slice(0, 10), -30) <= input.today)
      push({ entity_id: m.entity_id, matter_id: m.id, code: "MISSING_DOCUMENT", severity: "amber", title: `${m.title}: still missing ${missing.join(", ")} (deadline ${fmtDay(due.slice(0, 10))}).`, detail: `Checklist for ${MATTER_KINDS[m.kind]?.label ?? m.kind}.`, evidence_fact_ids: [], dedupe_key: `MISSING_DOCUMENT:${m.id}:${missing.join("|")}` });
  }

  // 6. tasks & deadlines
  for (const t of input.tasks) {
    if (t.status !== "open" || !t.due_at) continue;
    const due = t.due_at.slice(0, 10); // "by Friday" holds until the end of Friday
    const base = { entity_id: t.entity_id, matter_id: t.matter_id, evidence_fact_ids: [] as number[] };
    if (due < input.today) {
      if (t.who === "counterparty") push({ ...base, code: "COMMITMENT_LATE", severity: "amber", title: `Late: ${t.what} (was due ${fmtDay(due)}).`, detail: "", dedupe_key: `LATE:${t.id}` });
      else push({ ...base, code: "DEADLINE_OVERDUE", severity: "red", title: `Overdue: ${t.what} (was due ${fmtDay(due)}).`, detail: t.who === "authority" ? "Late filings usually mean fines. Do it today or ask your agent." : "", dedupe_key: `OVERDUE:${t.id}` });
    } else if (t.who !== "counterparty" && addDays(due, -7) <= input.today) {
      push({ ...base, code: "DEADLINE_SOON", severity: "amber", title: `Due ${due === input.today ? "today" : fmtDay(due)}: ${t.what}.`, detail: "", dedupe_key: `SOON:${t.id}` });
    }
  }
  return out;
}

// ── persistence ──
export async function loadAuditInput(db: DB, workspaceId: string, now = today()): Promise<AuditInput> {
  const { matterChecklist } = await import("./matters");
  const ents = db.prepare(`SELECT id, kind, display_name, legal_name_zh, legal_name_en, credit_code FROM entities WHERE workspace_id = ?`).all(workspaceId) as Omit<EntityIn, "registry">[];
  const entities: EntityIn[] = [];
  for (const e of ents) entities.push({ ...e, registry: e.credit_code ? await lookupRegistry({ creditCode: e.credit_code }) : null });
  const matters = (db.prepare(`SELECT id, kind, title, entity_id, target_date FROM matters WHERE workspace_id = ? AND status IN ('open','waiting')`).all(workspaceId) as Omit<MatterIn, "checklist">[])
    .map((m) => ({ ...m, checklist: matterChecklist(db, m) }));
  const documents = (db.prepare(`SELECT id, doc_type, title, entity_id, matter_id, expires_at, extracted_json FROM documents WHERE workspace_id = ? AND (entity_id IS NOT NULL OR matter_id IS NOT NULL)`).all(workspaceId) as (Omit<DocIn, "extracted"> & { extracted_json: string })[])
    .map(({ extracted_json, ...d }) => ({ ...d, extracted: extracted_json ? (JSON.parse(extracted_json) as DocumentExtraction) : null }));
  return {
    today: now,
    facts: db.prepare(`SELECT * FROM facts WHERE workspace_id = ? AND status NOT IN ('superseded','rejected')`).all(workspaceId) as FactRow[],
    entities, matters, documents,
    tasks: db.prepare(`SELECT id, kind, who, what, due_at, status, entity_id, matter_id FROM tasks WHERE workspace_id = ?`).all(workspaceId) as TaskIn[],
  };
}

/** Recompute all alerts of a workspace; insert new ones, close those whose condition disappeared. Returns the NEW alerts. */
export async function runAudit(db: DB, workspaceId: string): Promise<AlertRow[]> {
  const input = await loadAuditInput(db, workspaceId);
  const candidates = computeAlerts(input);
  const existing = db.prepare(`SELECT * FROM alerts WHERE workspace_id = ? AND code != 'AI_NOTE'`).all(workspaceId) as AlertRow[];
  const byKey = new Map(existing.map((a) => [a.dedupe_key, a]));
  const keys = new Set(candidates.map((c) => c.dedupe_key));
  const now = nowIso();
  const created: AlertRow[] = [];
  db.transaction(() => {
    for (const c of candidates) {
      const ex = byKey.get(c.dedupe_key);
      if (ex) {
        // auto-resolved ('resolved') reopens if the condition comes back; the user's 'dismissed' / 'acknowledged' never do
        if (ex.status === "resolved") db.prepare(`UPDATE alerts SET status = 'open', resolved_at = NULL, severity = ?, title = ? WHERE id = ?`).run(c.severity, c.title, ex.id);
        else if (ex.status === "open" && (ex.title !== c.title || ex.severity !== c.severity)) db.prepare(`UPDATE alerts SET title = ?, severity = ? WHERE id = ?`).run(c.title, c.severity, ex.id);
        continue;
      }
      const info = db.prepare(`INSERT INTO alerts (workspace_id, entity_id, matter_id, severity, code, title, detail, evidence_fact_ids, dedupe_key, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,'open',?)`)
        .run(workspaceId, c.entity_id, c.matter_id, c.severity, c.code, c.title, c.detail, JSON.stringify(c.evidence_fact_ids), c.dedupe_key, now);
      created.push({ ...c, id: Number(info.lastInsertRowid), workspace_id: workspaceId, evidence_fact_ids: JSON.stringify(c.evidence_fact_ids), status: "open", created_at: now, resolved_at: null });
    }
    for (const a of existing) if (a.status === "open" && !keys.has(a.dedupe_key)) db.prepare(`UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?`).run(now, a.id);
  })();
  for (const e of input.entities) if (e.registry) db.prepare(`UPDATE entities SET registry_status = ?, registry_checked_at = ? WHERE id = ?`).run(e.registry.status, now, e.id);
  return created;
}

const SEV = `CASE severity WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END`;
export function openAlerts(db: DB, scope: { workspaceId?: string; entityId?: string; matterId?: string }): AlertRow[] {
  if (scope.matterId) return db.prepare(`SELECT * FROM alerts WHERE matter_id = ? AND status = 'open' ORDER BY ${SEV}, id`).all(scope.matterId) as AlertRow[];
  if (scope.entityId) return db.prepare(`SELECT * FROM alerts WHERE entity_id = ? AND status = 'open' ORDER BY ${SEV}, id`).all(scope.entityId) as AlertRow[];
  return db.prepare(`SELECT * FROM alerts WHERE workspace_id = ? AND status = 'open' ORDER BY ${SEV}, created_at DESC`).all(scope.workspaceId) as AlertRow[];
}

export type Trust = "red" | "amber" | "green" | "grey";
/** Traffic light (D6) for a counterparty or a matter. */
export function trustLight(db: DB, scope: { entityId?: string; matterId?: string }): Trust {
  const alerts = openAlerts(db, scope);
  if (alerts.some((a) => a.severity === "red")) return "red";
  const anyFacts = scope.matterId ? db.prepare(`SELECT 1 FROM facts WHERE matter_id = ? LIMIT 1`).get(scope.matterId) : db.prepare(`SELECT 1 FROM facts WHERE entity_id = ? LIMIT 1`).get(scope.entityId);
  if (!anyFacts && !alerts.length) return "grey";
  if (alerts.length) return "amber";
  if (scope.entityId) {
    const kind = (db.prepare(`SELECT kind FROM entities WHERE id = ?`).get(scope.entityId) as { kind: string } | undefined)?.kind;
    if (kind === "supplier" && !db.prepare(`SELECT 1 FROM documents WHERE entity_id = ? AND doc_type = 'business_license'`).get(scope.entityId)) return "amber";
  }
  return "green";
}

export { sourceLabel };
