// Extraction (blueprint §11, generalized): files → DocumentExtraction, text/transcripts → TextExtraction.
// Live: one structured-output call per item (MODEL_EXTRACT / MODEL_ANALYZE). Mock or failure: golden fixtures for the
// demo files, else a deterministic regex extractor — so the pipeline always yields something checkable.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { callJSON, provider } from "@/lib/adapters/llm";
import { DOC_FIXTURES, TEXT_FIXTURES } from "@/data/demo/fixtures";
import { DocumentExtractionSchema, TextExtractionSchema, type DocumentExtraction, type TextExtraction } from "./schemas";
import { DOC_TYPES, FACT_DEFS, PARTY_ROLES, type FactKey } from "./domain";
import { makeValue, normalizeDate, type CandidateFact, type SaidBy, type SourceType } from "./facts";
import type { Clue } from "./entities";
import { isChinese } from "./normalize";
import { addDays, localDate, weekdayOf } from "@/lib/db";

// ── files ──
export function originalFileName(filePath: string) {
  const base = path.basename(filePath);
  return base.includes("__") ? base.slice(base.indexOf("__") + 2) : base;
}

export function mimeOf(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ({
    ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".html": "text/html", ".htm": "text/html", ".txt": "text/plain", ".amr": "audio/amr", ".silk": "audio/silk", ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg",
  } as Record<string, string>)[ext] ?? "application/octet-stream";
}

