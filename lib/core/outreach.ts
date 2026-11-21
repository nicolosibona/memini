// Automated "First Contact" (RFQ Outreach & Auto-Filtering) — core data model, Chinese inquiry generator,
// deterministic auto-filter, ingestion pipeline bridge, and hackathon simulation helper.
import type { DB } from "@/lib/db";
import { DEMO_USER, DEMO_WORKSPACE, newId, nowIso } from "@/lib/db";
import { callJSON } from "@/lib/adapters/llm";
import { z } from "zod";
import { createEntity, entityLabel, getEntity, listEntities, type EntityLite } from "./entities";
import { createMatter, getMatter, listMatters, subjectKey, type MatterRow } from "./matters";
import { handleIncoming, storeFile } from "./ingest";
import { openAlerts, runAudit, type AlertRow } from "./audit";
import { addFacts, makeValue, type CandidateFact } from "./facts";
import { appUrl } from "./links";

export type OutreachStatus = "pending" | "sent" | "no_reply" | "filtered_out" | "shortlisted";

export type SubmittedQuote = {
  unitPrice: number;
  currency: string;
  moq: number;
  leadTimeDays: number;
  incoterm: string;
  port?: string | null;
  paymentTerms?: string | null;
  beneficiaryName?: string | null;
  notes?: string | null;
  submittedAt: string;
};

export type OutreachRecipient = {
  id: string;
  campaignId: string;
  contactId: string;
  contactName: string;
  contactLabel: string;
  legalNameZh: string | null;
  token: string;
  status: OutreachStatus;
  chineseMessage: string;
  filterReason?: string;
  quoteDocumentId?: string;
  supplierMatterId?: string;
  submittedQuote?: SubmittedQuote | null;
  respondedAt?: string | null;
};

export type OutreachCampaign = {
  id: string;
  workspaceId: string;
  matterId: string;
  productTitle: string;
  targetPrice: number;
  currency: string;
  targetQuantity: number;
  preferredIncoterm: string;
  maxLeadTimeDays: number;
  deadline?: string | null;
  recipients: OutreachRecipient[];
  createdAt: string;
  updatedAt: string;
};

export type CreateCampaignInput = {
  workspaceId?: string;
  matterId: string;
  targetPrice: number;
  currency?: string;
  targetQuantity: number;
  preferredIncoterm?: string;
  maxLeadTimeDays?: number;
  deadline?: string | null;
  contactIds: string[];
};

export type SupplierSubmission = {
  unitPrice: number;
  currency?: string;
  moq: number;
  leadTimeDays: number;
  incoterm: string;
  port?: string | null;
  paymentTerms?: string | null;
  beneficiaryName?: string | null;
  notes?: string | null;
};

export type AutoFilterInput = {
  targetPrice: number;
  targetCurrency?: string;
  targetQuantity: number;
  unitPrice: number;
  quoteCurrency?: string;
  moq: number;
  alerts?: Pick<AlertRow, "severity" | "code" | "title">[];
};

export type AutoFilterResult = {
  status: "filtered_out" | "shortlisted";
  filterReason?: string;
  reasons: string[];
};

const USD_TO_CNY = 7.2;

export function normalizeCurrency(c?: string | null): "USD" | "CNY" {
  const up = (c ?? "USD").trim().toUpperCase();
  if (up === "RMB" || up === "CNY" || up === "元" || up === "人民币") return "CNY";
  return "USD";
}

/** Convert quote amount into campaign target currency for apples-to-apples budget check. */
export function convertCurrency(amount: number, from?: string | null, to?: string | null): number {
  const f = normalizeCurrency(from);
  const t = normalizeCurrency(to);
  if (f === t) return amount;
  if (f === "CNY" && t === "USD") return amount / USD_TO_CNY;
  if (f === "USD" && t === "CNY") return amount * USD_TO_CNY;
  return amount;
}

/**
 * Deterministic Auto-Filter:
 * - filtered_out if unit price exceeds targetPrice * 1.25, MOQ exceeds targetQuantity * 1.5,
 *   or audit.ts flags a critical red flag (severity === 'red').
 * - shortlisted if within acceptable bounds.
 */
export function evaluateAutoFilter(input: AutoFilterInput): AutoFilterResult {
  const reasons: string[] = [];
  const targetCur = normalizeCurrency(input.targetCurrency);
  const quoteCur = normalizeCurrency(input.quoteCurrency ?? input.targetCurrency);
  const effectiveUnitPrice = convertCurrency(input.unitPrice, quoteCur, targetCur);

  const maxPrice = input.targetPrice * 1.25;
  if (effectiveUnitPrice > maxPrice + 1e-9) {
    const pct = Math.round(((effectiveUnitPrice - input.targetPrice) / input.targetPrice) * 100);
    reasons.push(
      `Price +${pct}% over budget (${quoteCur} ${input.unitPrice.toFixed(2)} vs target ${targetCur} ${input.targetPrice.toFixed(2)})`,
    );
  }

  const maxMoq = input.targetQuantity * 1.5;
  if (input.moq > maxMoq) {
    reasons.push(
      `MOQ too high (${input.moq.toLocaleString("en-US")} pcs vs target ${input.targetQuantity.toLocaleString("en-US")} pcs)`,
    );
  }

  const redFlags = (input.alerts ?? []).filter((a) => a.severity === "red");
  if (redFlags.length > 0) {
    reasons.push(`Critical red flag: ${redFlags.map((a) => a.title).join("; ")}`);
  }

  if (reasons.length > 0) {
    return {
      status: "filtered_out",
      filterReason: reasons.join(" · "),
      reasons,
    };
  }
  return {
    status: "shortlisted",
    filterReason: undefined,
    reasons: [],
  };
}

