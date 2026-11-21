// Reading one forwarded item for the spec check. Live: one call (MODEL_SPEC) that classifies, translates line by line
// with the locked glossary and lists every parameter with its source quote. No model or a failed call: the rule reader
// below (glossary + unit parser), so the pipeline always yields a checkable table — and the numbers are never invented.
import fs from "node:fs";
import path from "node:path";
import { callJSON } from "@/lib/adapters/llm";
import { htmlToText, mimeOf, originalFileName } from "../extract";
import { isChinese } from "../normalize";
import { COMPONENTS, KEYWORDS, PARAMS, PARAM_KEYS, SOFT_CLAIMS, TERMS, type ParamKey } from "./params";
import { parseQty, parseRange } from "./quantity";
import { SpecChatSchema, SpecExtractionSchema, type SpecChat, type SpecExtraction, type SpecParamOut } from "./schema";

const GLOSSARY = TERMS.map((t) => `${t.en} = ${t.zh}`).join("\n");

const SYSTEM = `You are a bilingual (English / Simplified Chinese) electronics engineer checking parts bought from Chinese manufacturers. A buyer forwards you items one by one: their own specification or requirements, and the supplier's datasheets (规格书), quotations, test reports, BOMs and WeChat messages.

For the item you get, return ONE JSON object:
- role: "requirement" if it is the buyer's own spec/request (usually English or Italian, "shall", "required", "min."), "supplier" if it comes from the manufacturer (usually Chinese: 规格书, 报价, 测试报告, a chat from 王工/销售). Use the hint about who sent it.
- segments: the technical content line by line, in order, each with a faithful translation (Chinese → English; English/Italian → Simplified Chinese). This translation goes to engineers: keep EVERY number, unit, limit sign (≥ ≤ ~ ±), condition (满载, 25℃, typ.) and part number exactly as written. Never round, never convert units, never drop a limit word (不低于 = at least, 不超过 = at most, 典型值 = typical). Use these locked term translations exactly:
${GLOSSARY}
- parameters: every technical value, with key from the allowed list (use "other" only if nothing fits, keeping the label). If one line holds several values of a sub-part ("输出电容：1000μF/16V 105℃"), return one parameter per value with component = the sub-part in English ("Output capacitor") and the matching key (capacitance, rated_voltage, temp_rating). op: min for ≥/不低于/at least/min., max for ≤/不超过/at most/max., range for from–to, typ for typical/典型值, eq for a plain value, text for words. num/num_max/unit as written. quote = the exact source text.
  Sets (protections, certifications) go in ONE parameter with the items in value.
- notes: claims that need care — a part substituted or called "equivalent"/"参数一样", domestic substitutes (国产替代), typical-only values, vague words (左右, 约, 问题不大), values that depend on a condition.
Never invent a value that is not in the item. Unreadable → leave it out.`;

const CHAT_SYSTEM = `You are a bilingual (English / Simplified Chinese) electronics engineer. A buyer forwards you one WeChat message from a conversation with a Chinese manufacturer: either the buyer's own message (usually English/Italian) or the supplier's (usually Chinese).
Return ONE short JSON object: role, language, a faithful translation of the whole message (keep every number, unit, sign ≥ ≤ ~ and part number exactly; 不低于 = at least, 不超过 = at most, 典型值 = typical), and every technical value as {key, component, value, op}. Several values of one sub-part ("输出电容 1000μF 16V 85℃") → one entry each with component "Output capacitor" and keys capacitance / rated_voltage / temp_rating. Sets (certifications, protections) → one entry. Use these locked terms in translations:
${GLOSSARY}
Be brief. Never invent values.`;

export type ItemInput = { text?: string | null; filePath?: string | null; author?: string | null; hint?: string };

