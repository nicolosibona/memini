// Golden answers for the demo files (blueprint §2.7, §19.5). Used ONLY when no AI model is configured (mock)
// or when a live call fails — so the demo never dead-ends. They are also the expected outputs for `npm run test:live`.
import type { DocumentExtraction, TextExtraction } from "@/lib/core/schemas";
import { addDays, localDate, weekdayOf } from "@/lib/db";

export const DEMO_FILES = [
  { file: "abc_business_license.html", label: "营业执照 · ABC license", group: "Sourcing" },
  { file: "abc_proforma_PI-2026-118.html", label: "Proforma PI-2026-118", group: "Sourcing" },
  { file: "abc_ce_certificate.html", label: "CE certificate", group: "Sourcing" },
  { file: "office_lease_contract.html", label: "租赁合同 · office lease", group: "China business" },
  { file: "tax_notice_vat.html", label: "税务事项通知书 · tax notice", group: "China business" },
] as const;

export const DEMO_TEXTS = {
  lisa: "亲，那个65W的充电器，1000个的话每个4.2美金，FOB深圳，交期15天左右。样品我们尽量这周五前寄出，问题不大。",
  landlord: "周先生：合同我已经发您了，您看一下没问题的话就签字。押金这周内转过来，钥匙下周一给您。",
  question: "Is Seller 1 or Seller 2 the better deal?",
} as const;

const ABC = { zh: "深圳市ABC科技有限公司", en: "Shenzhen ABC Technology Co., Ltd.", code: "91440300MA5G7K2C4D" };

