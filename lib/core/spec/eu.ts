// EU compliance warnings — indicative, deterministic, never a verdict: "this might not pass in the EU, ask for X".
//   1. CE / RoHS written in a chat or datasheet is a claim: ask for the EU Declaration of Conformity + test reports.
//   2. External power supplies (EU Ecodesign Reg. 2019/1782): minimum average efficiency and maximum no-load power.
//   3. A part changed after certification: the old test reports may no longer cover the product.
import type { Row } from "./compare";
import { parseQty } from "./quantity";
import { isPartChangeNote } from "./params";
import type { Note } from "./store";
import type { FullLang } from "../lang";

/** Every warning in Chinese (for the supplier) and in the five full user languages. */
export type EuWarning = { zh: string } & Record<FullLang, string>;
export const EU_DISCLAIMER: EuWarning = {
  zh: "仅供参考，请以检测机构结论为准。",
  en: "Indicative check, not legal advice: confirm with your test lab.",
  it: "Verifica indicativa, non consulenza legale: conferma con il tuo laboratorio di prova.",
  de: "Unverbindliche Prüfung, keine Rechtsberatung: Bestätigung durch Ihr Prüflabor einholen.",
  fr: "Vérification indicative, pas un avis juridique : confirmez avec votre laboratoire d'essai.",
  es: "Comprobación orientativa, no asesoramiento legal: confírmelo con su laboratorio de ensayos.",
};

const num = (v: string | undefined) => (v ? parseQty(v.replace(/^[^\d+-]*/, ""))?.value ?? null : null);
const row = (rows: Row[], key: string) => rows.find((r) => r.key === key && !r.component);