const InquirySchema = z.object({
  chinese_message: z.string().describe("Polite, natural mainland business Chinese RFQ inquiry message"),
});

/** Deterministic business-Chinese RFQ inquiry template used in mock mode and as fallback. */
export function templateChineseInquiry(p: {
  supplierName: string;
  contactPerson?: string | null;
  productTitle: string;
  targetQuantity: number;
  targetPrice: number;
  currency: string;
  preferredIncoterm: string;
  maxLeadTimeDays: number;
  deadline?: string | null;
  rfqUrl: string;
}): string {
  const curZh = normalizeCurrency(p.currency) === "CNY" ? "元人民币" : "美金 (USD)";
  const greeting = p.contactPerson ? `${p.contactPerson}您好！` : `${p.supplierName}，您好！`;
  const lines = [
    `${greeting}我们是外贸采购方，目前正在采购【${p.productTitle}】，诚邀贵司报价：`,
    `• 采购数量：${p.targetQuantity.toLocaleString("en-US")} 个`,
    `• 目标单价：${p.targetPrice.toFixed(2)} ${curZh}`,
    `• 贸易条款：${p.preferredIncoterm}`,
    `• 期望交期：${p.maxLeadTimeDays} 天以内`,
  ];
  if (p.deadline) {
    lines.push(`• 报价截止：${p.deadline}`);
  }
  lines.push(
    `请点击下方微信专属报价链接填写贵司底价、起订量（MOQ）及交期（无需登录，手机30秒即可提交）：`,
    p.rfqUrl,
    `系统收到后会自动建档核验并进入比价流程，期待与贵司合作，谢谢！`,
  );
  return lines.join("\n");
}

/** Generate a standardized, natural business-Chinese RFQ message via our LLM adapter with deterministic fallback. */
export async function generateChineseInquiry(p: {
  supplierName: string;
  contactPerson?: string | null;
  productTitle: string;
  targetQuantity: number;
  targetPrice: number;
  currency: string;
  preferredIncoterm: string;
  maxLeadTimeDays: number;
  deadline?: string | null;
  token: string;
}): Promise<string> {
  const rfqUrl = appUrl(`/rfq/${p.token}`);
  const fallbackMsg = templateChineseInquiry({ ...p, rfqUrl });
  const r = await callJSON({
    step: "draft",
    system: `You are a bilingual sourcing assistant writing a concise, natural mainland business-Chinese WeChat RFQ inquiry (询价信息) to a Chinese factory/supplier.
Include the product name, target quantity, target unit price, preferred Incoterm, desired lead time, and ALWAYS embed the exact response link provided so the supplier can tap it in WeChat to submit their quote.`,
    text: `Supplier: ${p.supplierName}${p.contactPerson ? ` (contact: ${p.contactPerson})` : ""}
Product: ${p.productTitle}
Target Quantity: ${p.targetQuantity} pcs
Target Unit Price: ${p.currency} ${p.targetPrice}
Preferred Incoterm: ${p.preferredIncoterm}
Max Lead Time: ${p.maxLeadTimeDays} days${p.deadline ? `\nDeadline: ${p.deadline}` : ""}
Response Link: ${rfqUrl}`,
    schema: InquirySchema,
    fallback: () => ({ chinese_message: fallbackMsg }),
    timeoutMs: 8000,
  });

  const msg = r.data.chinese_message?.trim() || fallbackMsg;
  return msg.includes(`/rfq/${p.token}`) ? msg : `${msg}\n\n专属报价链接：${rfqUrl}`;
}

/**
 * Additional realistic Chinese factories so the buyer on /outreach always has 8–10 suppliers to choose from
 * without altering the 2-supplier baseline expected by tests/flows.test.ts after resetDemo().
 */
