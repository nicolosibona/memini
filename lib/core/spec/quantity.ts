// Physical quantities, written any way (16V, 16 伏, 1000μF, 1,000 uF, -10℃～+50℃, ≤150mVp-p, 50K小时):
// parsed to a base value + dimension so "150 mV" and "0.15 V" compare equal. Pure functions, no AI.
import type { Dim } from "./params";

const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

/** Unit text → [prefix multiplier, dimension]. Chinese units and common spellings included. */
export function parseUnit(raw: string | null | undefined): { mul: number; dim: Dim } | null {
  if (!raw) return null;
  let u = raw.trim().replace(/\s+/g, "").replace(/[（(].*?[)）]/g, "");
  const zh: [RegExp, string][] = [
    [/^毫伏/, "mV"], [/^伏(?:特)?/, "V"], [/^毫安/, "mA"], [/^安(?:培)?/, "A"], [/^毫瓦/, "mW"], [/^千瓦/, "kW"], [/^瓦(?:特)?/, "W"],
    [/^微法/, "µF"], [/^纳法/, "nF"], [/^皮法/, "pF"], [/^法拉?/, "F"], [/^毫欧/, "mΩ"], [/^千欧/, "kΩ"], [/^兆欧/, "MΩ"], [/^欧(?:姆)?/, "Ω"],
    [/^微亨/, "µH"], [/^毫亨/, "mH"], [/^千赫兹?/, "kHz"], [/^兆赫兹?/, "MHz"], [/^赫兹?/, "Hz"], [/^摄氏度|^度/, "°C"],
    [/^万小时/, "10kh"], [/^千小时/, "kh"], [/^小时/, "h"], [/^毫米/, "mm"], [/^厘米/, "cm"], [/^米/, "m"], [/^千克|^公斤/, "kg"], [/^克/, "g"], [/^分贝/, "dB"],
  ];
  for (const [re, rep] of zh) if (re.test(u)) { u = rep; break; }
  if (u === "10kh") return { mul: 1e4, dim: "h" };
  u = u.replace(/℃/g, "°C").replace(/^(?:deg)?C$/i, "°C").replace(/^º/, "°");
  if (/^°C|^°$/.test(u)) return { mul: 1, dim: "°C" };
  if (/^%/.test(u)) return { mul: 1, dim: "%" };
  if (/^dB/i.test(u)) return { mul: 1, dim: "dB" };
  if (/^(hours?|hrs?|h)$/i.test(u)) return { mul: 1, dim: "h" };
  if (/^k(hours?|hrs?|h)$/i.test(u)) return { mul: 1e3, dim: "h" };
  u = u.replace(/Ω/g, "Ω");
  if (/^(ohms?|Ω)$/i.test(u)) return { mul: 1, dim: "Ω" };
  if (/^mm$/i.test(u)) return { mul: 1e-3, dim: "m" };
  if (/^cm$/i.test(u)) return { mul: 1e-2, dim: "m" };
  if (/^kg$/i.test(u)) return { mul: 1e3, dim: "g" };
  const m = u.match(/^([pnuµμmkKMGPNU]?)(Hz|V|A|W|F|Ω|ohms?|H|m|g)(?:p-?p|pp|ac|dc|rms)?$/i);
  if (!m) return null;
  // datasheets often write prefixes in capitals: 1000UF = 1000 µF, 100NF = 100 nF. M stays mega (MΩ, MHz).
  const p = /^[PNU]$/.test(m[1]) ? m[1].toLowerCase() : m[1];
  const d = m[2].toLowerCase();
  const dim: Dim = d === "hz" ? "Hz" : d === "v" ? "V" : d === "a" ? "A" : d === "w" ? "W" : d === "f" ? "F" : d === "h" ? "H" : d === "m" ? "m" : d === "g" ? "g" : "Ω";
  if (p === "M" && (dim === "m" || dim === "g")) return null;
  return { mul: PREFIX[p] ?? 1, dim };
}

const half = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/．/g, ".").replace(/，(?=\d{3}\b)/g, ",").replace(/－/g, "-").replace(/＋/g, "+");
const num = (s: string) => Number(s.replace(/,/g, ""));

export type Qty = { value: number; dim: Dim };
/** "16V" → {16, V}; "1,000 μF" → {0.001, F}. Null when there is no number. */
export function parseQty(text: string, defaultDim: Dim = null): Qty | null {
  const t = half(text);
  const m = t.match(/([-+]?\d[\d,]*(?:\.\d+)?)\s*([a-zA-Zµμ°℃%Ω伏安瓦法欧赫摄度小时毫微纳皮千兆万米克分贝特-]*)/);
  if (!m) return null;
  const u = parseUnit(m[2].replace(/-+$/, ""));
  if (u) return { value: num(m[1]) * u.mul, dim: u.dim };
  return { value: num(m[1]), dim: defaultDim };
}

/** Engineering display: 0.00047 F → "470 µF", 0.15 V → "150 mV", 50000 h → "50,000 h". */
export function fmtQty(q: Qty | null | undefined): string {
  if (!q || !Number.isFinite(q.value)) return "—";
  const { value: v, dim } = q;
  if (!dim || ["%", "°C", "h", "dB"].includes(dim)) return `${round(v).toLocaleString("en-US")}${dim ? (dim === "%" ? "%" : ` ${dim}`) : ""}`;
  if (dim === "m" && Math.abs(v) < 1) return `${round(v * 1000)} mm`;
  if (dim === "g" && Math.abs(v) >= 1000) return `${round(v / 1000)} kg`;
  const steps: [number, string][] = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const a = Math.abs(v);
  const [mul, p] = a === 0 ? [1, ""] : steps.find(([s]) => a >= s * 0.9999) ?? steps[steps.length - 1];
  return `${round(v / mul)} ${p}${dim}`;
}
const round = (x: number) => Math.round(x * 1000) / 1000;

