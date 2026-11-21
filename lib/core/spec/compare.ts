// The verification itself — deterministic, no AI: our requirement vs what the supplier states, parameter by parameter,
// with units normalized. The model only reads; this decides. Same inputs → same table, every time.
import { COMPONENTS, PARAMS, SET_SYNONYMS, paramDef, type Dim, type ParamKey } from "./params";
import { fmtQty, parseQty, parseRange, type Qty } from "./quantity";
import type { SpecParamOut } from "./schema";

export type Side = "requirement" | "supplier";
export type SpecParam = SpecParamOut & { item_id: string; item_title: string; side: Side; order: number };
export type Status = "ok" | "mismatch" | "missing" | "check" | "info";
export type Row = {
  key: ParamKey; component: string | null; label_en: string; label_zh: string; group: string;
  req: SpecParam | null; sup: SpecParam | null; earlier: SpecParam[]; // earlier supplier values for the same line (superseded)
  status: Status; reason_en: string; reason_zh: string;
};

export const STATUS_LABEL: Record<Status, { en: string; zh: string; icon: string }> = {
  ok: { en: "OK", zh: "符合", icon: "✅" },
  mismatch: { en: "Mismatch", zh: "不符合", icon: "🔴" },
  missing: { en: "Not stated", zh: "未提供", icon: "⚠️" },
  check: { en: "To confirm", zh: "待确认", icon: "🟡" },
  info: { en: "Info", zh: "参考", icon: "ℹ️" },
};

/** Canonical sub-part name, so "输出电容" and "Output capacitor C12" are the same line. */
export function canonicalComponent(c: string | null | undefined): { en: string; zh: string } | null {
  if (!c?.trim()) return null;
  const hit = COMPONENTS.find((x) => x.re.test(c) || c.toLowerCase().includes(x.en.toLowerCase()));
  return hit ? { en: hit.en, zh: hit.zh } : { en: c.trim(), zh: c.trim() };
}

const lineKey = (p: SpecParam) => `${p.key}|${canonicalComponent(p.component)?.en.toLowerCase() ?? ""}|${p.key === "other" ? p.label.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "") : ""}`;

// ── values ──
type Iv = { lo: number; hi: number; dim: Dim; typ: boolean };
function qtyOf(p: SpecParam, dim: Dim): { lo: Qty | null; hi: Qty | null } {
  // prefer the parsed text (it keeps prefixes right: "150mV"), fall back to the model's num/unit
  const range = parseRange(p.value, dim);
  if (p.op === "range" || (range && p.op !== "min" && p.op !== "max")) {
    if (range) return range;
    if (p.num != null && p.num_max != null) { const a = parseQty(`${p.num}${p.unit ?? ""}`, dim), b = parseQty(`${p.num_max}${p.unit ?? ""}`, dim); return { lo: a, hi: b }; }
  }
  const q = parseQty(p.value.replace(/^[^\d+-]*/, ""), dim) ?? (p.num != null ? parseQty(`${p.num}${p.unit ?? ""}`, dim) : null);
  return { lo: q, hi: q };
}
function interval(p: SpecParam, dim: Dim): Iv | null {
  const { lo, hi } = qtyOf(p, dim);
  if (!lo || !hi) return null;
  const d = lo.dim ?? hi.dim ?? dim;
  if (p.op === "min") return { lo: lo.value, hi: Infinity, dim: d, typ: false };
  if (p.op === "max") return { lo: -Infinity, hi: hi.value, dim: d, typ: false };
  return { lo: Math.min(lo.value, hi.value), hi: Math.max(lo.value, hi.value), dim: d, typ: p.op === "typ" };
}
const fmtIv = (iv: Iv) => iv.lo === iv.hi ? fmtQty({ value: iv.lo, dim: iv.dim }) : iv.hi === Infinity ? `≥ ${fmtQty({ value: iv.lo, dim: iv.dim })}` : iv.lo === -Infinity ? `≤ ${fmtQty({ value: iv.hi, dim: iv.dim })}` : `${fmtQty({ value: iv.lo, dim: iv.dim })} … ${fmtQty({ value: iv.hi, dim: iv.dim })}`;
const fmtZh = (iv: Iv) => fmtIv(iv).replace(" … ", " ~ ");