export const DOC_FIXTURES: Record<string, DocumentExtraction> = {
  "abc_business_license.html": {
    doc_type: "business_license", language: "zh", confidence: 0.97, title: "Business license – 深圳市ABC科技有限公司",
    summary: "Business license of Shenzhen ABC Technology: active company, scope includes manufacturing chargers.", subject: null,
    visible_text: "营业执照 统一社会信用代码 91440300MA5G7K2C4D 深圳市ABC科技有限公司 王建国 电子产品、充电器、电源适配器的研发、生产与销售",
    doc_date: "2023-06-01", expiry_date: null,
    parties: [{ role: "subject", name: ABC.zh, name_alt: null, kind: "company", credit_code: ABC.code, id_number: null }],
    line_items: [],
    facts: [
      { key: "legal_rep", value_number: null, value_text: "王建国", currency: null, quote_original: "王建国" },
      { key: "reg_capital", value_number: null, value_text: "500万元人民币", currency: null, quote_original: "人民币伍佰万元整" },
      { key: "business_scope", value_number: null, value_text: "电子产品、充电器、电源适配器的研发、生产与销售；货物及技术进出口。", currency: null, quote_original: "电子产品、充电器、电源适配器的研发、生产与销售" },
      { key: "registered_address", value_number: null, value_text: "深圳市宝安区福永街道桥头社区富桥工业区3栋", currency: null, quote_original: "深圳市宝安区福永街道桥头社区富桥工业区3栋" },
    ],
    tasks: [],
  },
  "abc_proforma_PI-2026-118.html": {
    doc_type: "proforma_invoice", language: "mixed", confidence: 0.96, title: "Proforma PI-2026-118",
    summary: "Proforma from Shenzhen ABC for 1,000 × CC-65W chargers at USD 4.20, EXW, 30% deposit; payee is a different company.", subject: "65W USB-C charger",
    visible_text: "PROFORMA INVOICE PI-2026-118 Shenzhen ABC Technology CC-65W 1,000 pcs USD 4.20 EXW Shenzhen 15 days 30% deposit Beneficiary 深圳市鑫达贸易有限公司",
    doc_date: "2026-11-19", expiry_date: null,
    parties: [
      { role: "seller", name: ABC.zh, name_alt: ABC.en, kind: "company", credit_code: ABC.code, id_number: null },
      { role: "buyer", name: "Nordlys Home Goods ApS", name_alt: null, kind: "company", credit_code: null, id_number: null },
      { role: "beneficiary", name: "深圳市鑫达贸易有限公司", name_alt: "Shenzhen Xinda Trading Co., Ltd.", kind: "company", credit_code: null, id_number: null },
    ],
    line_items: [{ model: "CC-65W", description: "65W GaN USB-C charger, EU plug, white", qty: 1000, unit_price: 4.2, currency: "USD" }],
    facts: [
      { key: "incoterm", value_number: null, value_text: "EXW", currency: null, quote_original: "EXW Shenzhen" },
      { key: "port", value_number: null, value_text: "Shenzhen", currency: null, quote_original: "EXW Shenzhen" },
      { key: "lead_time_days", value_number: 15, value_text: null, currency: null, quote_original: "15 days after deposit" },
      { key: "payment_terms", value_number: null, value_text: "30% T/T deposit, 70% balance before shipment", currency: null, quote_original: "30% T/T deposit, 70% balance before shipment" },
      { key: "deposit_pct", value_number: 30, value_text: null, currency: null, quote_original: "30% T/T deposit" },
      { key: "total_amount", value_number: 4200, value_text: null, currency: "USD", quote_original: "USD 4,200.00" },
      { key: "bank_name", value_number: null, value_text: "Bank of China, Shenzhen Futian Sub-branch", currency: null, quote_original: "Bank of China, Shenzhen Futian Sub-branch" },
      { key: "bank_account_country", value_number: null, value_text: "CN", currency: null, quote_original: "Country: China" },
    ],
    tasks: [],
  },
  "abc_ce_certificate.html": {
    doc_type: "certificate", language: "en", confidence: 0.95, title: "CE certificate NTL-CE-2025-06381",
    summary: "CE certificate of conformity for models CC-65W and CC-45W, holder Shenzhen ABC Technology, valid until 2029.", subject: "65W USB-C charger",
    visible_text: "CE CERTIFICATE OF CONFORMITY NTL-CE-2025-06381 Shenzhen ABC Technology Co., Ltd. CC-65W CC-45W valid until 2029-03-09",
    doc_date: "2025-03-10", expiry_date: "2029-03-09",
    parties: [
      { role: "cert_holder", name: ABC.en, name_alt: null, kind: "company", credit_code: null, id_number: null },
      { role: "manufacturer", name: ABC.en, name_alt: null, kind: "company", credit_code: null, id_number: null },
      { role: "lab", name: "Northbridge Testing Laboratory (Shenzhen)", name_alt: null, kind: "company", credit_code: null, id_number: null },
    ],
    line_items: [],
    facts: [
      { key: "cert_type", value_number: null, value_text: "CE", currency: null, quote_original: "CE" },
      { key: "cert_model", value_number: null, value_text: "CC-65W", currency: null, quote_original: "CC-65W" },
      { key: "cert_model", value_number: null, value_text: "CC-45W", currency: null, quote_original: "CC-45W" },
      { key: "cert_lab", value_number: null, value_text: "Northbridge Testing Laboratory (Shenzhen)", currency: null, quote_original: "Northbridge Testing Laboratory (Shenzhen)" },
      { key: "document_number", value_number: null, value_text: "NTL-CE-2025-06381", currency: null, quote_original: "NTL-CE-2025-06381" },
    ],
    tasks: [],
  },
  "office_lease_contract.html": {
    doc_type: "lease_contract", language: "zh", confidence: 0.95, title: "Office lease JA-2026-1203",
    summary: "12-month office lease for Room 1203 from Shanghai Jing'an Property: CNY 19,500/month, CNY 39,000 deposit, rent paid to a personal account (王芳).", subject: "Office, Room 1203",
    visible_text: "房屋租赁合同 JA-2026-1203 上海静安置业有限公司 91310106MA1FL8K30B 月租金人民币19,500元 押金39,000元 户名：王芳",
    doc_date: "2026-11-20", expiry_date: "2027-11-30",
    parties: [
      { role: "landlord", name: "上海静安置业有限公司", name_alt: null, kind: "company", credit_code: "91310106MA1FL8K30B", id_number: null },
      { role: "tenant", name: "诺德利斯（上海）贸易有限公司", name_alt: null, kind: "company", credit_code: null, id_number: null },
      { role: "beneficiary", name: "王芳", name_alt: null, kind: "person", credit_code: null, id_number: null },
    ],
    line_items: [],
    facts: [
      { key: "rent_amount", value_number: 19500, value_text: null, currency: "CNY", quote_original: "月租金为人民币19,500元" },
      { key: "security_deposit", value_number: 39000, value_text: null, currency: "CNY", quote_original: "押金为两个月租金，即人民币39,000元" },
      { key: "rent_due_day", value_number: 5, value_text: null, currency: null, quote_original: "每月5日前支付当月租金" },
      { key: "lease_start", value_number: null, value_text: "2026-12-01", currency: null, quote_original: "自2026年12月1日起" },
      { key: "lease_end", value_number: null, value_text: "2027-11-30", currency: null, quote_original: "至2027年11月30日止" },
      { key: "property_address", value_number: null, value_text: "上海市静安区虹景路88号1203室", currency: null, quote_original: "上海市静安区虹景路88号1203室" },
      { key: "bank_name", value_number: null, value_text: "中国工商银行上海静安支行", currency: null, quote_original: "中国工商银行上海静安支行" },
    ],
    tasks: [{ kind: "payment", who: "me", what: "Pay the security deposit (CNY 39,000) on signing", due: "2026-11-30", quote_original: "于签约时一次性支付" }],
  },
  "tax_notice_vat.html": {
    doc_type: "tax_notice", language: "zh", confidence: 0.96, title: "Tax notice 沪静税通〔2026〕0458",
    summary: "The Jing'an tax bureau says the October VAT return was not filed; file October and November VAT by Dec 15, 2026 or face a fine.", subject: "VAT Oct–Nov 2026",
    visible_text: "国家税务总局上海市静安区税务局 税务事项通知书 增值税 2026年12月15日前 罚款",
    doc_date: "2026-11-18", expiry_date: null,
    parties: [
      { role: "authority", name: "国家税务总局上海市静安区税务局", name_alt: null, kind: "government", credit_code: null, id_number: null },
      { role: "subject", name: "诺德利斯（上海）贸易有限公司", name_alt: null, kind: "company", credit_code: "91310106MA7HX2QT3D", id_number: null },
    ],
    line_items: [],
    facts: [
      { key: "tax_type", value_number: null, value_text: "VAT (增值税)", currency: null, quote_original: "增值税" },
      { key: "tax_period", value_number: null, value_text: "2026-10, 2026-11", currency: null, quote_original: "2026年10月及11月" },
      { key: "filing_deadline", value_number: null, value_text: "2026-12-15", currency: null, quote_original: "于2026年12月15日前" },
      { key: "case_number", value_number: null, value_text: "沪静税通〔2026〕第0458号", currency: null, quote_original: "沪静税通〔2026〕第0458号" },
    ],
    tasks: [{ kind: "deadline", who: "authority", what: "File October + November VAT returns", due: "2026-12-15", quote_original: "请你单位于2026年12月15日前办理2026年10月及11月增值税纳税申报" }],
  },
};