const DIRECTORY_SUPPLIERS: {
  display_name: string;
  legal_name_zh: string;
  legal_name_en: string;
  credit_code?: string | null;
  contact_name: string;
  wechat_nickname: string;
}[] = [
  {
    display_name: "Dongguan Chuangxin Power",
    legal_name_zh: "东莞市创新电源科技有限公司",
    legal_name_en: "Dongguan Chuangxin Power Technology Co., Ltd.",
    contact_name: "张伟",
    wechat_nickname: "张经理 | 创新电源",
  },
  {
    display_name: "Shenzhen Huayuan GaN",
    legal_name_zh: "深圳市华源氮化镓电子有限公司",
    legal_name_en: "Shenzhen Huayuan GaN Electronics Co., Ltd.",
    contact_name: "刘洋",
    wechat_nickname: "刘总 华源快充",
  },
  {
    display_name: "Foshan Nanhai Precision",
    legal_name_zh: "佛山市南海精工电子制造有限公司",
    legal_name_en: "Foshan Nanhai Precision Electronics Manufacturing Co., Ltd.",
    contact_name: "陈志强",
    wechat_nickname: "陈工 Sales",
  },
  {
    display_name: "Suzhou Kexin Smart Tech",
    legal_name_zh: "苏州市科信智能科技有限公司",
    legal_name_en: "Suzhou Kexin Smart Technology Co., Ltd.",
    contact_name: "赵敏",
    wechat_nickname: "Maggie 赵 | 科信",
  },
  {
    display_name: "Guangzhou Baiyun Hengda",
    legal_name_zh: "广州市白云区恒达电源设备有限公司",
    legal_name_en: "Guangzhou Baiyun Hengda Power Equipment Co., Ltd.",
    contact_name: "黄建军",
    wechat_nickname: "黄总 恒达工厂",
  },
  {
    display_name: "Zhongshan Mingda Electronics",
    legal_name_zh: "中山市明达电子实业有限公司",
    legal_name_en: "Zhongshan Mingda Electronics Industrial Co., Ltd.",
    contact_name: "林晓雯",
    wechat_nickname: "Grace 林 | 明达",
  },
  {
    display_name: "Dongguan Hongfa Electric",
    legal_name_zh: "东莞市宏发电器有限公司",
    legal_name_en: "Dongguan Hongfa Electric Appliance Co., Ltd.",
    credit_code: "91441900MA4U6E1B9U",
    contact_name: "李宏",
    wechat_nickname: "李总 宏发电器",
  },
];

/** Ensure the workspace has at least 8 supplier contacts for the /outreach multi-supplier selector. */
export function ensureOutreachSuppliers(db: DB, workspaceId: string = DEMO_WORKSPACE): EntityLite[] {
  const current = listEntities(db, workspaceId, { kinds: ["supplier"] });
  if (current.length >= 7) return current;

  const existingNames = new Set(
    current.flatMap((e) => [e.display_name.toLowerCase(), (e.legal_name_zh ?? "").toLowerCase()]),
  );

  for (const s of DIRECTORY_SUPPLIERS) {
    if (existingNames.has(s.display_name.toLowerCase()) || existingNames.has(s.legal_name_zh.toLowerCase())) {
      continue;
    }
    const created = createEntity(db, workspaceId, {
      kind: "supplier",
      display_name: s.display_name,
      legal_name_zh: s.legal_name_zh,
      legal_name_en: s.legal_name_en,
      credit_code: s.credit_code ?? null,
    });
    db.prepare(`INSERT INTO contacts (id, entity_id, name, role, wechat_nickname) VALUES (?,?,?,?,?)`).run(
      newId("ct"),
      created.id,
      s.contact_name,
      "Sales",
      s.wechat_nickname,
    );
  }
  return listEntities(db, workspaceId, { kinds: ["supplier"] });
}

type CampaignRow = {
  id: string;
  workspace_id: string;
  matter_id: string;
  target_price: number;
  currency: string;
  target_quantity: number;
  preferred_incoterm: string;
  max_lead_time_days: number;
  deadline: string | null;
  created_at: string;
  updated_at: string;
};

