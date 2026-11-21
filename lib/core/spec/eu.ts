// EU compliance warnings — indicative, deterministic, never a verdict: "this might not pass in the EU, ask for X".
//   1. CE / RoHS written in a chat or datasheet is a claim: ask for the EU Declaration of Conformity + test reports.
//   2. External power supplies (EU Ecodesign Reg. 2019/1782): minimum average efficiency and maximum no-load power.
//   3. A part changed after certification: the old test reports may no longer cover the product.
import type { Row } from "./compare";
import { parseQty } from "./quantity";
import type { Note } from "./store";

export type EuWarning = { en: string; zh: string };
export const EU_DISCLAIMER = { en: "Indicative check, not legal advice: confirm with your test lab.", zh: "仅供参考，请以检测机构结论为准。" };

const num = (v: string | undefined) => (v ? parseQty(v.replace(/^[^\d+-]*/, ""))?.value ?? null : null);
const row = (rows: Row[], key: string) => rows.find((r) => r.key === key && !r.component);

export function euWarnings(rows: Row[], notes: Note[]): EuWarning[] {
  const out: EuWarning[] = [];
  const certText = rows.filter((r) => r.key === "certifications" || r.key === "rohs").map((r) => `${r.req?.value ?? ""} ${r.sup?.value ?? ""}`).join(" ");
  const eu = /\bCE\b|RoHS|REACH|ErP|UKCA/i.test(certText);

  if (eu) out.push({
    en: "CE / RoHS stated by the supplier is only a claim. Ask for the EU Declaration of Conformity and the test reports (safety EN 62368-1, EMC, RoHS) for this exact model.",
    zh: "CE/RoHS 目前仅为声明。请提供本型号的欧盟符合性声明（DoC）及测试报告（安规 EN 62368-1、EMC、RoHS）。",
  });

  // external AC-DC power supply → Ecodesign 2019/1782 limits by output power
  const vin = row(rows, "input_voltage"), vout = row(rows, "output_voltage"), iout = row(rows, "output_current"), pout = row(rows, "output_power");
  const isPsu = !!vout && (!!iout || !!pout) && /ac|~|100|110|220|230|240/i.test(`${vin?.req?.value ?? ""} ${vin?.sup?.value ?? ""}`);
  if (isPsu) {
    const v = num(vout!.req?.value ?? vout!.sup?.value), i = num(iout?.req?.value ?? iout?.sup?.value);
    const w = num(pout?.req?.value ?? pout?.sup?.value) ?? (v && i ? v * i : null);
    if (w && w >= 1 && w <= 250) {
      const effMin = w > 49 ? 88 : Math.round((0.071 * Math.log(w) - 0.0014 * w + 0.67) * 1000) / 10;
      const noLoadMax = w > 49 ? 0.21 : 0.1;
      const eff = row(rows, "efficiency")?.sup, nl = row(rows, "standby_power")?.sup;
      const effV = num(eff?.value), nlV = num(nl?.value);
      const issues: string[] = [], issuesZh: string[] = [];
      if (!eff) { issues.push("efficiency not stated"); issuesZh.push("未提供效率"); }
      else if (eff.op === "typ" || /典型|typ/i.test(eff.value)) { issues.push(`efficiency ${eff.value} is only typical`); issuesZh.push(`效率 ${eff.value} 仅为典型值`); }
      else if (effV != null && effV < effMin) { issues.push(`efficiency ${eff.value} < ${effMin}%`); issuesZh.push(`效率 ${eff.value} 低于 ${effMin}%`); }
      if (!nl) { issues.push("no-load power not stated"); issuesZh.push("未提供空载功耗"); }
      else if (nlV != null && nlV > noLoadMax + 1e-9) { issues.push(`no-load ${nl.value} > ${noLoadMax} W`); issuesZh.push(`空载功耗 ${nl.value} 超过 ${noLoadMax}W`); }
      if (issues.length) out.push({
        en: `EU Ecodesign (Reg. 2019/1782) for a ${Math.round(w)} W external power supply: average efficiency ≥ ${effMin}%, no-load ≤ ${noLoadMax} W. Supplier: ${issues.join(", ")} → might not be sold in the EU.`,
        zh: `欧盟生态设计法规（EU 2019/1782）：${Math.round(w)}W 外置电源平均效率 ≥ ${effMin}%，空载功耗 ≤ ${noLoadMax}W。贵方：${issuesZh.join("，")}，可能无法在欧盟销售。`,
      });
    }
  }

  if (notes.some((n) => /substitut|domestic|changed a part|国产|换成|替代/i.test(`${n.text_en} ${n.quote}`)) && (eu || isPsu)) out.push({
    en: "A part was changed: CE / safety test reports made with the old part may no longer cover the product. Ask whether the certification was updated.",
    zh: "物料已变更：原有 CE/安规测试报告可能不再适用，请确认认证是否已更新。",
  });
  return out;
}