/** Next given weekday on/after the message date (这周五 = this Friday). */
const nextWeekday = (iso: string, wd: number) => { const d = localDate(iso); return addDays(d, (wd - weekdayOf(d) + 7) % 7); };
const nextMonday = (iso: string) => { const d = localDate(iso); return addDays(d, ((1 - weekdayOf(d) + 7) % 7) || 7); };

export const TEXT_FIXTURES: Record<string, (receivedAt: string) => TextExtraction> = {
  [DEMO_TEXTS.lisa]: (at) => ({
    translation: "Dear, for the 65W charger: at 1,000 units it's USD 4.20 each, FOB Shenzhen, lead time about 15 days. We'll try to ship the sample before this Friday, it's not a big problem.",
    subtext: [
      { phrase: "尽量这周五前寄出", meaning: "\"We'll try to ship by Friday\" — a soft promise, not a commitment. Expect a delay.", risk: "medium" },
      { phrase: "问题不大", meaning: "\"Not a big problem\" — usually means there IS a small problem they haven't mentioned.", risk: "medium" },
      { phrase: "交期15天左右", meaning: "\"About 15 days\" — leaves room to slip; get a fixed date in the PI.", risk: "low" },
    ],
    subject: "65W USB-C charger",
    facts: [
      { key: "unit_price", value_number: 4.2, value_text: null, currency: "USD", quote_original: "每个4.2美金" },
      { key: "order_qty", value_number: 1000, value_text: null, currency: null, quote_original: "1000个" },
      { key: "incoterm", value_number: null, value_text: "FOB", currency: null, quote_original: "FOB深圳" },
      { key: "port", value_number: null, value_text: "Shenzhen", currency: null, quote_original: "FOB深圳" },
      { key: "lead_time_days", value_number: 15, value_text: null, currency: null, quote_original: "交期15天左右" },
    ],
    tasks: [{ kind: "promise", who: "counterparty", what: "Ship the sample", due: nextWeekday(at, 5), quote_original: "样品我们尽量这周五前寄出" }],
    company_names: [],
  }),
  [DEMO_TEXTS.landlord]: (at) => ({
    translation: "Mr. Zhou: I've sent you the contract — if it looks fine, please sign. Transfer the deposit within this week; I'll give you the keys next Monday.",
    subtext: [],
    subject: "Office lease",
    facts: [],
    tasks: [
      { kind: "payment", who: "me", what: "Transfer the security deposit", due: nextWeekday(at, 0), quote_original: "押金这周内转过来" },
      { kind: "promise", who: "counterparty", what: "Hand over the keys", due: nextMonday(at), quote_original: "钥匙下周一给您" },
    ],
    company_names: [],
  }),
};
