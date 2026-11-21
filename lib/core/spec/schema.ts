// What the model returns for one forwarded item (spec, datasheet, quote, test report, chat): who wrote it, a faithful
// technical translation line by line, and every parameter with its exact source text. Flat and small (works through
// the gateway with the schema in the prompt).
import { z } from "zod";
import { PARAM_KEYS } from "./params";

export const SpecParamSchema = z.object({
  key: z.enum(PARAM_KEYS),
  component: z.string().nullable().describe("English name of the sub-part this value is about (e.g. 'Output capacitor'), null if it is about the product itself"),
  label: z.string().describe("Parameter name exactly as written in the source"),
  value: z.string().describe("The value exactly as written, with its limit sign and unit (e.g. '≤150mVp-p', '-10℃~+50℃', '1000μF/16V', 'CE, RoHS')"),
  op: z.enum(["eq", "min", "max", "range", "typ", "text"]).describe("min = at least (≥, 不低于, min.), max = at most (≤, 不超过, max.), range = from–to, typ = typical/典型值, eq = exact value, text = words"),
  num: z.number().nullable().describe("The number (the lower bound for a range), in the unit below"),
  num_max: z.number().nullable().describe("Upper bound of a range, else null"),
  unit: z.string().nullable().describe("Unit as written (mV, V, A, W, %, ℃, μF, Ω, Hz, mm, m, g, h…)"),
  quote: z.string().describe("Exact substring of the source where this value appears"),
});
export type SpecParamOut = z.infer<typeof SpecParamSchema>;

export const SpecExtractionSchema = z.object({
  role: z.enum(["requirement", "supplier", "unclear"]).describe("requirement = the buyer's own specification, drawing or request; supplier = the manufacturer's datasheet, quotation, test report, sample report or chat message"),
  doc_kind: z.enum(["spec", "datasheet", "quotation", "test_report", "bom", "chat", "other"]),
  language: z.enum(["zh", "en", "it", "mixed", "other"]),
  title: z.string().describe("Short title, e.g. 'Supplier datasheet PS-1205' or 'Our requirements – 12 V 5 A PSU'"),
  summary_en: z.string().describe("One English sentence: what this is"),
  part_name: z.string().nullable().describe("The product or part in English, e.g. '12 V 5 A switching power supply'"),
  part_number: z.string().nullable(),
  supplier_name: z.string().nullable().describe("The manufacturer's company name if printed"),
  segments: z.array(z.object({
    original: z.string().describe("One technical line or sentence, exactly as written"),
    translation: z.string().describe("Its translation: into English if the original is Chinese, into Simplified Chinese if the original is English/Italian. Keep every number, unit, sign (≥ ≤ ~) and part number exactly"),
  })).describe("The technical content line by line, in order (at most 40 lines; skip logos, addresses and boilerplate)"),
  parameters: z.array(SpecParamSchema),
  notes: z.array(z.object({ text_en: z.string(), quote: z.string(), risk: z.enum(["low", "medium", "high"]) }))
    .describe("Claims that need care: a part substituted or 'equivalent', 'same parameters', typical-only values, vague words (左右, 约, 问题不大), conditions that change a value"),
});
export type SpecExtraction = z.infer<typeof SpecExtractionSchema>;