export type Interval = [number, number];
/** Ranges written as "-10℃～+50℃", "100-240Vac", "-40 to 85 °C", "90~264V". */
export function parseRange(text: string, defaultDim: Dim = null): { lo: Qty; hi: Qty } | null {
  const t = half(text).replace(/\s+/g, " ");
  const m = t.match(/([-+]?\d[\d,]*(?:\.\d+)?)\s*([a-zA-Zµμ°℃%Ω伏安瓦法欧赫摄度]*)\s*(?:~|～|〜|to|至|到|—|–|-(?=\s*[-+]?\d))\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*([a-zA-Zµμ°℃%Ω伏安瓦法欧赫摄度]*)/i);
  if (!m) return null;
  const u2 = parseUnit(m[4]) ?? parseUnit(m[2]);
  const u1 = parseUnit(m[2]) ?? u2;
  const dim = u2?.dim ?? u1?.dim ?? defaultDim;
  return { lo: { value: num(m[1]) * (u1?.mul ?? 1), dim }, hi: { value: num(m[3]) * (u2?.mul ?? 1), dim } };
}

// ── comparison words in front of / after a number (for the translation check) ──
const GE = /(≥|>=|＞=|不低于|不小于|不少于|至少|最低|min(?:imum)?\.?|at\s+least|not\s+less\s+than|no\s+less\s+than|>\s*|大于)\s*$/i;
const LE = /(≤|<=|＜=|不高于|不大于|不超过|最高|最大|max(?:imum)?\.?|up\s+to|at\s+most|not\s+more\s+than|no\s+more\s+than|below|under|<\s*|小于|低于)\s*$/i;
const GE_AFTER = /^\s*[a-zA-Zµμ°℃%Ω伏安瓦法欧赫摄度]*\s*(以上|及以上|or\s+more|minimum|min\b)/i;
const LE_AFTER = /^\s*[a-zA-Zµμ°℃%Ω伏安瓦法欧赫摄度]*\s*(以下|以内|及以下|or\s+less|maximum|max\b)/i;

export type Token = { raw: string; sig: string; op: "≥" | "≤" | null };
/** Every number(+unit) and every part number / standard in a text, as comparable signatures. */
export function tokensOf(text: string): Token[] {
  const t = half(text);
  const out: Token[] = [];
  // part numbers and standards: must survive translation letter for letter
  for (const m of t.matchAll(/\b(?:GB\/?T?|IEC|EN|UL|ISO|IPC|JIS)\s?\d{2,6}(?:[.-]\d+)*\b|\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b|\b[A-Z]{2,5}\d{3,}[A-Z0-9]*\b/g))
    out.push({ raw: m[0], sig: `id:${m[0].replace(/\s+/g, "").toUpperCase()}`, op: null });
  for (const m of t.matchAll(/(?<![A-Za-z0-9.])([-+]?\d[\d,]*(?:\.\d+)?)\s*([a-zA-Zµμ°℃%Ω伏安瓦法欧赫摄度小时毫微纳皮千兆万米克分贝特]{0,6})/g)) {
    const before = t.slice(Math.max(0, m.index! - 14), m.index);
    if (/[A-Z]-?$/.test(before) && !/\s$/.test(before)) continue; // part of a part number (PS-1205)
    const after = t.slice(m.index! + m[0].length - m[2].length, m.index! + m[0].length + 12);
    const u = parseUnit(m[2]);
    const value = num(m[1]) * (u?.mul ?? 1);
    if (!Number.isFinite(value)) continue;
    const op = GE.test(before) || GE_AFTER.test(after) ? "≥" : LE.test(before) || LE_AFTER.test(after) ? "≤" : null;
    out.push({ raw: m[0].trim(), sig: `${+value.toPrecision(6)}|${u?.dim ?? ""}`, op });
  }
  return out;
}

export type IntegrityResult = { ok: boolean; missing: string[]; flipped: string[] };
/** Translation check: every number, unit, part number and limit (≥/≤) of the original must be in the translation. */
export function checkTranslation(original: string, translation: string): IntegrityResult {
  const a = tokensOf(original), b = tokensOf(translation);
  const missing: string[] = [], flipped: string[] = [];
  const pool = [...b];
  for (const tk of a) {
    // a unitless number in one language may carry its unit in the other ("50K小时" vs "50,000 hours"): match by value too
    const i = pool.findIndex((x) => x.sig === tk.sig) >= 0 ? pool.findIndex((x) => x.sig === tk.sig) : pool.findIndex((x) => x.sig.split("|")[0] === tk.sig.split("|")[0] && (!x.sig.split("|")[1] || !tk.sig.split("|")[1]));
    if (i < 0) { if (!/^id:/.test(tk.sig) || !translation.toUpperCase().replace(/\s+/g, "").includes(tk.sig.slice(3))) missing.push(tk.raw); continue; }
    if (tk.op && pool[i].op && tk.op !== pool[i].op) flipped.push(`${tk.raw} (${tk.op} → ${pool[i].op})`);
    pool.splice(i, 1);
  }
  return { ok: !missing.length && !flipped.length, missing: [...new Set(missing)], flipped };
}
