// Domain registry: the ONE place that says what kinds of things Memini organizes.
// The core is generic: counterparties (entities), matters (pratiche/cases), documents, facts, tasks/deadlines, alerts.
// A workspace PROFILE decides which matter kinds are active; adding a new kind of bureaucracy = adding config here.

// ── profiles (each user has a different scope) ──
export const PROFILES = {
  sourcing: {
    label: "Sourcing buyer",
    description: "Buys from Chinese suppliers from abroad: quotes, proformas, licenses, certificates, payments.",
    matterKinds: ["purchase", "logistics", "general"],
    entityKinds: ["supplier", "logistics", "bank", "service_provider", "other"],
  },
  china_business: {
    label: "Doing business in China",
    description: "Lives or runs a company in China: suppliers and customers, plus visas, company paperwork, tax, lease, banking and their deadlines.",
    matterKinds: ["purchase", "sale", "company", "residence_permit", "tax", "lease", "banking", "hr", "logistics", "legal", "general"],
    entityKinds: ["supplier", "customer", "government", "service_provider", "landlord", "bank", "logistics", "employee", "self_company", "self_person", "other"],
  },
} as const;
export type ProfileKey = keyof typeof PROFILES;

// ── counterparties ──
export const ENTITY_KINDS = {
  supplier: { label: "Supplier", plural: "Suppliers", icon: "🏭" },
  customer: { label: "Customer", plural: "Customers", icon: "🤝" },
  government: { label: "Government office", plural: "Government offices", icon: "🏛️" },
  service_provider: { label: "Service provider", plural: "Service providers", icon: "🧾" }, // agent, accountant, lawyer
  landlord: { label: "Landlord", plural: "Landlords", icon: "🏢" },
  bank: { label: "Bank", plural: "Banks", icon: "🏦" },
  logistics: { label: "Logistics", plural: "Logistics", icon: "🚢" },
  employee: { label: "Employee", plural: "Employees", icon: "👤" },
  self_company: { label: "Your company", plural: "Your companies", icon: "🏠" },
  self_person: { label: "You / your people", plural: "You / your people", icon: "🪪" },
  other: { label: "Other", plural: "Other", icon: "•" },
} as const;
export type EntityKind = keyof typeof ENTITY_KINDS;
export const SELF_KINDS: EntityKind[] = ["self_company", "self_person"];

// ── matter kinds (declared up front: documents and playbooks reference each other) ──
export type MatterKind = "purchase" | "sale" | "logistics" | "company" | "residence_permit" | "tax" | "lease" | "banking" | "hr" | "legal" | "general";