export function setItems(text: string): string[] {
  const out = new Set<string>();
  for (const [re, name] of SET_SYNONYMS) if (re.test(text)) out.add(name);
  return [...out];
}
const SET_ZH: Record<string, string> = { OVP: "过压保护", OCP: "过流保护", SCP: "短路保护", OTP: "过温保护", OLP: "过载保护", UVP: "欠压保护" };
const normText = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s,，.。;；:：/、()（）\-_]/g, "");

type Verdict = { status: Status; en: string; zh: string };
/** One line: our requirement (or nothing) vs the supplier's latest value (or nothing). */
export function judge(key: ParamKey, req: SpecParam | null, sup: SpecParam | null): Verdict {
  const def = paramDef(key);
  if (!sup) return { status: "missing", en: "Not stated by the supplier", zh: "贵方资料未注明，请提供" };
  if (!req) return { status: "info", en: "Stated by the supplier (not in our spec)", zh: "贵方提供的参数（我方未要求）" };

  if (def.rule === "includes") {
    const want = setItems(req.value), have = setItems(sup.value);
    if (!want.length) return { status: "check", en: "Compare by hand", zh: "请人工核对" };
    const miss = want.filter((w) => !have.includes(w));
    return miss.length ? { status: "mismatch", en: `Missing: ${miss.join(", ")}`, zh: `缺少：${miss.map((m) => (SET_ZH[m] ? `${SET_ZH[m]}（${m}）` : m)).join("、")}` } : { status: "ok", en: "All required items present", zh: "全部满足" };
  }
  if (def.rule === "text" || req.op === "text" || sup.op === "text") {
    const a = normText(req.value), b = normText(sup.value);
    if (a && b && (a === b || a.includes(b) || b.includes(a))) return { status: "ok", en: "Same", zh: "一致" };
    return { status: "check", en: `Different wording: "${req.value}" vs "${sup.value}"`, zh: `描述不一致：「${req.value}」与「${sup.value}」，请确认` };
  }
  const r = interval(req, def.dim), s = interval(sup, def.dim);
  if (!r || !s) return { status: "check", en: "Value not readable as a number — compare by hand", zh: "数值无法识别，请确认" };
  if (r.dim && s.dim && r.dim !== s.dim) return { status: "check", en: `Different units (${r.dim} vs ${s.dim})`, zh: `单位不一致（${r.dim} / ${s.dim}）` };
  const eps = (x: number) => Math.abs(x) * 1e-6 + 1e-15;
  let ok: boolean, en: string, zh: string;
  switch (def.rule) {
    case "min": { // bigger is better: their guaranteed value (lower end) must reach ours
      const need = r.lo === -Infinity ? r.hi : r.lo, have = s.lo === -Infinity ? s.hi : s.lo;
      ok = have >= need - eps(need);
      en = ok ? `${fmtIv(s)} meets ≥ ${fmtQty({ value: need, dim: r.dim })}` : `Supplier ${fmtIv(s)} is below the required ${fmtQty({ value: need, dim: r.dim })}`;
      zh = ok ? "满足要求" : `贵方 ${fmtZh(s)}，低于我方要求 ${fmtQty({ value: need, dim: r.dim })}`;
      break;
    }
    case "max": { // smaller is better: their worst case (upper end) must stay within ours
      const limit = r.hi === Infinity ? r.lo : r.hi, have = s.hi === Infinity ? s.lo : s.hi;
      ok = have <= limit + eps(limit);
      en = ok ? `${fmtIv(s)} within ≤ ${fmtQty({ value: limit, dim: r.dim })}` : `Supplier ${fmtIv(s)} is above the allowed ${fmtQty({ value: limit, dim: r.dim })}`;
      zh = ok ? "满足要求" : `贵方 ${fmtZh(s)}，超出我方上限 ${fmtQty({ value: limit, dim: r.dim })}`;
      break;
    }
    case "covers": {
      ok = s.lo <= r.lo + eps(r.lo) && s.hi >= r.hi - eps(r.hi);
      en = ok ? `${fmtIv(s)} covers ${fmtIv(r)}` : `Supplier range ${fmtIv(s)} does not cover the required ${fmtIv(r)}`;
      zh = ok ? "满足要求" : `贵方范围 ${fmtZh(s)}，未覆盖我方要求 ${fmtZh(r)}`;
      break;
    }
    default: { // eq: within 1%, or inside our range
      const target = (r.lo + r.hi) / 2;
      ok = r.lo !== r.hi ? s.lo >= r.lo - eps(r.lo) && s.hi <= r.hi + eps(r.hi) : Math.abs((s.lo + s.hi) / 2 - target) <= Math.abs(target) * 0.01 + eps(target);
      en = ok ? "Same value" : `Supplier ${fmtIv(s)} ≠ required ${fmtIv(r)}`;
      zh = ok ? "一致" : `贵方 ${fmtZh(s)}，与我方要求 ${fmtZh(r)} 不一致`;
    }
  }
  if (ok && s.typ) return { status: "check", en: `${en} — but only a typical value: ask for the guaranteed limit`, zh: "仅为典型值，请提供保证值（最小/最大值）" };
  return { status: ok ? "ok" : "mismatch", en, zh };
}

