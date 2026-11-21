// Demo data (blueprint §14.3, extended). All companies and people are fictional. Dates are relative to today so the
// demo never goes stale. resetDemo(db, { profile }) wipes the workspace and recreates what that profile needs:
//   sourcing:        Seller 1 – Shenzhen ABC (earlier chat, USD 4.50) · Seller 2 – Ningbo XYZ (USD 3.95, no license, late promise)
//                    — both quoting the SAME product, so they are comparable
//   china_business:  the above + your company, you (residence permit expiring), the Jing'an tax office + your accountant
//                    (tax matter), the landlord (lease being negotiated: rent CNY 18,000 agreed in chat)
import { DEMO_USER, DEMO_WORKSPACE, addDays, newId, nowIso, today, type DB } from "@/lib/db";
import { addFacts, makeValue, type CandidateFact } from "@/lib/core/facts";
import { createEntity, learnAliases } from "@/lib/core/entities";
import { createMatter } from "@/lib/core/matters";
import { addTask, deriveDocumentTasks, ensureRecurring } from "@/lib/core/tasks";
import { runAudit } from "@/lib/core/audit";
import { indexText } from "@/lib/core/memory";
import type { FactKey, ProfileKey } from "@/lib/core/domain";

const DATA_TABLES = ["entities", "entity_aliases", "contacts", "matters", "messages", "documents", "facts", "tasks", "alerts", "pending_groups", "search_index", "llm_calls", "outreach_recipients", "outreach_campaigns"];
const ws = DEMO_WORKSPACE;
const daysAgo = (n: number, hour = 9) => `${addDays(today(), -n)}T${String(hour).padStart(2, "0")}:00:00.000Z`;