export function euWarnings(rows: Row[], notes: Note[]): EuWarning[] {
  const out: EuWarning[] = [];
  const certText = rows.filter((r) => r.key === "certifications" || r.key === "rohs").map((r) => `${r.req?.value ?? ""} ${r.sup?.value ?? ""}`).join(" ");
  const eu = /\bCE\b|RoHS|REACH|ErP|UKCA/i.test(certText);

  if (eu) out.push({
    en: "CE / RoHS stated by the supplier is only a claim. Ask for the EU Declaration of Conformity and the test reports (safety EN 62368-1, EMC, RoHS) for this exact model.",
    zh: "CE/RoHS 目前仅为声明。请提供本型号的欧盟符合性声明（DoC）及测试报告（安规 EN 62368-1、EMC、RoHS）。",
    it: "CE / RoHS indicati dal fornitore sono solo una dichiarazione. Chiedi la Dichiarazione di conformità UE e i rapporti di prova (sicurezza EN 62368-1, EMC, RoHS) per questo modello.",
    de: "CE / RoHS sind vom Lieferanten nur behauptet. Fordern Sie die EU-Konformitätserklärung und die Prüfberichte (Sicherheit EN 62368-1, EMV, RoHS) für genau dieses Modell an.",
    fr: "CE / RoHS annoncés par le fournisseur ne sont qu'une déclaration. Demandez la déclaration UE de conformité et les rapports d'essai (sécurité EN 62368-1, CEM, RoHS) pour ce modèle précis.",
    es: "CE / RoHS indicados por el proveedor son solo una declaración. Pida la declaración UE de conformidad y los informes de ensayo (seguridad EN 62368-1, CEM, RoHS) de este modelo exacto.",
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
      // each issue in [zh, en, it, de, fr, es]
      const issues: string[][] = [];
      if (!eff) issues.push(["未提供效率", "efficiency not stated", "efficienza non indicata", "Wirkungsgrad nicht angegeben", "rendement non indiqué", "eficiencia no indicada"]);
      else if (eff.op === "typ" || /典型|typ/i.test(eff.value)) issues.push([`效率 ${eff.value} 仅为典型值`, `efficiency ${eff.value} is only typical`, `efficienza ${eff.value} solo tipica`, `Wirkungsgrad ${eff.value} nur typisch`, `rendement ${eff.value} seulement typique`, `eficiencia ${eff.value} solo típica`]);
      else if (effV != null && effV < effMin) issues.push([`效率 ${eff.value} 低于 ${effMin}%`, ...["efficiency", "efficienza", "Wirkungsgrad", "rendement", "eficiencia"].map((x) => `${x} ${eff.value} < ${effMin}%`)]);
      if (!nl) issues.push(["未提供空载功耗", "no-load power not stated", "potenza a vuoto non indicata", "Leerlaufleistung nicht angegeben", "consommation à vide non indiquée", "consumo en vacío no indicado"]);
      else if (nlV != null && nlV > noLoadMax + 1e-9) issues.push([`空载功耗 ${nl.value} 超过 ${noLoadMax}W`, ...["no-load", "a vuoto", "Leerlauf", "à vide", "en vacío"].map((x) => `${x} ${nl.value} > ${noLoadMax} W`)]);
      const list = (i: number, sep = ", ") => issues.map((x) => x[i]).join(sep);
      const W = Math.round(w);
      if (issues.length) out.push({
        zh: `欧盟生态设计法规（EU 2019/1782）：${W}W 外置电源平均效率 ≥ ${effMin}%，空载功耗 ≤ ${noLoadMax}W。贵方：${list(0, "，")}，可能无法在欧盟销售。`,
        en: `EU Ecodesign (Reg. 2019/1782) for a ${W} W external power supply: average efficiency ≥ ${effMin}%, no-load ≤ ${noLoadMax} W. Supplier: ${list(1)} → might not be sold in the EU.`,
        it: `Ecodesign UE (Reg. 2019/1782) per un alimentatore esterno da ${W} W: efficienza media ≥ ${effMin}%, potenza a vuoto ≤ ${noLoadMax} W. Fornitore: ${list(2)} → potrebbe non essere vendibile nell'UE.`,
        de: `EU-Ökodesign (VO 2019/1782) für ein externes ${W}-W-Netzteil: durchschnittlicher Wirkungsgrad ≥ ${effMin}%, Leerlauf ≤ ${noLoadMax} W. Lieferant: ${list(3)} → darf in der EU eventuell nicht verkauft werden.`,
        fr: `Écoconception UE (règl. 2019/1782) pour une alimentation externe de ${W} W : rendement moyen ≥ ${effMin}%, consommation à vide ≤ ${noLoadMax} W. Fournisseur : ${list(4)} → pourrait ne pas être vendable dans l'UE.`,
        es: `Ecodiseño UE (Reg. 2019/1782) para una fuente de alimentación externa de ${W} W: eficiencia media ≥ ${effMin}%, consumo en vacío ≤ ${noLoadMax} W. Proveedor: ${list(5)} → podría no venderse en la UE.`,
      });
    }
  }

  if (notes.some((n) => isPartChangeNote(n) || /国产|换成|替代/.test(n.quote)) && (eu || isPsu)) out.push({
    en: "A part was changed: CE / safety test reports made with the old part may no longer cover the product. Ask whether the certification was updated.",
    zh: "物料已变更：原有 CE/安规测试报告可能不再适用，请确认认证是否已更新。",
    it: "È stato cambiato un componente: i rapporti CE / di sicurezza fatti con il vecchio componente potrebbero non coprire più il prodotto. Chiedi se la certificazione è stata aggiornata.",
    de: "Ein Bauteil wurde geändert: CE- und Sicherheitsprüfberichte mit dem alten Bauteil gelten eventuell nicht mehr. Fragen Sie, ob die Zertifizierung aktualisiert wurde.",
    fr: "Un composant a été changé : les rapports CE / sécurité réalisés avec l'ancien composant peuvent ne plus couvrir le produit. Demandez si la certification a été mise à jour.",
    es: "Se cambió un componente: los informes CE / de seguridad hechos con el componente anterior pueden no cubrir ya el producto. Pregunte si la certificación se actualizó.",
  });
  return out;
}