type RecipientRow = {
  id: string;
  campaign_id: string;
  contact_id: string;
  token: string;
  status: OutreachStatus;
  chinese_message: string;
  filter_reason: string | null;
  quote_document_id: string | null;
  supplier_matter_id: string | null;
  submitted_quote_json: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

function hydrateCampaign(db: DB, row: CampaignRow): OutreachCampaign {
  const matter = getMatter(db, row.matter_id);
  const productTitle = matter?.subject ?? matter?.title ?? "Product Inquiry";
  const recRows = db
    .prepare(`SELECT * FROM outreach_recipients WHERE campaign_id = ? ORDER BY created_at, id`)
    .all(row.id) as RecipientRow[];

  const recipients: OutreachRecipient[] = recRows.map((r) => {
    const ent = getEntity(db, r.contact_id);
    return {
      id: r.id,
      campaignId: r.campaign_id,
      contactId: r.contact_id,
      contactName: ent?.display_name ?? r.contact_id,
      contactLabel: ent ? entityLabel(ent) : r.contact_id,
      legalNameZh: ent?.legal_name_zh ?? null,
      token: r.token,
      status: r.status,
      chineseMessage: r.chinese_message,
      filterReason: r.filter_reason ?? undefined,
      quoteDocumentId: r.quote_document_id ?? undefined,
      supplierMatterId: r.supplier_matter_id ?? undefined,
      submittedQuote: r.submitted_quote_json ? (JSON.parse(r.submitted_quote_json) as SubmittedQuote) : null,
      respondedAt: r.responded_at,
    };
  });

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    matterId: row.matter_id,
    productTitle,
    targetPrice: row.target_price,
    currency: row.currency,
    targetQuantity: row.target_quantity,
    preferredIncoterm: row.preferred_incoterm,
    maxLeadTimeDays: row.max_lead_time_days,
    deadline: row.deadline,
    recipients,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getOutreachCampaign(db: DB, id: string): OutreachCampaign | null {
  const row = db.prepare(`SELECT * FROM outreach_campaigns WHERE id = ?`).get(id) as CampaignRow | undefined;
  return row ? hydrateCampaign(db, row) : null;
}

export function listOutreachCampaigns(db: DB, workspaceId: string = DEMO_WORKSPACE): OutreachCampaign[] {
  const rows = db
    .prepare(`SELECT * FROM outreach_campaigns WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC`)
    .all(workspaceId) as CampaignRow[];
  return rows.map((r) => hydrateCampaign(db, r));
}

export function getOutreachByToken(
  db: DB,
  token: string,
): { campaign: OutreachCampaign; recipient: OutreachRecipient; matter: MatterRow | undefined; supplier: EntityLite | undefined } | null {
  const rec = db.prepare(`SELECT * FROM outreach_recipients WHERE token = ?`).get(token) as RecipientRow | undefined;
  if (!rec) return null;
  const campaign = getOutreachCampaign(db, rec.campaign_id);
  if (!campaign) return null;
  const recipient = campaign.recipients.find((r) => r.token === token)!;
  const matter = getMatter(db, campaign.matterId);
  const supplier = getEntity(db, recipient.contactId);
  return { campaign, recipient, matter, supplier };
}

/**
 * Create an OutreachCampaign, generate natural Chinese inquiry messages + unique tokens for each selected supplier,
 * and mark each recipient as 'sent'.
 */
export async function createOutreachCampaign(db: DB, input: CreateCampaignInput): Promise<OutreachCampaign> {
  const workspaceId = input.workspaceId ?? DEMO_WORKSPACE;
  const matter = getMatter(db, input.matterId);
  if (!matter) throw new Error(`Matter not found: ${input.matterId}`);

  const productTitle = matter.subject ?? matter.title;
  const norm = subjectKey(productTitle);
  if (!matter.subject) {
    db.prepare(`UPDATE matters SET subject = ?, subject_norm = ? WHERE id = ?`).run(
      productTitle,
      norm,
      matter.id,
    );
  }

  // Archive pre-existing purchase matters for this product when starting an outreach funnel,
  // so only quotes that pass the auto-filter ('shortlisted') appear in /compare.
  if (norm) {
    const existingMatters = db
      .prepare(`SELECT id FROM matters WHERE workspace_id = ? AND kind = 'purchase' AND subject_norm = ?`)
      .all(workspaceId, norm) as { id: string }[];
    for (const m of existingMatters) {
      db.prepare(`UPDATE matters SET status = 'archived' WHERE id = ?`).run(m.id);
    }
  }

  const currency = normalizeCurrency(input.currency);
  const preferredIncoterm = (input.preferredIncoterm ?? "FOB").trim().toUpperCase();
  const maxLeadTimeDays = Number(input.maxLeadTimeDays ?? 20);
  const targetPrice = Number(input.targetPrice);
  const targetQuantity = Number(input.targetQuantity);
  const deadline = input.deadline ?? null;

  const uniqueContactIds = [...new Set(input.contactIds.filter(Boolean))];
  if (!uniqueContactIds.length) {
    throw new Error("At least one supplier contact must be selected");
  }

  const campaignId = newId("oc");
  const now = nowIso();

  db.prepare(
    `INSERT INTO outreach_campaigns (id, workspace_id, matter_id, target_price, currency, target_quantity, preferred_incoterm, max_lead_time_days, deadline, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    campaignId,
    workspaceId,
    matter.id,
    targetPrice,
    currency,
    targetQuantity,
    preferredIncoterm,
    maxLeadTimeDays,
    deadline,
    now,
    now,
  );

  for (const contactId of uniqueContactIds) {
    const ent = getEntity(db, contactId);
    if (!ent) throw new Error(`Supplier contact not found: ${contactId}`);
    const contactRow = db
      .prepare(`SELECT name FROM contacts WHERE entity_id = ? LIMIT 1`)
      .get(contactId) as { name: string } | undefined;
    const token = newId("rfq").replace(/^rfq_/, "");
    const supplierName = ent.legal_name_zh ?? ent.display_name;
    const chineseMessage = await generateChineseInquiry({
      supplierName,
      contactPerson: contactRow?.name ?? null,
      productTitle,
      targetQuantity,
      targetPrice,
      currency,
      preferredIncoterm,
      maxLeadTimeDays,
      deadline,
      token,
    });

    db.prepare(
      `INSERT INTO outreach_recipients (id, campaign_id, contact_id, token, status, chinese_message, filter_reason, quote_document_id, supplier_matter_id, submitted_quote_json, responded_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(newId("or"), campaignId, contactId, token, "sent", chineseMessage, null, null, null, null, null, now, now);
  }

  return getOutreachCampaign(db, campaignId)!;
}

const PORT_ZH_MAP: Record<string, string> = {
  Shenzhen: "深圳",
  Ningbo: "宁波",
  Shanghai: "上海",
  Guangzhou: "广州",
  Xiamen: "厦门",
  Qingdao: "青岛",
  Tianjin: "天津",
  "Hong Kong": "香港",
};

function findOrCreateSupplierPurchaseMatter(
  db: DB,
  workspaceId: string,
  supplier: EntityLite,
  sourceMatter: MatterRow,
): MatterRow {
  const productSubject = sourceMatter.subject ?? sourceMatter.title;
  const norm = subjectKey(productSubject);

  // If the campaign's source matter already belongs to this supplier, use it directly
  if (sourceMatter.entity_id === supplier.id && sourceMatter.kind === "purchase") {
    db.prepare(`UPDATE matters SET subject = ?, subject_norm = ?, status = 'open', updated_at = ? WHERE id = ?`).run(
      productSubject,
      norm,
      nowIso(),
      sourceMatter.id,
    );
    return getMatter(db, sourceMatter.id)!;
  }

  // Check if this supplier already has a purchase matter for the same product
  const existing = (
    db
      .prepare(`SELECT * FROM matters WHERE workspace_id = ? AND kind = 'purchase' AND entity_id = ? ORDER BY updated_at DESC`)
      .all(workspaceId, supplier.id) as MatterRow[]
  ).find((m) => m.subject_norm === norm || m.subject === productSubject);

  if (existing) {
    db.prepare(`UPDATE matters SET subject = ?, subject_norm = ?, status = 'open', updated_at = ? WHERE id = ?`).run(
      productSubject,
      norm,
      nowIso(),
      existing.id,
    );
    return getMatter(db, existing.id)!;
  }

  return createMatter(db, workspaceId, {
    kind: "purchase",
    entityId: supplier.id,
    entityName: supplier.display_name,
    subject: productSubject,
    title: productSubject,
  });
}

function buildChineseQuotationHtml(p: {
  supplier: EntityLite;
  productSubject: string;
  targetQuantity: number;
  submission: SupplierSubmission;
}): string {
  const cur = normalizeCurrency(p.submission.currency);
  const curWord = cur === "CNY" ? "元" : "美金";
  const inco = (p.submission.incoterm || "FOB").trim().toUpperCase();
  const portZh = p.submission.port ? PORT_ZH_MAP[p.submission.port] ?? p.submission.port : "";
  const supplierName = p.supplier.legal_name_zh ?? p.supplier.display_name;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>报价单 Quotation - ${supplierName}</title></head>
<body>
  <h1>报价单 (Quotation)</h1>
  <p>报价单位：${supplierName}${p.supplier.credit_code ? `（统一社会信用代码：${p.supplier.credit_code}）` : ""}</p>
  <p>产品名称：${p.productSubject}</p>
  <p>采购数量：${p.targetQuantity}个</p>
  <p>单价：${p.submission.unitPrice} ${curWord}</p>
  <p>起订量：${p.submission.moq}</p>
  <p>贸易条款：${inco}${portZh ? ` ${portZh}` : ""}</p>
  <p>交期 ${p.submission.leadTimeDays} 天</p>
  ${p.submission.paymentTerms ? `<p>付款条款：${p.submission.paymentTerms}</p>` : ""}
  ${p.submission.beneficiaryName ? `<p>收款户名：${p.submission.beneficiaryName}</p>` : ""}
  ${p.submission.notes ? `<p>备注：${p.submission.notes}</p>` : ""}
</body>
</html>`;
}

/**
 * Process a supplier's inbound RFQ submission (/rfq/[token]):
 * 1. Converts structured Chinese submission into a Quotation Document file.
 * 2. Runs lib/core/ingest.ts (handleIncoming) + lib/core/audit.ts (runAudit).
 * 3. Applies deterministic Auto-Filter (price > 1.25x, MOQ > 1.5x, or critical red flag).
 * 4. Updates recipient status ('shortlisted' vs 'filtered_out') and ensures only shortlisted quotes appear in /compare.
 */
export async function submitOutreachResponse(
  db: DB,
  token: string,
  submission: SupplierSubmission,
): Promise<{
  campaign: OutreachCampaign;
  recipient: OutreachRecipient;
  filterResult: AutoFilterResult;
  quoteDocumentId: string;
  supplierMatterId: string;
}> {
  const found = getOutreachByToken(db, token);
  if (!found) throw new Error(`Invalid or unknown RFQ token: ${token}`);
  const { campaign, recipient } = found;
  const workspaceId = campaign.workspaceId;
  const sourceMatter = getMatter(db, campaign.matterId);
  if (!sourceMatter) throw new Error(`Campaign matter not found: ${campaign.matterId}`);
  const supplier = getEntity(db, recipient.contactId);
  if (!supplier) throw new Error(`Supplier entity not found: ${recipient.contactId}`);

  const productSubject = sourceMatter.subject ?? sourceMatter.title;
  const supplierMatter = findOrCreateSupplierPurchaseMatter(db, workspaceId, supplier, sourceMatter);

  // Supersede prior preliminary chat/voice commercial facts on this matter so old pre-RFQ chats don't trigger false doc-vs-chat alerts
  db.prepare(
    `UPDATE facts SET status = 'superseded'
     WHERE matter_id = ? AND source_type IN ('chat','voice')
       AND key IN ('unit_price','moq','incoterm','port','lead_time_days','order_qty')`,
  ).run(supplierMatter.id);

  // 1. Convert the structured Chinese submission into a Document file
  const html = buildChineseQuotationHtml({
    supplier,
    productSubject,
    targetQuantity: campaign.targetQuantity,
    submission,
  });
  const fileName = `报价单_${supplier.display_name.replace(/\s+/g, "_")}_${token.slice(0, 6)}.html`;
  const filePath = storeFile(fileName, Buffer.from(html, "utf8"));

  // 2. Ingest through existing pipeline (lib/core/ingest.ts -> extractDocument + addFacts + runAudit)
  const userRow = db
    .prepare(`SELECT id FROM users WHERE workspace_id = ? LIMIT 1`)
    .get(workspaceId) as { id: string } | undefined;
  const userId = userRow?.id ?? DEMO_USER;

  await handleIncoming(
    {
      userId,
      channel: "web_upload",
      items: [{ kind: "file", filePath }],
      entityId: supplier.id,
      matterId: supplierMatter.id,
    },
    db,
  );

  // Retrieve the newly ingested document ID
  const docRow = db
    .prepare(
      `SELECT id FROM documents WHERE workspace_id = ? AND entity_id = ? AND matter_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(workspaceId, supplier.id, supplierMatter.id) as { id: string } | undefined;
  const quoteDocumentId = docRow?.id ?? newId("doc");

  // Ensure structured facts from the form are guaranteed to be linked to supplierMatter & quoteDocumentId
  const now = nowIso();
  const cur = normalizeCurrency(submission.currency ?? campaign.currency);
  const inco = (submission.incoterm || campaign.preferredIncoterm || "FOB").trim().toUpperCase();
  const guaranteedFacts: CandidateFact[] = [
    {
      key: "unit_price",
      value: makeValue("unit_price", { number: submission.unitPrice, currency: cur })!,
      said_by: "document",
      source_type: "document",
      source_doc_type: "quotation",
      source_document_id: quoteDocumentId,
      quote_original: `单价：${submission.unitPrice} ${cur === "CNY" ? "元" : "美金"}`,
      stated_at: now,
    },
    {
      key: "moq",
      value: makeValue("moq", { number: submission.moq })!,
      said_by: "document",
      source_type: "document",
      source_doc_type: "quotation",
      source_document_id: quoteDocumentId,
      quote_original: `起订量：${submission.moq}`,
      stated_at: now,
    },
    {
      key: "lead_time_days",
      value: makeValue("lead_time_days", { number: submission.leadTimeDays })!,
      said_by: "document",
      source_type: "document",
      source_doc_type: "quotation",
      source_document_id: quoteDocumentId,
      quote_original: `交期 ${submission.leadTimeDays} 天`,
      stated_at: now,
    },
    {
      key: "incoterm",
      value: makeValue("incoterm", { text: inco })!,
      said_by: "document",
      source_type: "document",
      source_doc_type: "quotation",
      source_document_id: quoteDocumentId,
      quote_original: `贸易条款：${inco}`,
      stated_at: now,
    },
  ];
  if (submission.port) {
    const pv = makeValue("port", { text: submission.port });
    if (pv) {
      guaranteedFacts.push({
        key: "port",
        value: pv,
        said_by: "document",
        source_type: "document",
        source_doc_type: "quotation",
        source_document_id: quoteDocumentId,
        quote_original: submission.port,
        stated_at: now,
      });
    }
  }
  if (submission.paymentTerms) {
    const ptv = makeValue("payment_terms", { text: submission.paymentTerms });
    if (ptv) {
      guaranteedFacts.push({
        key: "payment_terms",
        value: ptv,
        said_by: "document",
        source_type: "document",
        source_doc_type: "quotation",
        source_document_id: quoteDocumentId,
        quote_original: submission.paymentTerms,
        stated_at: now,
      });
    }
  }
  if (submission.beneficiaryName) {
    const bv = makeValue("bank_beneficiary_name", { text: submission.beneficiaryName });
    if (bv) {
      guaranteedFacts.push({
        key: "bank_beneficiary_name",
        value: bv,
        said_by: "document",
        source_type: "document",
        source_doc_type: "quotation",
        source_document_id: quoteDocumentId,
        quote_original: `收款户名：${submission.beneficiaryName}`,
        stated_at: now,
      });
    }
  }
  addFacts(db, { workspaceId, entityId: supplier.id, matterId: supplierMatter.id }, guaranteedFacts);

  // Run audit.ts after ensuring all facts are recorded
  await runAudit(db, workspaceId);

  // Collect open alerts for this supplier and matter
  const matterAlerts = openAlerts(db, { matterId: supplierMatter.id });
  const entityAlerts = openAlerts(db, { entityId: supplier.id });
  const allAlerts = [...matterAlerts, ...entityAlerts].filter(
    (a, idx, arr) => arr.findIndex((x) => x.id === a.id) === idx,
  );

  // 3. Apply deterministic Auto-Filter
  const filterResult = evaluateAutoFilter({
    targetPrice: campaign.targetPrice,
    targetCurrency: campaign.currency,
    targetQuantity: campaign.targetQuantity,
    unitPrice: submission.unitPrice,
    quoteCurrency: cur,
    moq: submission.moq,
    alerts: allAlerts,
  });

  // 4. If shortlisted, keep matter open so it appears in /compare; if filtered_out, archive its purchase matter so it is excluded from /compare
  if (filterResult.status === "shortlisted") {
    db.prepare(`UPDATE matters SET status = 'open', subject = ?, subject_norm = ?, updated_at = ? WHERE id = ?`).run(
      productSubject,
      subjectKey(productSubject),
      now,
      supplierMatter.id,
    );
  } else {
    db.prepare(`UPDATE matters SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, supplierMatter.id);
  }

  const savedQuote: SubmittedQuote = {
    unitPrice: submission.unitPrice,
    currency: cur,
    moq: submission.moq,
    leadTimeDays: submission.leadTimeDays,
    incoterm: inco,
    port: submission.port ?? null,
    paymentTerms: submission.paymentTerms ?? null,
    beneficiaryName: submission.beneficiaryName ?? null,
    notes: submission.notes ?? null,
    submittedAt: now,
  };

  db.prepare(
    `UPDATE outreach_recipients
     SET status = ?, filter_reason = ?, quote_document_id = ?, supplier_matter_id = ?, submitted_quote_json = ?, responded_at = ?, updated_at = ?
     WHERE token = ?`,
  ).run(
    filterResult.status,
    filterResult.filterReason ?? null,
    quoteDocumentId,
    supplierMatter.id,
    JSON.stringify(savedQuote),
    now,
    now,
    token,
  );

  db.prepare(`UPDATE outreach_campaigns SET updated_at = ? WHERE id = ?`).run(now, campaign.id);

  const updatedCampaign = getOutreachCampaign(db, campaign.id)!;
  const updatedRecipient = updatedCampaign.recipients.find((r) => r.token === token)!;
  return {
    campaign: updatedCampaign,
    recipient: updatedRecipient,
    filterResult,
    quoteDocumentId,
    supplierMatterId: supplierMatter.id,
  };
}

/**
 * Hackathon Demo Helper: realistically simulates responses from the selected suppliers in a campaign
 * (e.g. 2–3 shortlisted quotes pushed straight to /compare, 3 filtered out with clear reasons, and 2 no-replies).
 */
export async function simulateOutreachCampaign(db: DB, campaignId: string): Promise<OutreachCampaign> {
  const campaign = getOutreachCampaign(db, campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const sourceMatter = getMatter(db, campaign.matterId);
  const productSubject = sourceMatter?.subject ?? sourceMatter?.title ?? campaign.productTitle;
  const norm = subjectKey(productSubject);

  // Archive any existing purchase matters for this product from suppliers that are NOT shortlisted yet,
  // so /compare cleanly reflects ONLY the shortlisted quotes from this campaign.
  if (norm) {
    const sameProductMatters = listMatters(db, campaign.workspaceId, { profile: "china_business" }).filter(
      (m) => m.kind === "purchase" && m.subject_norm === norm,
    );
    for (const m of sameProductMatters) {
      db.prepare(`UPDATE matters SET status = 'archived', updated_at = ? WHERE id = ?`).run(nowIso(), m.id);
    }
  }

  const recs = [...campaign.recipients];
  const total = recs.length;

  // Put revoked-license suppliers (like Dongguan Hongfa, 91441900MA4U6E1B9U) in the filtered-out group so audit.ts catches them naturally
  const isRevoked = (r: OutreachRecipient) => getEntity(db, r.contactId)?.credit_code === "91441900MA4U6E1B9U";
  const ordered = [
    ...recs.filter((r) => !isRevoked(r)),
    ...recs.filter((r) => isRevoked(r)),
  ];

  // Partition into: shortlisted (2–3), filtered_out (up to 3), and no_reply (remaining, typically 2)
  const shortlistCount = total >= 8 ? 3 : total >= 2 ? 2 : 1;
  const filterOutCount = total >= 6 ? 3 : total >= 4 ? Math.min(2, total - shortlistCount) : Math.max(0, total - shortlistCount);

  const toShortlist = ordered.slice(0, shortlistCount);
  // Take from the end so any revoked supplier is included in toFilterOut
  const remaining = ordered.slice(shortlistCount);
  const toFilterOut = remaining.slice(Math.max(0, remaining.length - filterOutCount));
  const toNoReply = remaining.slice(0, Math.max(0, remaining.length - filterOutCount));

  // Clear any prior red-flag facts on the shortlisted suppliers so they pass audit cleanly
  for (const r of toShortlist) {
    db.prepare(
      `DELETE FROM facts WHERE entity_id = ? AND key IN ('bank_beneficiary_name','bank_account_country','credit_code')`,
    ).run(r.contactId);
    db.prepare(`DELETE FROM alerts WHERE entity_id = ?`).run(r.contactId);
  }

  const shortlistProfiles: SupplierSubmission[] = [
    {
      unitPrice: Number((campaign.targetPrice * 0.93).toFixed(2)),
      currency: campaign.currency,
      moq: Math.max(100, Math.round(campaign.targetQuantity * 0.5)),
      leadTimeDays: Math.max(7, campaign.maxLeadTimeDays - 5),
      incoterm: campaign.preferredIncoterm,
      port: "Shenzhen",
      paymentTerms: "30% T/T deposit, 70% before shipment",
      notes: "源头工厂直供，含CE/FCC/RoHS认证，可安排本周寄送免费样品。",
    },
    {
      unitPrice: Number((campaign.targetPrice * 0.98).toFixed(2)),
      currency: campaign.currency,
      moq: Math.max(200, Math.round(campaign.targetQuantity * 0.8)),
      leadTimeDays: Math.max(10, campaign.maxLeadTimeDays - 2),
      incoterm: campaign.preferredIncoterm,
      port: "Ningbo",
      paymentTerms: "30% deposit, 70% against copy of B/L",
      notes: "含定制彩盒包装及激光刻字，质保24个月。",
    },
    {
      unitPrice: Number((campaign.targetPrice * 1.05).toFixed(2)),
      currency: campaign.currency,
      moq: campaign.targetQuantity,
      leadTimeDays: campaign.maxLeadTimeDays,
      incoterm: campaign.preferredIncoterm,
      port: "Guangzhou",
      paymentTerms: "30% T/T deposit, 70% balance before delivery",
      notes: "全自动产线100%老化测试，不良率低于0.1%。",
    },
  ];

  for (let i = 0; i < toShortlist.length; i++) {
    const rec = toShortlist[i];
    const prof = shortlistProfiles[i % shortlistProfiles.length];
    await submitOutreachResponse(db, rec.token, prof);
  }

  const filteredProfiles: SupplierSubmission[] = [
    // 1. Price +45% over budget (> targetPrice * 1.25)
    {
      unitPrice: Number((campaign.targetPrice * 1.45).toFixed(2)),
      currency: campaign.currency,
      moq: campaign.targetQuantity,
      leadTimeDays: campaign.maxLeadTimeDays,
      incoterm: campaign.preferredIncoterm,
      port: "Shenzhen",
      notes: "采用进口定制芯片方案，单价较高，暂不接受议价。",
    },
    // 2. MOQ too high (3x targetQuantity, > targetQuantity * 1.5)
    {
      unitPrice: Number((campaign.targetPrice * 0.96).toFixed(2)),
      currency: campaign.currency,
      moq: Math.round(campaign.targetQuantity * 3),
      leadTimeDays: campaign.maxLeadTimeDays + 5,
      incoterm: campaign.preferredIncoterm,
      port: "Ningbo",
      notes: "外贸大单产线排期紧，最低起订量需达标才可开机生产。",
    },
    // 3. Critical red flag from audit.ts (personal bank account beneficiary +/or revoked company license)
    {
      unitPrice: Number((campaign.targetPrice * 0.90).toFixed(2)),
      currency: campaign.currency,
      moq: Math.max(100, Math.round(campaign.targetQuantity * 0.5)),
      leadTimeDays: 12,
      incoterm: "EXW",
      port: "Dongguan",
      beneficiaryName: "陈丽",
      paymentTerms: "100% upfront wire to personal account",
      notes: "工厂直发特惠价，请打款至财务个人卡账户（收款户名：陈丽）。",
    },
  ];

  for (let i = 0; i < toFilterOut.length; i++) {
    const rec = toFilterOut[i];
    const prof = filteredProfiles[i % filteredProfiles.length];
    await submitOutreachResponse(db, rec.token, prof);
  }

  const now = nowIso();
  for (const rec of toNoReply) {
    db.prepare(
      `UPDATE outreach_recipients SET status = 'no_reply', filter_reason = 'No response before deadline', updated_at = ? WHERE token = ?`,
    ).run(now, rec.token);
  }

  db.prepare(`UPDATE outreach_campaigns SET updated_at = ? WHERE id = ?`).run(now, campaign.id);
  return getOutreachCampaign(db, campaign.id)!;
}
