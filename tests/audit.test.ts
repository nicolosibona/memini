import { beforeEach, describe, expect, it } from "vitest";
import { openDb, DEMO_WORKSPACE, addDays, today, type DB } from "@/lib/db";
import { createEntity } from "@/lib/core/entities";
import { createMatter } from "@/lib/core/matters";
import { addFacts, currentTerms, quoteAppears, type CandidateFact } from "@/lib/core/facts";
import { computeAlerts, loadAuditInput, runAudit, openAlerts } from "@/lib/core/audit";
import { addTask, ensureRecurring, listTasks, deriveDocumentTasks } from "@/lib/core/tasks";

const ws = DEMO_WORKSPACE;
let db: DB, sup: string, mat: string;
const ctx = () => ({ workspaceId: ws, entityId: sup, matterId: mat });
const SRC = "亲，1000个的话每个4.2美金，FOB深圳，交期15天左右。";
const chat = (key: CandidateFact["key"], value: CandidateFact["value"], quote: string, at = "2026-11-18T10:00:00Z", msg = "m1"): CandidateFact => ({ key, value, said_by: "counterparty", source_type: "voice", quote_original: quote, stated_at: at, source_message_id: msg });
const doc = (key: CandidateFact["key"], value: CandidateFact["value"], docType: CandidateFact["source_doc_type"] = "proforma_invoice", at = "2026-11-19T10:00:00Z"): CandidateFact => ({ key, value, said_by: "document", source_type: "document", source_doc_type: docType, stated_at: at, source_document_id: "d1" });
const codes = async () => computeAlerts(await loadAuditInput(db, ws)).map((a) => a.code);

beforeEach(() => {
  db = openDb(":memory:");
  sup = createEntity(db, ws, { kind: "supplier", display_name: "Shenzhen ABC Tech", legal_name_zh: "深圳市ABC科技有限公司" }).id;
  mat = createMatter(db, ws, { kind: "purchase", entityId: sup, subject: "65W charger" }).id;
});

describe("facts", () => {
  it("quote check", () => {
    expect(quoteAppears("每个4.2美金", SRC)).toBe(true);
    expect(quoteAppears("每个3.9美金含运费", SRC)).toBe(false);
  });
  it("discards invented quotes", () => {
    expect(addFacts(db, ctx(), [chat("unit_price", { amount: 3.9, currency: "USD" }, "每个3.9美金含运费")], SRC).discarded).toHaveLength(1);
  });
  it("conversation → conversation supersedes; document vs conversation keeps both", () => {
    addFacts(db, ctx(), [chat("unit_price", { amount: 4.5, currency: "USD" }, "4.5美金", "2026-11-10T10:00:00Z", "m0")]);
    addFacts(db, ctx(), [chat("unit_price", { amount: 4.2, currency: "USD" }, "每个4.2美金")], SRC);
    addFacts(db, ctx(), [doc("unit_price", { amount: 4.4, currency: "USD" })]);
    const t = currentTerms(db, { matterId: mat }).find((x) => x.key === "unit_price")!;
    expect(t.history.map((h) => h.status)).toEqual(["superseded"]);
    expect(t.conflicting).toHaveLength(1);
  });
});

describe("audit — commerce", () => {
  it("catches the two sourcing traps, idempotently", async () => {
    addFacts(db, ctx(), [chat("incoterm", { value: "FOB" }, "FOB深圳"), chat("port", { value: "Shenzhen" }, "FOB深圳"), chat("unit_price", { amount: 4.2, currency: "USD" }, "每个4.2美金")], SRC);
    addFacts(db, ctx(), [doc("incoterm", { value: "EXW" }), doc("unit_price", { amount: 4.2, currency: "USD" }), doc("bank_beneficiary_name", { value: "深圳市鑫达贸易有限公司" })]);
    const created = await runAudit(db, ws);
    expect(created.map((a) => a.code).sort()).toEqual(["BENEFICIARY_MISMATCH", "INCOTERM_CHANGED"]);
    expect(created.every((a) => a.matter_id === mat)).toBe(true);
    expect(await runAudit(db, ws)).toHaveLength(0);
  });
  it("price tolerance 0.5%, higher deposit, longer lead time, new fee, personal and offshore accounts", async () => {
    db.prepare(`UPDATE entities SET credit_code = '91440300MA5G7K2C4D' WHERE id = ?`).run(sup);
    addFacts(db, ctx(), [chat("unit_price", { amount: 4.2, currency: "USD" }, "每个4.2美金"), chat("lead_time_days", { value: 15 }, "交期15天"), chat("deposit_pct", { value: 30 }, "1000个")], SRC);
    addFacts(db, ctx(), [doc("unit_price", { amount: 4.21, currency: "USD" }), doc("lead_time_days", { value: 25 }), doc("deposit_pct", { value: 50 }), doc("tooling_fee", { amount: 300, currency: "USD" }), doc("bank_beneficiary_name", { value: "陈丽" }), doc("bank_account_country", { value: "Hong Kong" })]);
    const c = await codes();
    expect(c).not.toContain("PRICE_CHANGED");
    expect(c).toEqual(expect.arrayContaining(["LEAD_TIME_CHANGED", "PAYMENT_TERMS_CHANGED", "NEW_FEE", "PERSONAL_ACCOUNT", "OFFSHORE_ACCOUNT"]));
  });
  it("invalid credit code, revoked company, trading-only scope", async () => {
    addFacts(db, ctx(), [doc("credit_code", { value: "91440300MA5G7K2C4A" }, "business_license"), doc("business_scope", { value: "国内贸易；电子产品销售。" }, "business_license")]);
    db.prepare(`UPDATE entities SET credit_code = '91441900MA4U6E1B9U' WHERE id = ?`).run(sup);
    expect(await codes()).toEqual(expect.arrayContaining(["CREDIT_CODE_INVALID", "REGISTRY_INACTIVE", "SCOPE_MISMATCH"]));
  });
});