export async function readSpecItem(item: ItemInput): Promise<{ data: SpecExtraction; source: string }> {
  const name = item.filePath ? originalFileName(item.filePath) : null;
  const mime = item.filePath ? mimeOf(item.filePath) : "text/plain";
  let text = item.text ?? "";
  if (item.filePath && (mime === "text/html" || mime === "text/plain")) {
    const raw = fs.readFileSync(item.filePath, "utf8");
    text = mime === "text/html" ? htmlToText(raw) : raw;
  }
  const who = item.author ? `Forwarded chat message written by "${item.author}".` : item.filePath ? `A file forwarded by the buyer: ${name}.` : "A text message the buyer typed or forwarded.";
  const intro = `${who}${item.hint ? ` ${item.hint}` : ""}`;
  const fallback = () => ruleRead(text || demoSourceText(name) || "", { author: item.author, name });
  const base = { step: "spec" as const, system: SYSTEM, schema: SpecExtractionSchema, fallback, timeoutMs: Number(process.env.LLM_TIMEOUT_SPEC_MS ?? 90000) };
  let r;
  if (item.filePath && mime.startsWith("image/")) {
    r = await callJSON({ ...base, text: intro, imageDataUrls: [`data:${mime};base64,${fs.readFileSync(item.filePath).toString("base64")}`] });
  } else if (item.filePath && mime === "application/pdf") {
    r = await callJSON({ ...base, text: intro, pdfBase64: fs.readFileSync(item.filePath).toString("base64") });
  } else if (!item.filePath && text.length < 1500) {
    // a chat message: small fast model + slim output — the reply must feel instant on WeChat; rules if it's late
    const c = await callJSON({
      step: "spec_chat", system: CHAT_SYSTEM, schema: SpecChatSchema, text: `${intro}\n\nMessage:\n${text}`,
      timeoutMs: Number(process.env.LLM_TIMEOUT_SPEC_CHAT_MS ?? 12000), fallback: () => null as unknown as SpecChat,
    });
    if (!c.data) return { data: tidy(fallback()), source: "fallback" };
    return { data: tidy(fromChat(c.data, text, item.author)), source: c.source };
  } else {
    r = await callJSON({ ...base, text: `${intro}\n\nContent:\n${text.slice(0, 30000)}` });
  }
  return { data: tidy(r.data), source: r.source };
}

/** Slim chat reading → the full shape the check stores. */
function fromChat(c: SpecChat, text: string, author?: string | null): SpecExtraction {
  return {
    role: c.role, doc_kind: "chat", language: c.language,
    title: author ? `Message from ${author}` : c.role === "supplier" ? "Supplier message" : "Your message",
    summary_en: c.translation.slice(0, 200), part_name: c.part_name, part_number: c.part_number, supplier_name: null,
    segments: [{ original: text, translation: c.translation }],
    parameters: c.parameters.map((p) => ({ ...p, label: PARAMS[p.key]?.en ?? p.key, num: null, num_max: null, unit: null, quote: p.value })),
    notes: c.notes.slice(0, 2),
  };
}

/** Whatever came back: drop empty values, keep keys in the vocabulary. */
function tidy(x: SpecExtraction): SpecExtraction {
  return {
    ...x,
    parameters: x.parameters.filter((p) => p.value?.trim() && (PARAM_KEYS as string[]).includes(p.key)),
    segments: x.segments.filter((s) => s.original?.trim()).slice(0, 60),
  };
}

/** Demo files (PDF/PNG made from data/demo/spec/*.html): without a model, read their HTML source with the rules. */
function demoSourceText(name: string | null): string | null {
  if (!name) return null;
  const html = path.resolve(process.cwd(), "data/demo/spec", `${name.replace(/\.[a-z0-9]+$/i, "")}.html`);
  return fs.existsSync(html) ? htmlToText(fs.readFileSync(html, "utf8")) : null;
}