/** All lines of a check, requirement order first, then supplier-only lines. */
export function compare(params: SpecParam[]): Row[] {
  const lines = new Map<string, { req: SpecParam[]; sup: SpecParam[] }>();
  for (const p of [...params].sort((a, b) => a.order - b.order)) {
    const k = lineKey(p);
    if (!lines.has(k)) lines.set(k, { req: [], sup: [] });
    (p.side === "requirement" ? lines.get(k)!.req : lines.get(k)!.sup).push(p);
  }
  const rows: Row[] = [];
  for (const { req, sup } of lines.values()) {
    const r = req.at(-1) ?? null, s = sup.at(-1) ?? null;
    const any = (r ?? s)!;
    const comp = canonicalComponent(any.component);
    const def = PARAMS[any.key] ?? PARAMS.other;
    const label_en = any.key === "other" ? any.label : comp ? `${comp.en} – ${def.en.toLowerCase()}` : def.en;
    const label_zh = any.key === "other" ? any.label : comp ? `${comp.zh}${def.zh}` : def.zh;
    let v = judge(any.key, r, s);
    // the supplier said two different things for the same line (datasheet vs a later chat): never silently take one
    const earlier = sup.slice(0, -1).filter((e) => s && judge(any.key, e, s).status !== "ok" && normText(e.value) !== normText(s.value));
    if (earlier.length && s) {
      const was = earlier.at(-1)!;
      v = {
        status: v.status === "ok" ? "check" : v.status,
        en: `${v.en}. Changed: "${was.value}" (${was.item_title}) → "${s.value}" (${s.item_title})`,
        zh: `${v.zh}。数值有变更：「${was.value}」→「${s.value}」`,
      };
    }
    rows.push({ key: any.key, component: comp?.en ?? null, label_en, label_zh, group: def.group, req: r, sup: s, earlier, status: v.status, reason_en: v.en, reason_zh: v.zh });
  }
  const rank = (x: Row) => (x.req ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || (a.req?.order ?? a.sup!.order) - (b.req?.order ?? b.sup!.order));
}

export function tally(rows: Row[]) {
  const c = { ok: 0, mismatch: 0, missing: 0, check: 0, info: 0 } as Record<Status, number>;
  for (const r of rows) c[r.status]++;
  return c;
}