// ── documents ──
type DocDef = { label: string; zh: string; matterKind: MatterKind; expiryLeadDays?: number };
export const DOC_TYPES = {
  business_license: { label: "Business license", zh: "营业执照", matterKind: "purchase" },
  quotation: { label: "Quotation", zh: "报价单", matterKind: "purchase" },
  proforma_invoice: { label: "Proforma invoice", zh: "形式发票", matterKind: "purchase" },
  purchase_contract: { label: "Purchase contract", zh: "采购合同", matterKind: "purchase" },
  certificate: { label: "Product certificate", zh: "认证证书", matterKind: "purchase", expiryLeadDays: 60 },
  test_report: { label: "Test report", zh: "检测报告", matterKind: "purchase" },
  bank_details: { label: "Bank details", zh: "收款信息", matterKind: "purchase" },
  commercial_invoice: { label: "Commercial invoice", zh: "商业发票", matterKind: "purchase" },
  fapiao: { label: "Fapiao (tax invoice)", zh: "发票", matterKind: "tax" },
  packing_list: { label: "Packing list", zh: "装箱单", matterKind: "logistics" },
  bill_of_lading: { label: "Bill of lading", zh: "提单", matterKind: "logistics" },
  customs_declaration: { label: "Customs declaration", zh: "报关单", matterKind: "logistics" },
  passport: { label: "Passport", zh: "护照", matterKind: "residence_permit", expiryLeadDays: 180 },
  visa: { label: "Visa", zh: "签证", matterKind: "residence_permit", expiryLeadDays: 30 },
  residence_permit: { label: "Residence permit", zh: "居留许可", matterKind: "residence_permit", expiryLeadDays: 45 },
  work_permit: { label: "Work permit", zh: "工作许可证", matterKind: "residence_permit", expiryLeadDays: 45 },
  registration_form: { label: "Accommodation registration", zh: "住宿登记表", matterKind: "residence_permit" },
  health_certificate: { label: "Health certificate", zh: "体检证明", matterKind: "residence_permit", expiryLeadDays: 30 },
  criminal_record: { label: "Criminal record certificate", zh: "无犯罪记录证明", matterKind: "residence_permit" },
  degree_certificate: { label: "Degree certificate", zh: "学历证明", matterKind: "residence_permit" },
  employment_contract: { label: "Employment contract", zh: "劳动合同", matterKind: "hr" },
  articles_of_association: { label: "Articles of association", zh: "公司章程", matterKind: "company" },
  company_registration: { label: "Company registration filing", zh: "工商登记", matterKind: "company" },
  lease_contract: { label: "Lease contract", zh: "租赁合同", matterKind: "lease", expiryLeadDays: 60 },
  tax_notice: { label: "Tax notice", zh: "税务通知", matterKind: "tax" },
  tax_return: { label: "Tax return", zh: "纳税申报表", matterKind: "tax" },
  government_notice: { label: "Government notice", zh: "政府通知", matterKind: "general" },
  bank_statement: { label: "Bank statement", zh: "银行对账单", matterKind: "banking" },
  contract: { label: "Contract", zh: "合同", matterKind: "legal", expiryLeadDays: 60 },
  receipt: { label: "Receipt", zh: "收据", matterKind: "general" },
  chat_screenshot: { label: "Chat screenshot", zh: "聊天截图", matterKind: "general" },
  other: { label: "Other document", zh: "其他", matterKind: "general" },
} as const satisfies Record<string, DocDef>;
export type DocType = keyof typeof DOC_TYPES;
export const DOC_TYPE_KEYS = Object.keys(DOC_TYPES) as [DocType, ...DocType[]];

// ── matters (pratiche) and their playbooks ──
type ChecklistItem = { doc: DocType; required: boolean; note?: string };
type MatterDef = { label: string; icon: string; titleHint: string; checklist: ChecklistItem[]; counterpartyKinds: EntityKind[] };
export const MATTER_KINDS = {
  purchase: {
    label: "Purchase", icon: "📦", titleHint: "Purchase from {entity}",
    counterpartyKinds: ["supplier"],
    checklist: [
      { doc: "business_license", required: true }, { doc: "proforma_invoice", required: true },
      { doc: "certificate", required: false, note: "CE / FCC / RoHS as your market requires" }, { doc: "bank_details", required: true },
    ],
  },
  sale: { label: "Sale", icon: "🤝", titleHint: "Sale to {entity}", counterpartyKinds: ["customer"], checklist: [{ doc: "purchase_contract", required: true }, { doc: "fapiao", required: false }] },
  logistics: {
    label: "Shipment", icon: "🚢", titleHint: "Shipment", counterpartyKinds: ["logistics", "supplier"],
    checklist: [{ doc: "commercial_invoice", required: true }, { doc: "packing_list", required: true }, { doc: "bill_of_lading", required: true }, { doc: "customs_declaration", required: false }],
  },
  company: {
    label: "Company & licenses", icon: "🏢", titleHint: "Company paperwork", counterpartyKinds: ["government", "service_provider"],
    checklist: [{ doc: "business_license", required: true }, { doc: "articles_of_association", required: true }, { doc: "lease_contract", required: true, note: "registered address" }],
  },
  residence_permit: {
    label: "Visa & residence permit", icon: "🪪", titleHint: "Residence permit – {person}", counterpartyKinds: ["government", "service_provider", "self_person"],
    checklist: [
      { doc: "passport", required: true }, { doc: "work_permit", required: true }, { doc: "registration_form", required: true, note: "police registration within 24 h of moving" },
      { doc: "health_certificate", required: true }, { doc: "employment_contract", required: true }, { doc: "residence_permit", required: false, note: "current permit, for renewals" },
    ],
  },
  tax: { label: "Tax & accounting", icon: "🧾", titleHint: "Tax & accounting", counterpartyKinds: ["government", "service_provider"], checklist: [{ doc: "tax_return", required: false }, { doc: "fapiao", required: false }] },
  lease: { label: "Lease", icon: "🔑", titleHint: "Lease – {entity}", counterpartyKinds: ["landlord", "service_provider"], checklist: [{ doc: "lease_contract", required: true }, { doc: "business_license", required: false, note: "landlord's, if a company" }, { doc: "bank_details", required: true }] },
  banking: { label: "Banking", icon: "🏦", titleHint: "Bank account", counterpartyKinds: ["bank"], checklist: [{ doc: "business_license", required: true }, { doc: "passport", required: true }] },
  hr: { label: "Staff", icon: "👥", titleHint: "Staff – {entity}", counterpartyKinds: ["employee", "service_provider"], checklist: [{ doc: "employment_contract", required: true }] },
  legal: { label: "Contract / legal", icon: "⚖️", titleHint: "Contract with {entity}", counterpartyKinds: ["other", "service_provider", "customer", "supplier"], checklist: [{ doc: "contract", required: true }] },
  general: { label: "General", icon: "📁", titleHint: "General", counterpartyKinds: ["other"], checklist: [] },
} as const satisfies Record<MatterKind, MatterDef>;
export const MATTER_KIND_KEYS = Object.keys(MATTER_KINDS) as [MatterKind, ...MatterKind[]];