// ── rule reader (no AI) ──
const TERMS_ZH = [...TERMS].sort((a, b) => b.zh.length - a.zh.length);
const TERMS_EN = [...TERMS].sort((a, b) => b.en.length - a.en.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Term-by-term translation with the locked glossary: rough, but it can never change a number. */
export function glossaryTranslate(line: string, toZh: boolean): string {
  let out = line;
  if (toZh) {
    for (const t of TERMS_EN) out = out.replace(new RegExp(`\\b${esc(t.en.replace(/\s*\(.*\)$/, ""))}\\b`, "gi"), t.zh);
    return out.replace(/:\s*/g, "：").replace(/\bto\b/g, "~").replace(/\band\b/gi, "和");
  }
  for (const t of TERMS_ZH) out = out.split(t.zh).join(` ${t.en.replace(/\s*\(.*\)$/, "")} `);
  return out.replace(/：/g, ": ").replace(/，/g, ", ").replace(/、/g, ", ").replace(/。/g, ". ").replace(/（/g, " (").replace(/）/g, ") ").replace(/～/g, " ~ ").replace(/\s{2,}/g, " ").trim();
}

function opOf(v: string): SpecParamOut["op"] {
  if (/典型|typ/i.test(v)) return "typ";
  if (/≥|>=|不低于|不小于|至少|\bmin\b|minimum|at least|以上/i.test(v)) return "min";
  if (/≤|<=|不超过|不大于|\bmax\b|maximum|at most|up to|以下|以内/i.test(v)) return "max";
  if (parseRange(v)) return "range";
  return /\d/.test(v) ? "eq" : "text";
}

const COMPONENT_DIMS: Record<string, ParamKey> = { F: "capacitance", V: "rated_voltage", "°C": "temp_rating", Ω: "esr", A: "ripple_current", H: "inductance", h: "lifetime" };

const PN = /\b[A-Z]{1,4}-?\d{3,5}[A-Z]?\b/;

/** A sub-part with several values: "1000μF/16V 105℃", "1000 µF, rated voltage ≥ 25 V, 105 °C". */
function componentParams(comp: (typeof COMPONENTS)[number], label: string, value: string): SpecParamOut[] {
  const out: SpecParamOut[] = [];
  for (const piece of value.split(/[,，/、;；]|(?<=[a-zA-Zµμ°℃Ω%])\s+(?=[\d≥≤<>])/)) {
    const q = parseQty(piece.replace(/^[^\d+-]*/, ""));
    if (!q?.dim || !COMPONENT_DIMS[q.dim]) continue;
    const val = piece.replace(/^[^\d≥≤<>~+-]*/, "").trim(); // "rated voltage ≥ 25 V" → "≥ 25 V"
    out.push({ key: COMPONENT_DIMS[q.dim], component: comp.en, label: label.slice(0, 40), value: val, op: opOf(piece), num: q.value, num_max: null, unit: q.dim, quote: piece.trim() });
  }
  return out;
}

function valueParam(key: ParamKey, label: string, value: string, quote: string): SpecParamOut[] {
  if (key === "part_number") {
    const pn = (value.match(PN) ?? label.match(PN))?.[0];
    return pn ? [{ key, component: null, label, value: pn, op: "text", num: null, num_max: null, unit: null, quote: pn }] : [];
  }
  const isSet = PARAMS[key].rule === "includes" || PARAMS[key].rule === "text";
  if (!isSet && !/\d/.test(value)) return [];
  const op = isSet ? "text" : opOf(value);
  const q = parseQty(value.replace(/^[^\d+-]*/, ""));
  return [{ key, component: null, label, value: value.trim(), op, num: q?.value ?? null, num_max: null, unit: q?.dim ?? null, quote }];
}

/** Chat prose: "纹波≤150mV，效率88%（典型值）", "we need ripple ≤ 120 mV, efficiency ≥ 88%". A clause naming a sub-part
 *  without values carries it to the next clause ("输出电容我们换成国产的了，1000μF 16V 85℃"). */
function proseParams(line: string): SpecParamOut[] {
  const out: SpecParamOut[] = [];
  let carry: (typeof COMPONENTS)[number] | null = null;
  for (const part of line.split(/[，,。;；!！?？:：]/).map((x) => x.trim()).filter(Boolean)) {
    const comp = COMPONENTS.map((c) => ({ c, m: part.match(c.re) })).find((x) => x.m);
    if (comp) {
      carry = comp.c;
      out.push(...componentParams(comp.c, comp.m![0], part.slice(comp.m!.index! + comp.m![0].length)));
      continue;
    }
    const kw = KEYWORDS.map(([re, key]) => ({ key, m: part.match(re) })).find((x) => x.m && (PARAMS[x.key].group !== "Identity" || x.key === "part_number"));
    if (carry && (!kw || PARAMS[kw.key].group === "Component")) {
      const got = componentParams(carry, carry.en, part);
      if (got.length) { out.push(...got); continue; }
    }
    carry = null;
    if (!kw) continue;
    const value = part.slice(kw.m!.index! + kw.m![0].length).replace(/^[A-Za-z]+/, "").replace(/^[\s是为有在:：]+/, ""); // "operating temp|erature -20…"
    out.push(...valueParam(kw.key, kw.m![0], value, part));
  }
  return out;
}

export function ruleRead(text: string, ctx: { author?: string | null; name?: string | null } = {}): SpecExtraction {
  const zh = isChinese(text);
  const lines = text.split(/\n+/).map((l) => l.replace(/^\s*(?:\d{1,2}[.)、]|\d{1,2}\s+(?=[A-Za-z一-鿿])|[-•*])\s*/, "").trim()).filter((l) => l.length > 1);
  const parameters: SpecParamOut[] = [];
  const segments: SpecExtraction["segments"] = [];
  const notes: SpecExtraction["notes"] = [];
  for (const line of lines) {
    const toZh = !/[一-鿿]/.test(line); // any Chinese in the line → it is the supplier's, translate to English
    segments.push({ original: line, translation: glossaryTranslate(line, toZh) });
    for (const s of SOFT_CLAIMS) { const m = line.match(s.re); if (m) notes.push({ text_en: s.en, quote: m[0], risk: s.risk }); }
    // "Label: value", or a table row flattened to "标签 值" (label first, value after the first space)
    let colon = line.search(/[:：]/);
    if (colon < 0) {
      const head = KEYWORDS.map(([re]) => line.match(re)).find((m) => m && m.index! <= 2) ?? COMPONENTS.map((c) => line.match(c.re)).find((m) => m && m.index! <= 2);
      const sp = head ? line.slice(head.index! + head[0].length).search(/\s/) : -1;
      if (head && sp >= 0) colon = head.index! + head[0].length + sp;
    }
    const label = colon > 0 ? line.slice(0, colon) : line;
    const value = colon > 0 ? line.slice(colon + 1).trim() : line;
    const before = parameters.length;
    const kw = KEYWORDS.find(([re]) => re.test(label));
    const comp = COMPONENTS.find((c) => c.re.test(label));
    if (comp && (!kw || PARAMS[kw[1]].group === "Component" || kw[1] === "rated_voltage")) parameters.push(...componentParams(comp, label, value));
    else if (kw && colon > 0) parameters.push(...valueParam(kw[1], label, value, line));
    // nothing structured on this line → read it as chat prose, clause by clause
    if (parameters.length === before) parameters.push(...proseParams(line));
  }
  const pn = text.match(PN)?.[0] ?? null;
  const supplier = text.match(/[一-鿿]{2,20}(?:有限公司|科技|电子厂)/)?.[0] ?? null;
  const role = zh ? "supplier" : "requirement";
  return {
    role, doc_kind: ctx.author ? "chat" : role === "supplier" ? (/规格书/.test(text) ? "datasheet" : "chat") : "spec",
    language: zh ? (/[a-z]{4,}/i.test(text.replace(/[A-Z]{2,}|\d/g, "")) ? "mixed" : "zh") : "en",
    title: ctx.name ?? (role === "supplier" ? (ctx.author ? `Message from ${ctx.author}` : "Supplier message") : "Your requirements"),
    summary_en: role === "supplier" ? `Supplier content, ${parameters.length} values read with rules.` : `Your requirements, ${parameters.length} values read with rules.`,
    part_name: null, part_number: pn, supplier_name: supplier, segments: segments.slice(0, 60), parameters, notes,
  };
}