export async function resetDemo(db: DB, opts: { empty?: boolean; profile?: ProfileKey } = {}) {
  const profile = opts.profile ?? ((db.prepare(`SELECT profile FROM workspaces WHERE id = ?`).get(ws) as { profile: ProfileKey } | undefined)?.profile ?? "china_business");
  db.transaction(() => { for (const t of DATA_TABLES) db.prepare(`DELETE FROM ${t}`).run(); })();
  db.prepare(`UPDATE workspaces SET profile = ? WHERE id = ?`).run(profile, ws);
  if (opts.empty) return null;

  // a forwarded chat that was filed earlier: raw message + facts with quotes + nickname learning
  const chat = (entityId: string, matterId: string, at: string, author: string, text: string, translation: string, facts: [FactKey, number | string, string, string?][]) => {
    const id = newId("msg");
    db.prepare(`INSERT INTO messages (id, workspace_id, user_id, channel, group_id, direction, kind, intent, original_author, text_original, text_translated, entity_id, matter_id, status, received_at, extracted_json) VALUES (?,?,?,?,?, 'in', 'merged', 'content', ?,?,?,?,?, 'assigned', ?, ?)`)
      .run(id, ws, DEMO_USER, "sim", newId("grp"), author, text, translation, entityId, matterId, at, JSON.stringify({ chat_title: `Chat with ${author}` }));
    indexText(db, { type: "message", id, workspaceId: ws, entityId, matterId }, `${text}\n${translation}`);
    const cands: CandidateFact[] = facts.map(([key, v, quote, currency]) => ({
      key, value: makeValue(key, typeof v === "number" ? { number: v, currency } : { text: v })!, said_by: "counterparty", source_type: "chat", source_message_id: id, quote_original: quote, stated_at: at,
    }));
    addFacts(db, { workspaceId: ws, entityId, matterId }, cands, text);
    if (!db.prepare(`SELECT 1 FROM contacts WHERE entity_id = ? AND wechat_nickname = ?`).get(entityId, author))
      db.prepare(`INSERT INTO contacts (id, entity_id, name, role, wechat_nickname) VALUES (?,?,?,?,?)`).run(newId("ct"), entityId, author.split(/[\s🌸|：:]/)[0], null, author);
    learnAliases(db, entityId, [{ kind: "wechat_nickname", value: author, strong: false }, { kind: "chat_title", value: `Chat with ${author}`, strong: false }], "user_choice");
    return id;
  };

  // ── sourcing: two suppliers quoting the same charger ──
  const s1 = createEntity(db, ws, { kind: "supplier", display_name: "Shenzhen ABC Tech", legal_name_zh: "深圳市ABC科技有限公司", legal_name_en: "Shenzhen ABC Technology Co., Ltd." });
  const s2 = createEntity(db, ws, { kind: "supplier", display_name: "Ningbo XYZ", legal_name_zh: "宁波XYZ电子有限公司", legal_name_en: "Ningbo XYZ Electronics Co., Ltd." });
  const p1 = createMatter(db, ws, { kind: "purchase", entityId: s1.id, subject: "65W USB-C charger" });
  const p2 = createMatter(db, ws, { kind: "purchase", entityId: s2.id, subject: "65W USB-C charger" });
  chat(s1.id, p1.id, daysAgo(11, 3), "Lisa 🌸 Sales", "您好，我们的65W氮化镓充电器CC-65W，起订量500个，单价4.5美金，交期15天。",
    "Hello, our 65W GaN charger CC-65W: MOQ 500 pcs, unit price USD 4.50, lead time 15 days.",
    [["product_model", "CC-65W", "CC-65W"], ["moq", 500, "起订量500个"], ["unit_price", 4.5, "单价4.5美金", "USD"], ["lead_time_days", 15, "交期15天"]]);
  const m2 = chat(s2.id, p2.id, daysAgo(9, 6), "Kevin 王 | XYZ",
    "老板好！CC-65W同款，1000个的话3.95美金一个，FOB宁波，交期25天，起订量1000个。定金30%，尾款见提单复印件付清。营业执照下周一发您。",
    "Hi boss! Same model as CC-65W: USD 3.95 each for 1,000 units, FOB Ningbo, lead time 25 days, MOQ 1,000. 30% deposit, balance against copy of B/L. I'll send you the business license next Monday.",
    [["unit_price", 3.95, "1000个的话3.95美金一个", "USD"], ["order_qty", 1000, "1000个"], ["incoterm", "FOB", "FOB宁波"], ["port", "Ningbo", "FOB宁波"],
     ["lead_time_days", 25, "交期25天"], ["moq", 1000, "起订量1000个"], ["deposit_pct", 30, "定金30%"], ["payment_terms", "30% deposit, balance against copy of B/L", "定金30%，尾款见提单复印件付清"], ["product_model", "CC-65W", "CC-65W"]]);
  addTask(db, { workspaceId: ws, entityId: s2.id, matterId: p2.id, messageId: m2 }, { kind: "promise", who: "counterparty", what: "Send the business license", due: addDays(today(), -4) });

  if (profile === "china_business") {
    // ── you and your company ──
    const me = createEntity(db, ws, { kind: "self_person", display_name: "Alex Morgan", id_number: "P7781234" });
    createEntity(db, ws, { kind: "self_company", display_name: "Nordlys Trading (Shanghai)", legal_name_zh: "诺德利斯（上海）贸易有限公司", legal_name_en: "Nordlys Trading (Shanghai) Co., Ltd.", credit_code: "91310106MA7HX2QT3D" });
    const permit = createMatter(db, ws, { kind: "residence_permit", entityId: me.id, entityName: "Alex Morgan", subject: "Alex Morgan" });
    const expires = addDays(today(), 52);
    for (const [doc_type, title, exp] of [["residence_permit", "Residence permit – Alex Morgan", expires], ["passport", "Passport – Alex Morgan", addDays(today(), 900)], ["work_permit", "Work permit – Alex Morgan", expires]] as const) {
      const id = newId("doc");
      db.prepare(`INSERT INTO documents (id, workspace_id, message_id, entity_id, matter_id, doc_type, title, extracted_json, doc_date, expires_at, file_path, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, ws, null, me.id, permit.id, doc_type, title, JSON.stringify({ title, summary: "Added earlier (no file in the demo)." }), addDays(today(), -313), exp, null, daysAgo(60));
      addFacts(db, { workspaceId: ws, entityId: me.id, matterId: permit.id }, [{ key: "expiry_date", value: { value: exp }, said_by: "document", source_type: "document", source_doc_type: doc_type, source_document_id: id, quote_original: exp, stated_at: daysAgo(60) }]);
      deriveDocumentTasks(db, { workspaceId: ws, entityId: me.id, matterId: permit.id, documentId: id }, { doc_type, title, expires_at: exp });
    }
    db.prepare(`UPDATE matters SET target_date = ? WHERE id = ?`).run(expires, permit.id);

    // ── tax: the tax office + your accountant ──
    const taxOffice = createEntity(db, ws, { kind: "government", display_name: "Jing'an Tax Bureau", legal_name_zh: "国家税务总局上海市静安区税务局", legal_name_en: "Shanghai Jing'an District Tax Bureau" });
    const accountant = createEntity(db, ws, { kind: "service_provider", display_name: "Huiyuan Accounting", legal_name_zh: "上海汇远财务咨询有限公司" });
    const tax = createMatter(db, ws, { kind: "tax", entityId: accountant.id, title: "Tax & accounting" });
    chat(accountant.id, tax.id, daysAgo(5, 2), "Amy 汇远财务", "Alex您好，11月的发票请在本月25号前发给我，我这边做账。", "Hi Alex, please send me November's fapiao before the 25th so I can do the books.", []);
    addTask(db, { workspaceId: ws, entityId: accountant.id, matterId: tax.id }, { kind: "deadline", who: "me", what: "Send November fapiao to the accountant", due: `${today().slice(0, 7)}-25` < today() ? addDays(today(), 3) : `${today().slice(0, 7)}-25` });
    void taxOffice;

    // ── lease being negotiated: what the agent said in chat ──
    const landlord = createEntity(db, ws, { kind: "landlord", display_name: "Jing'an Property", legal_name_zh: "上海静安置业有限公司", legal_name_en: "Shanghai Jing'an Property Co., Ltd." });
    const lease = createMatter(db, ws, { kind: "lease", entityId: landlord.id, subject: "Office, Room 1203", title: "Office lease – Room 1203" });
    chat(landlord.id, lease.id, daysAgo(6, 7), "周先生 静安置业", "房租每月18000元，押二付一，押金36000元，每月5号前付租金。",
      "Rent is CNY 18,000 per month, two months' deposit plus one month in advance; the deposit is CNY 36,000; rent due before the 5th each month.",
      [["rent_amount", 18000, "房租每月18000元", "CNY"], ["security_deposit", 36000, "押金36000元", "CNY"], ["rent_due_day", 5, "每月5号前付租金"]]);
  }

  db.prepare(`UPDATE entities SET last_activity_at = ? WHERE id = ?`).run(daysAgo(9), s2.id);
  db.prepare(`UPDATE entities SET last_activity_at = ? WHERE id = ?`).run(nowIso(), s1.id); // last one you talked to → first in menus
  ensureRecurring(db, ws);
  await runAudit(db, ws);
  return { s1, s2 };
}

/** Seed on first run so the app is never empty. */
export async function ensureSeeded(db: DB) {
  if (db.prepare(`SELECT 1 FROM wecom_state WHERE k = 'demo_seeded_v2'`).get()) return;
  if (!(db.prepare(`SELECT COUNT(*) AS n FROM entities WHERE workspace_id = ?`).get(ws) as { n: number }).n) await resetDemo(db);
  db.prepare(`INSERT OR REPLACE INTO wecom_state (k, v) VALUES ('demo_seeded_v2', '1')`).run();
}