// ── parties on a document and whether they IDENTIFY the counterparty (§5.2 generalized) ──
export const PARTY_ROLES = {
  seller: { identifies: true },
  issuer: { identifies: true }, // company that issued a quotation / invoice / notice
  subject: { identifies: true }, // the company a license is about, the person a passport/permit is about
  authority: { identifies: true }, // government office issuing a notice
  landlord: { identifies: true },
  employer: { identifies: true },
  agent: { identifies: true },
  customer: { identifies: true },
  buyer: { identifies: false }, // usually you
  tenant: { identifies: false },
  employee: { identifies: false },
  payer: { identifies: false },
  beneficiary: { identifies: false }, // NEVER used for matching — it's what we audit
  cert_holder: { identifies: false },
  manufacturer: { identifies: false },
  lab: { identifies: false },
  other: { identifies: false },
} as const;
export type PartyRole = keyof typeof PARTY_ROLES;
export const PARTY_ROLE_KEYS = Object.keys(PARTY_ROLES) as [PartyRole, ...PartyRole[]];

// ── closed fact vocabulary (§4.3 generalized). compare = doc-vs-conversation check in the audit ──
type FactDef = { label: string; type: "money" | "number" | "text" | "date"; group: string; compare?: { code: string; severity: "red" | "amber"; when?: "differs" | "higher" | "longer" } };
export const FACT_DEFS = {
  // commerce
  unit_price: { label: "Unit price", type: "money", group: "price", compare: { code: "PRICE_CHANGED", severity: "red" } },
  price_tier: { label: "Price tier", type: "money", group: "price" },
  total_amount: { label: "Total amount", type: "money", group: "price", compare: { code: "AMOUNT_CHANGED", severity: "red" } },
  tooling_fee: { label: "Tooling fee", type: "money", group: "price" },
  sample_fee: { label: "Sample fee", type: "money", group: "price" },
  other_fee: { label: "Other fee", type: "money", group: "price" },
  moq: { label: "MOQ", type: "number", group: "quantity", compare: { code: "MOQ_CHANGED", severity: "amber" } },
  order_qty: { label: "Order quantity", type: "number", group: "quantity" },
  incoterm: { label: "Incoterm", type: "text", group: "delivery", compare: { code: "INCOTERM_CHANGED", severity: "red" } },
  port: { label: "Port", type: "text", group: "delivery" },
  lead_time_days: { label: "Lead time (days)", type: "number", group: "delivery", compare: { code: "LEAD_TIME_CHANGED", severity: "amber", when: "longer" } },
  sample_lead_time_days: { label: "Sample lead time (days)", type: "number", group: "delivery" },
  ship_date: { label: "Ship date", type: "date", group: "delivery" },
  payment_terms: { label: "Payment terms", type: "text", group: "payment" },
  deposit_pct: { label: "Deposit %", type: "number", group: "payment", compare: { code: "PAYMENT_TERMS_CHANGED", severity: "red", when: "higher" } },
  bank_beneficiary_name: { label: "Payee (beneficiary)", type: "text", group: "payment" },
  bank_account_country: { label: "Bank country", type: "text", group: "payment" },
  bank_name: { label: "Bank", type: "text", group: "payment" },
  product_model: { label: "Product model", type: "text", group: "product" },
  spec_item: { label: "Spec", type: "text", group: "product" },
  packaging: { label: "Packaging", type: "text", group: "product" },
  warranty: { label: "Warranty", type: "text", group: "product" },
  // company identity
  legal_name_zh: { label: "Legal name (ZH)", type: "text", group: "company" },
  legal_name_en: { label: "Legal name (EN)", type: "text", group: "company" },
  credit_code: { label: "Credit code", type: "text", group: "company" },
  legal_rep: { label: "Legal representative", type: "text", group: "company" },
  reg_capital: { label: "Registered capital", type: "text", group: "company" },
  business_scope: { label: "Business scope", type: "text", group: "company" },
  registered_address: { label: "Registered address", type: "text", group: "company" },
  // certificates
  cert_type: { label: "Certificate type", type: "text", group: "certificate" },
  cert_holder: { label: "Certificate holder", type: "text", group: "certificate" },
  cert_model: { label: "Certified model", type: "text", group: "certificate" },
  cert_lab: { label: "Test lab", type: "text", group: "certificate" },
  // any document
  document_number: { label: "Document number", type: "text", group: "document" },
  holder_name: { label: "Holder name", type: "text", group: "document" },
  nationality: { label: "Nationality", type: "text", group: "document" },
  issue_date: { label: "Issue date", type: "date", group: "document" },
  expiry_date: { label: "Expiry date", type: "date", group: "document" },
  issuing_authority: { label: "Issuing authority", type: "text", group: "document" },
  // lease
  rent_amount: { label: "Rent (per month)", type: "money", group: "lease", compare: { code: "AMOUNT_CHANGED", severity: "red" } },
  security_deposit: { label: "Security deposit", type: "money", group: "lease", compare: { code: "AMOUNT_CHANGED", severity: "red" } },
  rent_due_day: { label: "Rent due day", type: "number", group: "lease" },
  lease_start: { label: "Lease start", type: "date", group: "lease" },
  lease_end: { label: "Lease end", type: "date", group: "lease" },
  property_address: { label: "Property address", type: "text", group: "lease" },
  // tax & government
  tax_period: { label: "Tax period", type: "text", group: "tax" },
  tax_type: { label: "Tax type", type: "text", group: "tax" },
  amount_due: { label: "Amount due", type: "money", group: "tax" },
  penalty_amount: { label: "Penalty", type: "money", group: "tax" },
  filing_deadline: { label: "Filing deadline", type: "date", group: "tax" },
  case_number: { label: "Case / reference no.", type: "text", group: "government" },
  appointment_date: { label: "Appointment", type: "date", group: "government" },
  // people
  salary_amount: { label: "Salary", type: "money", group: "hr", compare: { code: "AMOUNT_CHANGED", severity: "red" } },
  contact_phone: { label: "Phone", type: "text", group: "contact" },
} as const satisfies Record<string, FactDef>;
export type FactKey = keyof typeof FACT_DEFS;
export const FACT_KEYS = Object.keys(FACT_DEFS) as [FactKey, ...FactKey[]];
export const factDef = (k: string): FactDef | undefined => (FACT_DEFS as Record<string, FactDef>)[k];

// ── tasks / deadlines ──
export const TASK_KINDS = ["promise", "deadline", "renewal", "payment", "appointment", "todo"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_WHO = ["counterparty", "me", "authority"] as const;
export type TaskWho = (typeof TASK_WHO)[number];

export function profileOf(key: string | null | undefined) {
  return PROFILES[(key ?? "china_business") as ProfileKey] ?? PROFILES.china_business;
}
export const matterKindsFor = (profile: string | null | undefined) => profileOf(profile).matterKinds as readonly MatterKind[];