export const htmlToText = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(tr|div|p|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

// The prompt lists the vocabularies so the model never needs to invent keys. Static → cacheable.
const DOC_SYSTEM = `You read documents that a foreign business person in China receives: supplier paperwork (business licenses 营业执照, quotations, proforma invoices, certificates, bank details), and everyday China bureaucracy (visas, residence and work permits, police registration, tax notices, fapiao, leases, employment contracts, company filings, customs papers).

Return ONE JSON object:
- doc_type: the best match from the allowed list.
- parties: every organization or person on the document with its ROLE:
  seller (issues a quotation/proforma/sales contract), issuer (company that issued an invoice/receipt/notice), subject (the company a license is about, or the person an ID/permit/passport is about),
  authority (government office issuing a notice/permit), landlord, tenant, employer, employee, buyer, payer, beneficiary (who receives money — bank account holder),
  cert_holder, manufacturer, lab, agent, customer, other.
  Copy names exactly as printed; put the other-language name in name_alt. Put the 18-character 统一社会信用代码 in credit_code next to its company; passport/ID/permit numbers in id_number.
- facts: values from the allowed keys only, each with quote_original = the exact text where it appears. Money as numbers with ISO currency (元/人民币/RMB = CNY, 美金/美元 = USD). Dates YYYY-MM-DD.
  Proformas/quotations: unit_price, total_amount, incoterm, port, lead_time_days, payment_terms, deposit_pct, fees, bank_beneficiary_name, bank_name, bank_account_country.
  Licenses: legal_name_zh, legal_name_en, credit_code, legal_rep, reg_capital, business_scope, registered_address.
  Leases: rent_amount (per month), security_deposit, rent_due_day, lease_start, lease_end, property_address, bank_beneficiary_name.
  Personal documents: holder_name, document_number, nationality, issue_date, expiry_date, issuing_authority.
  Government/tax notices: tax_type, tax_period, amount_due, penalty_amount, filing_deadline, case_number, appointment_date.
- tasks: anything the reader must do by a date (filing, payment, appointment, renewal), who must do it, and the due date.
- line_items: product lines on commercial documents.
- subject: what the document is about in a few words (the product, the property, the person, the tax period).
Unreadable or absent → null or omit. Never invent values.`;

export async function extractDocument(filePath: string, opts: { receivedAt?: string } = {}): Promise<{ data: DocumentExtraction; source: string }> {
  const name = originalFileName(filePath);
  const fixture = DOC_FIXTURES[name];
  const mime = mimeOf(filePath);
  const empty: DocumentExtraction = {
    doc_type: "other", language: "other", confidence: 0.1, title: name, summary: "", subject: null, visible_text: "", doc_date: null, expiry_date: null,
    parties: [], line_items: [], facts: [], tasks: [],
  };
  const buf = fs.readFileSync(filePath);
  const intro = `File name: ${name}. Received on ${localDate(opts.receivedAt ?? new Date())} (China time).`;
  const args = { step: "extract" as const, system: DOC_SYSTEM, schema: DocumentExtractionSchema, timeoutMs: Number(process.env.LLM_TIMEOUT_EXTRACT_MS ?? 45000) };
  let r;
  if (mime.startsWith("image/")) {
    r = await callJSON({ ...args, text: intro, imageDataUrls: [`data:${mime};base64,${buf.toString("base64")}`], fallback: () => fixture ?? empty });
  } else if (mime === "application/pdf") {
    r = await callJSON({ ...args, text: intro, pdfBase64: buf.toString("base64"), fallback: () => fixture ?? empty });
  } else {
    const text = mime === "text/html" ? htmlToText(buf.toString("utf8")) : buf.toString("utf8").slice(0, 30000);
    r = await callJSON({ ...args, text: `${intro}\n\nDocument text:\n${text}`, fallback: () => fixture ?? heuristicDocument(name, text) });
  }
  return { data: sanitizeDocument(r.data), source: r.source };
}

/** Normalize whatever came back (model or fallback): dates, empty strings, fact values. */
function sanitizeDocument(x: DocumentExtraction): DocumentExtraction {
  const d = (s: string | null) => (s ? normalizeDate(s) ?? s : null);
  return { ...x, doc_date: d(x.doc_date), expiry_date: d(x.expiry_date), parties: x.parties.filter((p) => p.name?.trim()) };
}

/** Facts from a document. Line item 1 → unit_price/order_qty/product_model; other lines → price tiers. */
export function documentFacts(x: DocumentExtraction, ctx: { documentId: string; messageId: string; statedAt: string }): CandidateFact[] {
  const out: CandidateFact[] = [];
  const seen = new Set<string>();
  const push = (key: FactKey, v: { number?: number | null; text?: string | null; currency?: string | null }, quote: string | null) => {
    const value = makeValue(key, v);
    if (!value) return;
    const sig = `${key}:${JSON.stringify(value)}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ key, value, said_by: "document", source_type: "document", source_doc_type: x.doc_type, source_document_id: ctx.documentId, source_message_id: ctx.messageId, quote_original: quote, stated_at: ctx.statedAt, confidence: x.confidence });
  };
  const [first, ...rest] = x.line_items;
  if (first) {
    push("unit_price", { number: first.unit_price, currency: first.currency }, first.unit_price != null ? `${first.currency ?? ""} ${first.unit_price}`.trim() : null);
    push("order_qty", { number: first.qty }, first.qty != null ? String(first.qty) : null);
    push("product_model", { text: first.model }, first.model);
  }
  for (const it of rest) push("price_tier", { number: it.unit_price, currency: it.currency }, `${it.model ?? ""} ${it.unit_price ?? ""}`.trim());
  for (const f of x.facts) push(f.key, { number: f.value_number, text: f.value_text, currency: f.currency }, f.quote_original);
  // the document's own expiry is a fact too (so "when does my permit expire?" has a source)
  if (x.expiry_date && !x.facts.some((f) => f.key === "expiry_date" || f.key === "lease_end")) push("expiry_date", { text: x.expiry_date }, x.expiry_date);
  // parties → facts the audit needs (beneficiary, cert holder, license names)
  for (const p of x.parties) {
    if (p.role === "beneficiary") push("bank_beneficiary_name", { text: p.name }, p.name);
    if (p.role === "cert_holder") push("cert_holder", { text: p.name }, p.name);
    if (p.role === "subject" && x.doc_type === "business_license") {
      push(/[一-鿿]/.test(p.name) ? "legal_name_zh" : "legal_name_en", { text: p.name }, p.name);
      if (p.name_alt) push(/[一-鿿]/.test(p.name_alt) ? "legal_name_zh" : "legal_name_en", { text: p.name_alt }, p.name_alt);
      if (p.credit_code) push("credit_code", { text: p.credit_code }, p.credit_code);
    }
    if (p.role === "subject" && p.kind === "person") push("holder_name", { text: p.name }, p.name);
  }
  return out;
}

/** Identifying clues (§5.2): only parties whose ROLE identifies the counterparty. Never beneficiary, cert holder, buyer. */
export function documentClues(x: DocumentExtraction): Clue[] {
  const clues: Clue[] = [];
  for (const p of x.parties) {
    const strong = PARTY_ROLES[p.role]?.identifies ?? false;
    if (!strong) continue;
    if (p.credit_code) clues.push({ kind: "credit_code", value: p.credit_code, strong, role: p.role, partyKind: p.kind });
    if (p.id_number) clues.push({ kind: "id_number", value: p.id_number, strong, role: p.role, partyKind: p.kind });
    clues.push({ kind: "legal_name", value: p.name, strong, role: p.role, partyKind: p.kind });
    if (p.name_alt) clues.push({ kind: "legal_name", value: p.name_alt, strong, role: p.role, partyKind: p.kind });
  }
  return clues;
}

/** The person a personal document is about (passport, permit…), if any. */
export const documentPerson = (x: DocumentExtraction) => x.parties.find((p) => p.role === "subject" && p.kind === "person") ?? null;

// ── text / transcripts ──
const TEXT_SYSTEM = `You help a foreign business person in China understand messages from Chinese counterparties (suppliers, landlords, agents, accountants, government offices) — WeChat chats and voice transcripts.
1. translation: faithful English translation.
2. subtext: polite Chinese phrases whose real meaning differs (尽量 = "we'll try" → likely delay; 问题不大 = there is a problem; 再商量 = polite no; 应该 = not a commitment; "from" prices; 原则上 = there are exceptions). Only phrases that actually appear.
3. facts: allowed keys only; quote_original MUST be an exact substring of the message. Money as numbers with ISO currency (美金/美元 = USD; 元/块/人民币 = CNY). Lead times in days, dates YYYY-MM-DD relative to the message date.
4. tasks: dated promises or deadlines ("sample by Friday", "pay rent before the 5th", "bring your passport on Monday"). who: counterparty if they promised, me if the reader must act, authority for official deadlines.
5. subject: the product or topic if clear.
6. company_names: company or office names literally written (WeChat nicknames are NOT company names).
Never invent anything that isn't in the message.`;

export async function extractText(text: string, receivedAt: string): Promise<{ data: TextExtraction; source: string }> {
  const fixture = TEXT_FIXTURES[text.trim()]?.(receivedAt);
  const r = await callJSON({
    step: "analyze", system: TEXT_SYSTEM, text: `Message date: ${localDate(receivedAt)} (${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][weekdayOf(localDate(receivedAt))]}, China time)\n\nMessage:\n${text}`, schema: TextExtractionSchema,
    fallback: () => fixture ?? heuristicTextExtraction(text, receivedAt), timeoutMs: Number(process.env.LLM_TIMEOUT_ANALYZE_MS ?? 30000),
  });
  return { data: r.data, source: r.source };
}

/** Fast first answer on chat channels: a plain translation sent while the full reading (facts, subtext, tasks) runs.
 *  Returns null in mock mode or on failure — the full reading still carries the translation. */
export async function quickTranslate(text: string): Promise<string | null> {
  if (provider === "mock" || !isChinese(text)) return null;
  const r = await callJSON({
    step: "translate",
    system: "Translate this message from a Chinese business counterparty into natural, plain English for a foreign business person. Keep every number, price, currency, unit, date and name exactly. No notes or commentary.",
    text, schema: z.object({ translation: z.string() }), fallback: () => ({ translation: "" }),
    timeoutMs: Number(process.env.LLM_TIMEOUT_TRANSLATE_MS ?? 12000),
  });
  return r.source === "fallback" || !r.data.translation.trim() ? null : r.data.translation.trim();
}

export function textFacts(x: TextExtraction, ctx: { messageId: string; statedAt: string; saidBy: SaidBy; sourceType: SourceType }): CandidateFact[] {
  return x.facts.flatMap((f) => {
    const value = makeValue(f.key, { number: f.value_number, text: f.value_text, currency: f.currency });
    return value ? [{ key: f.key, value, said_by: ctx.saidBy, source_type: ctx.sourceType, source_message_id: ctx.messageId, quote_original: f.quote_original, stated_at: ctx.statedAt }] : [];
  });
}

// ── deterministic fallbacks (mock mode and live failures) ──
const PORTS: Record<string, string> = { 深圳: "Shenzhen", 宁波: "Ningbo", 上海: "Shanghai", 广州: "Guangzhou", 厦门: "Xiamen", 青岛: "Qingdao", 天津: "Tianjin", 香港: "Hong Kong" };
const SUBTEXT: { re: RegExp; meaning: string; risk: "low" | "medium" | "high" }[] = [
  { re: /尽量[^，。,.!！]*/, meaning: "\"We'll try\" — a soft promise, not a commitment. Expect a delay.", risk: "medium" },
  { re: /问题不大/, meaning: "\"Not a big problem\" — usually means there IS a problem.", risk: "medium" },
  { re: /再商量|再说吧|以后再说/, meaning: "\"Let's discuss later\" — often a polite no.", risk: "high" },
  { re: /考虑一下|研究一下/, meaning: "\"We'll consider it\" — often a polite no.", risk: "medium" },
  { re: /原则上/, meaning: "\"In principle\" — there are exceptions they haven't told you.", risk: "medium" },
  { re: /应该[^，。,.]*/, meaning: "\"Should be\" — not a commitment.", risk: "low" },
  { re: /\d+(\.\d+)?\s*(美金|美元|元)起/, meaning: "\"From\" price — the price you get will likely be higher.", risk: "medium" },
  { re: /左右/, meaning: "\"About\" — leaves room to slip; get a fixed number in writing.", risk: "low" },
];
const WEEKDAYS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

export function heuristicTextExtraction(text: string, receivedAt: string): TextExtraction {
  const facts: TextExtraction["facts"] = [];
  const add = (key: FactKey, quote: string, num: number | null, txt: string | null, cur: string | null = null) => facts.push({ key, value_number: num, value_text: txt, currency: cur, quote_original: quote });
  const cny = (u: string | undefined) => /元|块|人民币|rmb|cny/i.test(u ?? "");

  const rent = text.match(/(?:房租|租金|月租)[^\d]{0,6}(\d[\d,]*(?:\.\d+)?)\s*(元|块|人民币|rmb)?/i);
  if (rent) add("rent_amount", rent[0], Number(rent[1].replace(/,/g, "")), null, "CNY");
  const deposit = text.match(/(?:押金)[^\d]{0,6}(\d[\d,]*)\s*(元|块)?|押(\S)付(\S)/);
  if (deposit?.[1]) add("security_deposit", deposit[0], Number(deposit[1].replace(/,/g, "")), null, "CNY");
  const dueDay = text.match(/每(?:个)?月\s*(\d{1,2})\s*(?:号|日)(?:之前|前)?/);
  if (dueDay) add("rent_due_day", dueDay[0], Number(dueDay[1]), null);
  if (!rent) {
    const price = text.match(/(?:每个|单价|一个)?\s*(?:US\$|\$|USD\s?)?(\d+(?:\.\d+)?)\s*(美金|美元|刀|usd|dollars?|元|人民币|rmb|cny)(?:一个|\/个|每个)?/i) ?? text.match(/(?:US\$|\$|USD\s?)(\d+(?:\.\d+)?)/i);
    if (price) add("unit_price", price[0].trim(), Number(price[1]), null, cny(price[2]) ? "CNY" : "USD");
  }
  const moq = text.match(/(?:起订量?|最低起订|MOQ)[^\d]{0,6}(\d[\d,]*)/i);
  if (moq) add("moq", moq[0], Number(moq[1].replace(/,/g, "")), null);
  const qty = text.match(/(\d[\d,]*)\s*(?:个|pcs|件|台|units?)(?:的话)?/i);
  if (qty && (!moq || !moq[0].includes(qty[1]))) add("order_qty", qty[0], Number(qty[1].replace(/,/g, "")), null);
  const inco = text.match(/\b(FOB|EXW|CIF|CFR|DDP|DAP|FCA|CPT|CIP)\b\s*(深圳|宁波|上海|广州|厦门|青岛|天津|香港|Shenzhen|Ningbo|Shanghai|Guangzhou|Xiamen|Qingdao)?/i);
  if (inco) {
    add("incoterm", inco[0].trim(), null, inco[1].toUpperCase());
    if (inco[2]) add("port", inco[0].trim(), null, PORTS[inco[2]] ?? inco[2]);
  }
  const lead = text.match(/交期\s*(?:大概|大约|约)?\s*(\d+)\s*(?:个工作日|天)(左右)?/) ?? text.match(/(\d+)\s*天(?:左右)?(?:交货|出货|发货)/) ?? text.match(/lead\s*time[^\d]{0,12}(\d+)\s*days?/i);
  if (lead) add("lead_time_days", lead[0], Number(lead[1]), null);
  const dep = text.match(/(\d{1,3})\s*%\s*(?:的)?(?:定金|订金|预付|deposit)/i) ?? text.match(/(?:定金|订金|预付款?|deposit)\s*(\d{1,3})\s*%/i);
  if (dep) add("deposit_pct", dep[0], Number(dep[1]), null);
  const tooling = text.match(/(?:模具费|开模费|tooling(?:\s*fee)?)[^\d]{0,6}(\d+(?:\.\d+)?)\s*(美金|美元|元|usd)?/i);
  if (tooling) add("tooling_fee", tooling[0], Number(tooling[1]), null, cny(tooling[2]) ? "CNY" : "USD");
  const model = text.match(/\b([A-Z]{1,4}-?\d{2,4}[A-Z]{0,2})\b/);
  if (model) add("product_model", model[0], null, model[1]);

  const tasks: TextExtraction["tasks"] = [];
  const baseDay = localDate(receivedAt);
  const sample = text.match(/样品[^，。,.]*?(?:这|本|下)?(?:周|星期)([一二三四五六日天])(?:前|之前)?[^，。,.]*/);
  if (sample) {
    let diff = (WEEKDAYS[sample[1]] - weekdayOf(baseDay) + 7) % 7;
    if (/下(周|星期)/.test(sample[0])) diff += 7;
    tasks.push({ kind: "promise", who: "counterparty", what: "Send the sample", due: addDays(baseDay, diff), quote_original: sample[0] });
  }
  const dated = text.match(/(\d{4}年)?(\d{1,2})月(\d{1,2})[日号](?:之前|前)[^，。,.]*/);
  if (dated && !sample) {
    const y = dated[1] ? Number(dated[1].slice(0, 4)) : Number(baseDay.slice(0, 4));
    tasks.push({ kind: "deadline", who: "me", what: dated[0].replace(/^.*?[日号](?:之前|前)/, "").trim() || "Deadline", due: `${y}-${dated[2].padStart(2, "0")}-${dated[3].padStart(2, "0")}`, quote_original: dated[0] });
  }
  const subtext = SUBTEXT.flatMap((s) => { const m = text.match(s.re); return m ? [{ phrase: m[0], meaning: s.meaning, risk: s.risk }] : []; });
  const company_names = [...text.matchAll(/[一-鿿]{2,14}(?:有限公司|有限责任公司|股份有限公司|税务局|公安局|出入境管理局|管理局)/g)].map((m) => m[0]);
  return {
    translation: isChinese(text) ? "(English translation needs a live AI model. Key terms were extracted with rules.)" : text,
    subtext, subject: null, facts, tasks, company_names,
  };
}

/** Fallback for text-based documents (HTML/TXT) when no model is available: classify by keywords, pull the obvious fields. */
export function heuristicDocument(name: string, text: string): DocumentExtraction {
  const t = text.slice(0, 5000);
  const rules: [RegExp, keyof typeof DOC_TYPES][] = [
    [/营业执照|business license/i, "business_license"], [/形式发票|proforma/i, "proforma_invoice"], [/报价单|quotation/i, "quotation"],
    [/租赁合同|lease/i, "lease_contract"], [/税务事项通知书|税务|tax notice/i, "tax_notice"], [/居留许可|residence permit/i, "residence_permit"],
    [/护照|passport/i, "passport"], [/certificate of conformity|认证证书|CE\b/i, "certificate"], [/劳动合同|employment contract/i, "employment_contract"],
  ];
  const doc_type = rules.find(([re]) => re.test(t))?.[1] ?? "other";
  const tx = heuristicTextExtraction(t, new Date().toISOString());
  const code = t.match(/\b[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}\b/)?.[0] ?? null;
  const company = t.match(/[一-鿿（）()]{2,20}(?:有限公司|有限责任公司|税务局)/)?.[0] ?? null;
  const role = doc_type === "business_license" ? "subject" : doc_type === "tax_notice" ? "authority" : doc_type === "lease_contract" ? "landlord" : "issuer";
  return {
    doc_type, language: isChinese(t) ? "zh" : "en", confidence: 0.3, title: `${DOC_TYPES[doc_type].label} (${name})`, summary: "Read with rules (no AI model).",
    subject: null, visible_text: t.slice(0, 400), doc_date: null, expiry_date: null,
    parties: company ? [{ role, name: company, name_alt: null, kind: role === "authority" ? "government" : "company", credit_code: code, id_number: null }] : [],
    line_items: [], facts: tx.facts.filter((f) => f.key in FACT_DEFS).map((f) => ({ ...f })), tasks: tx.tasks,
  };
}
