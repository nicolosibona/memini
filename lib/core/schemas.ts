// LLM output schemas (§11, generalized). Built from the domain registry so a new document type or fact key
// needs no schema change. Kept flat and small so they work as Claude structured outputs (output_config.format).
import { z } from "zod";
import { DOC_TYPE_KEYS, FACT_KEYS, PARTY_ROLE_KEYS, TASK_WHO, TASK_KINDS } from "./domain";

export { FACT_KEYS, type FactKey, type DocType } from "./domain";

/** Stored fact values: money {amount,currency}; number {value:number}; text/date {value:string} (dates ISO). */
export type FactValue = { amount: number; currency: string } | { value: number } | { value: string };

const ExtractedFact = z.object({
  key: z.enum(FACT_KEYS),
  value_number: z.number().nullable(),
  value_text: z.string().nullable().describe("Text value; dates as YYYY-MM-DD"),
  currency: z.string().nullable().describe("ISO currency for money values: USD, CNY, EUR…"),
  quote_original: z.string().describe("Exact substring of the source where this value appears"),
});

const ExtractedTask = z.object({
  kind: z.enum(TASK_KINDS),
  who: z.enum(TASK_WHO).describe("counterparty = the other side promised it; me = the user must do it; authority = a government deadline"),
  what: z.string().describe("Short English description, e.g. 'File November VAT return'"),
  due: z.string().nullable().describe("YYYY-MM-DD, resolved relative to the message/document date; null if no date"),
  quote_original: z.string(),
});

export const PartySchema = z.object({
  role: z.enum(PARTY_ROLE_KEYS),
  name: z.string().describe("Exactly as printed (Chinese stays Chinese)"),
  name_alt: z.string().nullable().describe("The other-language name if also printed"),
  kind: z.enum(["company", "person", "government", "unknown"]),
  credit_code: z.string().nullable().describe("18-char 统一社会信用代码 if printed next to this party"),
  id_number: z.string().nullable().describe("Passport / ID / permit number for persons"),
});
export type Party = z.infer<typeof PartySchema>;

export const DocumentExtractionSchema = z.object({
  doc_type: z.enum(DOC_TYPE_KEYS),
  language: z.enum(["zh", "en", "mixed", "other"]),
  confidence: z.number().describe("0–1"),
  title: z.string().describe("Short human title, e.g. 'Proforma PI-2026-118' or 'Lease contract – Room 1203'"),
  summary: z.string().describe("One or two English sentences: what this document is and what matters in it"),
  subject: z.string().nullable().describe("What it is about in a few words: the product ('65W USB-C charger'), the property, the tax period, the person…"),
  visible_text: z.string().describe("Key visible text (names, numbers, dates), for search"),
  doc_date: z.string().nullable().describe("YYYY-MM-DD"),
  expiry_date: z.string().nullable().describe("YYYY-MM-DD, if the document itself expires (permit, certificate, lease end)"),
  parties: z.array(PartySchema),
  line_items: z.array(z.object({ model: z.string().nullable(), description: z.string().nullable(), qty: z.number().nullable(), unit_price: z.number().nullable(), currency: z.string().nullable() })),
  facts: z.array(ExtractedFact),
  tasks: z.array(ExtractedTask),
});
export type DocumentExtraction = z.infer<typeof DocumentExtractionSchema>;

export const TextExtractionSchema = z.object({
  translation: z.string(),
  subtext: z.array(z.object({ phrase: z.string(), meaning: z.string(), risk: z.enum(["low", "medium", "high"]) })),
  subject: z.string().nullable().describe("Product / topic discussed, if clear (e.g. '65W USB-C charger')"),
  facts: z.array(ExtractedFact),
  tasks: z.array(ExtractedTask),
  company_names: z.array(z.string()).describe("Company or office names literally written in the message (not WeChat nicknames)"),
});
export type TextExtraction = z.infer<typeof TextExtractionSchema>;

export const IntentSchema = z.object({
  intent: z.enum(["content", "question", "command"]),
  confidence: z.number(),
});

export const DraftSchema = z.object({
  summary_en: z.string().describe("One sentence for the user"),
  reply_zh: z.string().describe("Chinese message to send to the counterparty; empty string if no reply makes sense (e.g. a government notice)"),
  next_steps: z.array(z.string()).describe("Up to 3 concrete next steps for the user, in English"),
  extra_alerts: z.array(z.object({ title: z.string(), detail: z.string() })),
});