describe("audit — China business", () => {
  it("lease: rent and deposit differ from chat, rent paid to a person", async () => {
    const landlord = createEntity(db, ws, { kind: "landlord", display_name: "Jing'an Property", legal_name_zh: "上海静安置业有限公司" }).id;
    const lease = createMatter(db, ws, { kind: "lease", entityId: landlord, subject: "Office" }).id;
    const c = { workspaceId: ws, entityId: landlord, matterId: lease };
    addFacts(db, c, [chat("rent_amount", { amount: 18000, currency: "CNY" }, "房租每月18000元"), chat("security_deposit", { amount: 36000, currency: "CNY" }, "押金36000元")], "房租每月18000元，押金36000元");
    addFacts(db, c, [doc("rent_amount", { amount: 19500, currency: "CNY" }, "lease_contract"), doc("security_deposit", { amount: 39000, currency: "CNY" }, "lease_contract"), doc("bank_beneficiary_name", { value: "王芳" }, "lease_contract")]);
    const created = await runAudit(db, ws);
    expect(created.filter((a) => a.code === "AMOUNT_CHANGED")).toHaveLength(2);
    expect(created.map((a) => a.code)).toContain("PERSONAL_ACCOUNT");
  });
  it("documents expire: renewal task + expiring alert; required documents missing near the deadline", async () => {
    const me = createEntity(db, ws, { kind: "self_person", display_name: "Alex Morgan" }).id;
    const exp = addDays(today(), 20);
    const permit = createMatter(db, ws, { kind: "residence_permit", entityId: me, subject: "Alex Morgan", targetDate: exp });
    db.prepare(`INSERT INTO documents (id, workspace_id, entity_id, matter_id, doc_type, title, expires_at, created_at) VALUES ('dp', ?, ?, ?, 'residence_permit', 'Residence permit', ?, ?)`).run(ws, me, permit.id, exp, today());
    deriveDocumentTasks(db, { workspaceId: ws, entityId: me, matterId: permit.id, documentId: "dp" }, { doc_type: "residence_permit", title: "Residence permit", expires_at: exp });
    const tasks = listTasks(db, ws, { matterId: permit.id });
    expect(tasks[0].kind).toBe("renewal");
    expect(tasks[0].due_at).toBe(addDays(exp, -45)); // 45 days' notice → already overdue
    expect(await codes()).toEqual(expect.arrayContaining(["DOC_EXPIRING", "DEADLINE_OVERDUE", "MISSING_DOCUMENT"]));
  });
  it("deadlines: due today isn't late; yesterday's promise is; my deadline in 5 days is 'soon'", async () => {
    addTask(db, ctx(), { kind: "promise", who: "counterparty", what: "Ship the sample", due: today() });
    expect(await codes()).not.toContain("COMMITMENT_LATE");
    addTask(db, ctx(), { kind: "promise", who: "counterparty", what: "Send license", due: addDays(today(), -1) });
    addTask(db, ctx(), { kind: "deadline", who: "authority", what: "File VAT", due: addDays(today(), 5) });
    expect(await codes()).toEqual(expect.arrayContaining(["COMMITMENT_LATE", "DEADLINE_SOON"]));
  });
  it("recurring rent: next payment created once", () => {
    const landlord = createEntity(db, ws, { kind: "landlord", display_name: "L" }).id;
    const lease = createMatter(db, ws, { kind: "lease", entityId: landlord, subject: "Flat" }).id;
    addFacts(db, { workspaceId: ws, entityId: landlord, matterId: lease }, [doc("rent_due_day", { value: 5 }, "lease_contract"), doc("rent_amount", { amount: 9000, currency: "CNY" }, "lease_contract")]);
    ensureRecurring(db, ws);
    expect(listTasks(db, ws, { matterId: lease })).toHaveLength(0); // no lease signed yet → no rent reminder
    addFacts(db, { workspaceId: ws, entityId: landlord, matterId: lease }, [doc("lease_start", { value: "2026-12-01" }, "lease_contract")]);
    ensureRecurring(db, ws);
    ensureRecurring(db, ws);
    const t = listTasks(db, ws, { matterId: lease });
    expect(t).toHaveLength(1);
    expect(t[0].what).toContain("CNY 9,000");
    expect(t[0].due_at!.slice(8)).toBe("05");
  });
  it("a dismissed alert never comes back", async () => {
    addFacts(db, ctx(), [doc("bank_beneficiary_name", { value: "深圳市鑫达贸易有限公司" })]);
    await runAudit(db, ws);
    const [a] = openAlerts(db, { workspaceId: ws });
    db.prepare(`UPDATE alerts SET status = 'dismissed' WHERE id = ?`).run(a.id);
    await runAudit(db, ws);
    expect(openAlerts(db, { workspaceId: ws })).toHaveLength(0);
  });
});

describe("dates follow China time", async () => {
  const { heuristicTextExtraction } = await import("@/lib/core/extract");
  const msg = "样品我们尽量这周五前寄出";
  it("Friday 11:00 in Shanghai → this Friday is today", () => {
    expect(heuristicTextExtraction(msg, "2026-11-20T03:00:00Z").tasks[0].due).toBe("2026-11-20");
  });
  it("Saturday 07:00 in Shanghai (still Friday in UTC) → next Friday", () => {
    expect(heuristicTextExtraction(msg, "2026-11-20T23:00:00Z").tasks[0].due).toBe("2026-11-27");
  });
});
