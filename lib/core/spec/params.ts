// Electronics spec check — the closed vocabulary. Every parameter has ONE English and ONE Chinese name (the locked
// glossary: the sheet, the prompt and the Chinese message all use these), a physical unit and a pass rule:
//   min      bigger is better: the supplier value must be ≥ ours (rated voltage, efficiency, temperature rating…)
//   max      smaller is better: ≤ ours (ripple, ESR, standby power, tolerance…)
//   eq       must be the same value (output voltage, capacitance, cable length…), 1% slack
//   covers   a range that must contain ours (operating temperature, input voltage…)
//   includes a set that must contain ours (certifications, protections)
//   text     must read the same (package, connector, material…)

export type Rule = "min" | "max" | "eq" | "covers" | "includes" | "text";
export type Dim = "V" | "A" | "W" | "%" | "°C" | "F" | "Ω" | "H" | "Hz" | "m" | "g" | "h" | "dB" | null;
export type ParamDef = { en: string; zh: string; dim: Dim; rule: Rule; group: string };

export const PARAMS = {
  // power / electrical
  input_voltage: { en: "Input voltage", zh: "输入电压", dim: "V", rule: "covers", group: "Electrical" },
  input_frequency: { en: "Input frequency", zh: "输入频率", dim: "Hz", rule: "covers", group: "Electrical" },
  input_current: { en: "Input current", zh: "输入电流", dim: "A", rule: "max", group: "Electrical" },
  output_voltage: { en: "Output voltage", zh: "输出电压", dim: "V", rule: "eq", group: "Electrical" },
  output_current: { en: "Output current", zh: "输出电流", dim: "A", rule: "min", group: "Electrical" },
  output_power: { en: "Output power", zh: "输出功率", dim: "W", rule: "min", group: "Electrical" },
  voltage_accuracy: { en: "Voltage accuracy", zh: "电压精度", dim: "%", rule: "max", group: "Electrical" },
  ripple_noise: { en: "Ripple & noise", zh: "纹波噪声", dim: "V", rule: "max", group: "Electrical" },
  efficiency: { en: "Efficiency", zh: "效率", dim: "%", rule: "min", group: "Electrical" },
  power_factor: { en: "Power factor", zh: "功率因数", dim: null, rule: "min", group: "Electrical" },
  standby_power: { en: "No-load power", zh: "空载功耗", dim: "W", rule: "max", group: "Electrical" },
  inrush_current: { en: "Inrush current", zh: "浪涌电流", dim: "A", rule: "max", group: "Electrical" },
  leakage_current: { en: "Leakage current", zh: "漏电流", dim: "A", rule: "max", group: "Electrical" },
  isolation_voltage: { en: "Isolation voltage (withstand)", zh: "耐压（绝缘）", dim: "V", rule: "min", group: "Electrical" },
  insulation_resistance: { en: "Insulation resistance", zh: "绝缘电阻", dim: "Ω", rule: "min", group: "Electrical" },
  hold_up_time: { en: "Hold-up time", zh: "保持时间", dim: null, rule: "min", group: "Electrical" },
  switching_frequency: { en: "Switching frequency", zh: "开关频率", dim: "Hz", rule: "eq", group: "Electrical" },
  protections: { en: "Protections", zh: "保护功能", dim: null, rule: "includes", group: "Electrical" },
  // passive components
  capacitance: { en: "Capacitance", zh: "电容量", dim: "F", rule: "eq", group: "Component" },
  resistance: { en: "Resistance", zh: "电阻值", dim: "Ω", rule: "eq", group: "Component" },
  inductance: { en: "Inductance", zh: "电感量", dim: "H", rule: "eq", group: "Component" },
  rated_voltage: { en: "Rated voltage", zh: "额定电压", dim: "V", rule: "min", group: "Component" },
  rated_current: { en: "Rated current", zh: "额定电流", dim: "A", rule: "min", group: "Component" },
  rated_power: { en: "Rated power", zh: "额定功率", dim: "W", rule: "min", group: "Component" },
  tolerance: { en: "Tolerance", zh: "容差（精度）", dim: "%", rule: "max", group: "Component" },
  temp_rating: { en: "Temperature rating", zh: "耐温等级", dim: "°C", rule: "min", group: "Component" },
  esr: { en: "ESR", zh: "等效串联电阻（ESR）", dim: "Ω", rule: "max", group: "Component" },
  ripple_current: { en: "Ripple current", zh: "纹波电流", dim: "A", rule: "min", group: "Component" },
  lifetime: { en: "Lifetime", zh: "寿命", dim: "h", rule: "min", group: "Component" },
  temp_coefficient: { en: "Temperature coefficient", zh: "温度系数", dim: null, rule: "max", group: "Component" },
  // environment & reliability
  operating_temp: { en: "Operating temperature", zh: "工作温度", dim: "°C", rule: "covers", group: "Environment" },
  storage_temp: { en: "Storage temperature", zh: "存储温度", dim: "°C", rule: "covers", group: "Environment" },
  humidity: { en: "Operating humidity", zh: "工作湿度", dim: "%", rule: "covers", group: "Environment" },
  mtbf: { en: "MTBF", zh: "平均无故障时间（MTBF）", dim: "h", rule: "min", group: "Environment" },
  ip_rating: { en: "IP rating", zh: "防护等级", dim: null, rule: "text", group: "Environment" },
  flammability: { en: "Flammability rating", zh: "阻燃等级", dim: null, rule: "text", group: "Environment" },
  noise_level: { en: "Acoustic noise", zh: "噪音", dim: "dB", rule: "max", group: "Environment" },
  // mechanical
  package: { en: "Package", zh: "封装", dim: null, rule: "text", group: "Mechanical" },
  dimensions: { en: "Dimensions", zh: "尺寸", dim: null, rule: "text", group: "Mechanical" },
  weight: { en: "Weight", zh: "重量", dim: "g", rule: "max", group: "Mechanical" },
  connector: { en: "Connector", zh: "连接器（接口）", dim: null, rule: "text", group: "Mechanical" },
  cable_length: { en: "Cable length", zh: "线长", dim: "m", rule: "eq", group: "Mechanical" },
  wire_gauge: { en: "Wire gauge", zh: "线规", dim: null, rule: "text", group: "Mechanical" },
  material: { en: "Material", zh: "材质", dim: null, rule: "text", group: "Mechanical" },
  pcb_thickness: { en: "PCB thickness", zh: "板厚", dim: "m", rule: "eq", group: "Mechanical" },
  copper_thickness: { en: "Copper thickness", zh: "铜厚", dim: null, rule: "min", group: "Mechanical" },
  // compliance & identity
  certifications: { en: "Certifications", zh: "认证", dim: null, rule: "includes", group: "Compliance" },
  rohs: { en: "RoHS / REACH", zh: "环保要求（RoHS/REACH）", dim: null, rule: "text", group: "Compliance" },
  manufacturer: { en: "Manufacturer / brand", zh: "品牌（厂家）", dim: null, rule: "text", group: "Identity" },
  part_number: { en: "Part number", zh: "型号（料号）", dim: null, rule: "text", group: "Identity" },
  warranty: { en: "Warranty", zh: "质保期", dim: null, rule: "min", group: "Identity" },
  other: { en: "Other", zh: "其他", dim: null, rule: "text", group: "Other" },
} as const satisfies Record<string, ParamDef>;

export type ParamKey = keyof typeof PARAMS;
export const PARAM_KEYS = Object.keys(PARAMS) as [ParamKey, ...ParamKey[]];
export const paramDef = (k: string): ParamDef => (PARAMS as Record<string, ParamDef>)[k] ?? PARAMS.other;

/** The same locked names in the other full languages (it · de · fr · es): parameter names on the sheet and in the bot,
 *  and keywords for the rule reader. English and Chinese stay the reference. */
export const PARAM_LABELS: Record<ParamKey, [it: string, de: string, fr: string, es: string]> = {
  input_voltage: ["Tensione di ingresso", "Eingangsspannung", "Tension d'entrée", "Tensión de entrada"],
  input_frequency: ["Frequenza di ingresso", "Eingangsfrequenz", "Fréquence d'entrée", "Frecuencia de entrada"],
  input_current: ["Corrente di ingresso", "Eingangsstrom", "Courant d'entrée", "Corriente de entrada"],
  output_voltage: ["Tensione di uscita", "Ausgangsspannung", "Tension de sortie", "Tensión de salida"],
  output_current: ["Corrente di uscita", "Ausgangsstrom", "Courant de sortie", "Corriente de salida"],
  output_power: ["Potenza di uscita", "Ausgangsleistung", "Puissance de sortie", "Potencia de salida"],
  voltage_accuracy: ["Precisione della tensione", "Spannungsgenauigkeit", "Précision de la tension", "Precisión de la tensión"],
  ripple_noise: ["Ripple e rumore", "Restwelligkeit und Rauschen", "Ondulation et bruit", "Rizado y ruido"],
  efficiency: ["Efficienza", "Wirkungsgrad", "Rendement", "Eficiencia"],
  power_factor: ["Fattore di potenza", "Leistungsfaktor", "Facteur de puissance", "Factor de potencia"],
  standby_power: ["Potenza a vuoto", "Leerlaufleistung", "Consommation à vide", "Consumo en vacío"],
  inrush_current: ["Corrente di spunto", "Einschaltstrom", "Courant d'appel", "Corriente de irrupción"],
  leakage_current: ["Corrente di dispersione", "Ableitstrom", "Courant de fuite", "Corriente de fuga"],
  isolation_voltage: ["Tensione di isolamento (rigidità dielettrica)", "Isolationsspannung (Spannungsfestigkeit)", "Tension d'isolement (rigidité diélectrique)", "Tensión de aislamiento (rigidez dieléctrica)"],
  insulation_resistance: ["Resistenza di isolamento", "Isolationswiderstand", "Résistance d'isolement", "Resistencia de aislamiento"],
  hold_up_time: ["Tempo di mantenimento", "Haltezeit", "Temps de maintien", "Tiempo de retención"],
  switching_frequency: ["Frequenza di commutazione", "Schaltfrequenz", "Fréquence de découpage", "Frecuencia de conmutación"],
  protections: ["Protezioni", "Schutzfunktionen", "Protections", "Protecciones"],
  capacitance: ["Capacità", "Kapazität", "Capacité", "Capacidad"],
  resistance: ["Resistenza", "Widerstand", "Résistance", "Resistencia"],
  inductance: ["Induttanza", "Induktivität", "Inductance", "Inductancia"],
  rated_voltage: ["Tensione nominale", "Nennspannung", "Tension nominale", "Tensión nominal"],
  rated_current: ["Corrente nominale", "Nennstrom", "Courant nominal", "Corriente nominal"],
  rated_power: ["Potenza nominale", "Nennleistung", "Puissance nominale", "Potencia nominal"],
  tolerance: ["Tolleranza", "Toleranz", "Tolérance", "Tolerancia"],
  temp_rating: ["Classe di temperatura", "Temperaturklasse", "Température nominale", "Temperatura nominal"],
  esr: ["ESR", "ESR", "ESR", "ESR"],
  ripple_current: ["Corrente di ripple", "Rippelstrom", "Courant d'ondulation", "Corriente de rizado"],
  lifetime: ["Durata di vita", "Lebensdauer", "Durée de vie", "Vida útil"],
  temp_coefficient: ["Coefficiente di temperatura", "Temperaturkoeffizient", "Coefficient de température", "Coeficiente de temperatura"],
  operating_temp: ["Temperatura di esercizio", "Betriebstemperatur", "Température de fonctionnement", "Temperatura de funcionamiento"],
  storage_temp: ["Temperatura di stoccaggio", "Lagertemperatur", "Température de stockage", "Temperatura de almacenamiento"],
  humidity: ["Umidità di esercizio", "Luftfeuchtigkeit im Betrieb", "Humidité de fonctionnement", "Humedad de funcionamiento"],
  mtbf: ["MTBF", "MTBF", "MTBF", "MTBF"],
  ip_rating: ["Grado di protezione IP", "Schutzart (IP)", "Indice de protection IP", "Grado de protección IP"],
  flammability: ["Classe di infiammabilità", "Brennbarkeitsklasse", "Classe d'inflammabilité", "Clase de inflamabilidad"],
  noise_level: ["Rumore acustico", "Geräuschpegel", "Bruit acoustique", "Ruido acústico"],
  package: ["Package (contenitore)", "Gehäuseform (Package)", "Boîtier", "Encapsulado"],
  dimensions: ["Dimensioni", "Abmessungen", "Dimensions", "Dimensiones"],
  weight: ["Peso", "Gewicht", "Poids", "Peso"],
  connector: ["Connettore", "Steckverbinder", "Connecteur", "Conector"],
  cable_length: ["Lunghezza del cavo", "Kabellänge", "Longueur du câble", "Longitud del cable"],
  wire_gauge: ["Sezione del filo (AWG)", "Leiterquerschnitt (AWG)", "Section du fil (AWG)", "Calibre del cable (AWG)"],
  material: ["Materiale", "Material", "Matériau", "Material"],
  pcb_thickness: ["Spessore del PCB", "Leiterplattendicke", "Épaisseur du PCB", "Espesor del PCB"],
  copper_thickness: ["Spessore del rame", "Kupferdicke", "Épaisseur de cuivre", "Espesor del cobre"],
  certifications: ["Certificazioni", "Zertifizierungen", "Certifications", "Certificaciones"],
  rohs: ["RoHS / REACH", "RoHS / REACH", "RoHS / REACH", "RoHS / REACH"],
  manufacturer: ["Produttore / marchio", "Hersteller / Marke", "Fabricant / marque", "Fabricante / marca"],
  part_number: ["Codice articolo", "Teilenummer", "Référence", "Número de pieza"],
  warranty: ["Garanzia", "Garantie", "Garantie", "Garantía"],
  other: ["Altro", "Sonstiges", "Autre", "Otro"],
};

const COMPONENT_LABELS: Record<string, [it: string, de: string, fr: string, es: string]> = {
  "Output capacitor": ["Condensatore di uscita", "Ausgangskondensator", "Condensateur de sortie", "Condensador de salida"],
  "Input capacitor": ["Condensatore di ingresso", "Eingangskondensator", "Condensateur d'entrée", "Condensador de entrada"],
  "Electrolytic capacitor": ["Condensatore elettrolitico", "Elektrolytkondensator", "Condensateur électrolytique", "Condensador electrolítico"],
  Transformer: ["Trasformatore", "Transformator", "Transformateur", "Transformador"],
  Fuse: ["Fusibile", "Sicherung", "Fusible", "Fusible"],
  MOSFET: ["MOSFET", "MOSFET", "MOSFET", "MOSFET"],
  Cable: ["Cavo", "Kabel", "Câble", "Cable"],
  Housing: ["Involucro", "Gehäuse", "Boîtier", "Carcasa"],
};
const LANG_COL = { it: 0, de: 1, fr: 2, es: 3 } as const;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Sub-parts a value can belong to (the capacitor inside a power supply). English is canonical. */
export const COMPONENTS: { en: string; zh: string; re: RegExp }[] = [
  { en: "Output capacitor", zh: "输出电容", re: /output\s+(?:electrolytic\s+)?capacitor|输出(?:端)?(?:滤波)?(?:电解)?电容/i },
  { en: "Input capacitor", zh: "输入电容", re: /input\s+(?:bulk\s+)?(?:electrolytic\s+)?capacitor|输入(?:端)?(?:滤波)?(?:电解)?电容|高压电解电容/i },
  { en: "Electrolytic capacitor", zh: "电解电容", re: /electrolytic\s+capacitor|电解电容/i },
  { en: "Transformer", zh: "变压器", re: /transformer|变压器/i },
  { en: "Fuse", zh: "保险丝", re: /\bfuse\b|保险丝|熔断器/i },
  { en: "MOSFET", zh: "MOS管", re: /mosfet|mos管/i },
  { en: "Cable", zh: "线材", re: /\bcable\b|线材|电源线/i },
  { en: "Housing", zh: "外壳", re: /housing|enclosure|外壳/i },
].map((c) => ({ ...c, re: new RegExp(`${c.re.source}|${(COMPONENT_LABELS[c.en] ?? []).filter((l) => l !== c.en).map(esc).join("|") || "(?!)"}`, "i") }));

/** A parameter or sub-part name in the user's language (English for languages without their own table). */
export function paramLabel(key: ParamKey, lang: string): string {
  const col = LANG_COL[lang as keyof typeof LANG_COL];
  return col === undefined ? PARAMS[key].en : PARAM_LABELS[key][col];
}
export function componentLabel(en: string, lang: string): string {
  const col = LANG_COL[lang as keyof typeof LANG_COL];
  return col === undefined ? en : COMPONENT_LABELS[en]?.[col] ?? en;
}
/** Glossary entries (term in the user's language ↔ 中文), longest first, for the rule translator. */
export function termsFor(lang: string): { term: string; zh: string }[] {
  const out = [
    ...(Object.keys(PARAMS) as ParamKey[]).filter((k) => k !== "other").map((k) => ({ term: paramLabel(k, lang), zh: PARAMS[k].zh })),
    ...COMPONENTS.map((c) => ({ term: componentLabel(c.en, lang), zh: c.zh })),
  ];
  return out.sort((a, b) => b.zh.length - a.zh.length);
}

/** Locked glossary EN ↔ 中文: used in the prompt (the model must use these), the Glossary sheet and the rule fallback. */
export const TERMS: { en: string; zh: string; note?: string }[] = [
  ...Object.values(PARAMS).filter((p) => p.en !== "Other").map((p) => ({ en: p.en, zh: p.zh })),
  ...COMPONENTS.map((c) => ({ en: c.en, zh: c.zh })),
  { en: "Over-voltage protection (OVP)", zh: "过压保护" },
  { en: "Over-current protection (OCP)", zh: "过流保护" },
  { en: "Short-circuit protection (SCP)", zh: "短路保护" },
  { en: "Over-temperature protection (OTP)", zh: "过温保护" },
  { en: "Overload protection (OLP)", zh: "过载保护" },
  { en: "Typical value", zh: "典型值", note: "not guaranteed — ask for min/max" },
  { en: "Minimum", zh: "最小值" },
  { en: "Maximum", zh: "最大值" },
  { en: "Peak-to-peak", zh: "峰峰值" },
  { en: "Full load", zh: "满载" },
  { en: "No load", zh: "空载" },
  { en: "Rated load", zh: "额定负载" },
  { en: "Datasheet", zh: "规格书" },
  { en: "Drawing", zh: "图纸" },
  { en: "Bill of materials (BOM)", zh: "物料清单（BOM）" },
  { en: "Engineering change notice (ECN)", zh: "工程变更通知（ECN）" },
  { en: "Golden sample", zh: "封样" },
  { en: "Sample approval", zh: "样品承认" },
  { en: "Mass production", zh: "量产" },
  { en: "Equivalent substitute", zh: "替代料", note: "always verify every parameter" },
  { en: "Domestic equivalent", zh: "国产替代", note: "always verify every parameter" },
  { en: "Surface-mount (SMD)", zh: "贴片" },
  { en: "Through-hole (THT)", zh: "插件" },
  { en: "Solid capacitor", zh: "固态电容" },
  { en: "Aging test (burn-in)", zh: "老化测试" },
  { en: "Hi-pot test", zh: "耐压测试" },
  { en: "Test report", zh: "测试报告" },
  { en: "Tolerance band", zh: "公差" },
];

/** Set members, normalized: protections and certifications written in either language. */
export const SET_SYNONYMS: [RegExp, string][] = [
  [/\bovp\b|over[-\s]?voltage|过压/i, "OVP"], [/\bocp\b|over[-\s]?current|过流/i, "OCP"], [/\bscp\b|short[-\s]?circuit|短路/i, "SCP"],
  [/\botp\b|over[-\s]?temp|过温|过热/i, "OTP"], [/\bolp\b|overload|过载/i, "OLP"], [/\buvp\b|under[-\s]?voltage|欠压/i, "UVP"],
  [/\bce\b/i, "CE"], [/\bfcc\b/i, "FCC"], [/\bul\b/i, "UL"], [/\bccc\b|3c认证/i, "CCC"], [/\betl\b/i, "ETL"], [/\bcb\b/i, "CB"],
  [/\brohs\b/i, "RoHS"], [/\breach\b/i, "REACH"], [/\berp\b|\bdoe\s*(?:level\s*)?vi\b|能效/i, "ErP/DoE VI"], [/\bpse\b/i, "PSE"], [/\bkc\b/i, "KC"],
  [/\bsaa\b|\brcm\b/i, "SAA/RCM"], [/\bukca\b/i, "UKCA"], [/\bgs\b/i, "GS"], [/\bemc\b/i, "EMC"], [/\blvd\b/i, "LVD"],
];

/** Rule fallback: which parameter a line talks about (longest match first). */
export const KEYWORDS: [RegExp, ParamKey][] = [
  [/ripple\s*(?:&|and)?\s*noise|纹波(?:及|和|与)?噪声|纹波噪音|^\s*ripple\b|纹波(?!电流)/i, "ripple_noise"],
  [/ripple\s+current|纹波电流/i, "ripple_current"],
  [/no[-\s]?load\s+power|standby\s+power|空载功耗|待机功耗/i, "standby_power"],
  [/operating\s+temp|working\s+temp|工作温度|使用温度/i, "operating_temp"],
  [/storage\s+temp|存储温度|储存温度/i, "storage_temp"],
  [/input\s+voltage|输入电压/i, "input_voltage"], [/input\s+freq|输入频率/i, "input_frequency"], [/input\s+current|输入电流/i, "input_current"],
  [/output\s+voltage|输出电压/i, "output_voltage"], [/output\s+current|输出电流/i, "output_current"], [/output\s+power|输出功率|额定功率(?=.*输出)/i, "output_power"],
  [/efficiency|效率/i, "efficiency"], [/power\s+factor|功率因数|\bpf\b/i, "power_factor"],
  [/voltage\s+accuracy|电压精度|稳压精度/i, "voltage_accuracy"], [/inrush|浪涌|冲击电流/i, "inrush_current"], [/leakage|漏电流/i, "leakage_current"],
  [/withstand|hi-?pot|isolation\s+voltage|耐压|抗电强度/i, "isolation_voltage"], [/insulation\s+resistance|绝缘电阻/i, "insulation_resistance"],
  [/hold[-\s]?up|保持时间/i, "hold_up_time"], [/switching\s+freq|开关频率/i, "switching_frequency"],
  [/protection|保护/i, "protections"], [/certific|认证|安规/i, "certifications"], [/\brohs\b|\breach\b|环保/i, "rohs"],
  [/mtbf|平均无故障/i, "mtbf"], [/lifetime|life\s*time|load\s+life|寿命/i, "lifetime"], [/\besr\b|等效串联电阻/i, "esr"],
  [/tolerance|容差|精度/i, "tolerance"], [/humidity|湿度/i, "humidity"], [/ip\s*rating|防护等级|\bip\d{2}\b/i, "ip_rating"],
  [/flammab|阻燃|ul94/i, "flammability"], [/dimension|尺寸|外形/i, "dimensions"], [/weight|重量/i, "weight"],
  [/connector|plug|接口|插头|连接器/i, "connector"], [/cable\s+length|线长|线材长度/i, "cable_length"], [/wire\s+gauge|\bawg\b|线规/i, "wire_gauge"],
  [/material|材质|材料/i, "material"], [/package|封装/i, "package"], [/warranty|质保|保修/i, "warranty"],
  [/manufacturer|brand|品牌|厂家/i, "manufacturer"], [/part\s*(?:no|number)|model|型号|料号/i, "part_number"],
  [/capacitance|电容量|容量/i, "capacitance"], [/resistance|阻值|电阻值/i, "resistance"], [/inductance|电感量|感量/i, "inductance"],
  [/rated\s+voltage|额定电压/i, "rated_voltage"], [/rated\s+current|额定电流/i, "rated_current"], [/rated\s+power|额定功率/i, "rated_power"],
  [/temp(?:erature)?\s+rating|耐温|温度等级/i, "temp_rating"], [/noise\s+level|acoustic|噪音/i, "noise_level"],
  // the same names in it · de · fr · es, longest first ("Resistenza di isolamento" before "Resistenza")
  ...(Object.entries(PARAM_LABELS) as [ParamKey, string[]][])
    .flatMap(([key, labels]) => labels.filter((l) => key !== "other" && l !== PARAMS[key].en && l.length > 3).map((l) => [l.replace(/\s*\(.*\)$/, ""), key] as const))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([l, key]): [RegExp, ParamKey] => [new RegExp(esc(l), "i"), key]),
];

/** Polite or vague words that weaken a technical claim (shown as notes in the user's language; the sheet asks for a firm value). */
export const SOFT_CLAIMS: { re: RegExp; risk: "low" | "medium" | "high"; en: string; it: string; de: string; fr: string; es: string }[] = [
  { re: /参数一样|参数相同|规格一样|完全一样|一模一样/, risk: "high",
    en: "\"Same parameters\" — a claim, not a datasheet. Check every value of the new part.",
    it: "\"Stessi parametri\": è un'affermazione, non una scheda tecnica. Verifica ogni valore del nuovo componente.",
    de: "„Gleiche Parameter“ ist eine Behauptung, kein Datenblatt. Prüfen Sie jeden Wert des neuen Bauteils.",
    fr: "« Mêmes paramètres » : une affirmation, pas une fiche technique. Vérifiez chaque valeur de la nouvelle pièce.",
    es: "\"Mismos parámetros\": es una afirmación, no una hoja de datos. Compruebe cada valor de la nueva pieza." },
  { re: /国产(?:替代|的)?|换成|替换|替代料|代替|改用/, risk: "high",
    en: "The supplier changed a part (substitute / domestic equivalent). Ask for its datasheet and approve it before production.",
    it: "Il fornitore ha cambiato un componente (sostituto / equivalente cinese). Chiedi la scheda tecnica e approvalo prima della produzione.",
    de: "Der Lieferant hat ein Bauteil ersetzt (Ersatzteil / chinesisches Äquivalent). Datenblatt anfordern und vor der Produktion freigeben.",
    fr: "Le fournisseur a changé une pièce (substitut / équivalent chinois). Demandez sa fiche technique et validez-la avant la production.",
    es: "El proveedor cambió una pieza (sustituto / equivalente chino). Pida su hoja de datos y apruébela antes de producir." },
  { re: /典型值|typ\.?\b|typical/i, risk: "medium",
    en: "\"Typical\" value — not guaranteed. Ask for the minimum / maximum.",
    it: "Valore \"tipico\": non garantito. Chiedi il minimo / massimo.",
    de: "„Typischer“ Wert: nicht garantiert. Fragen Sie nach Minimum / Maximum.",
    fr: "Valeur « typique » : non garantie. Demandez le minimum / maximum.",
    es: "Valor \"típico\": no garantizado. Pida el mínimo / máximo." },
  { re: /左右|大约|约\s*\d|差不多|approx/i, risk: "medium",
    en: "\"About\" — not a firm value. Ask for a guaranteed limit.",
    it: "\"Circa\": non è un valore certo. Chiedi un limite garantito.",
    de: "„Ungefähr“: kein fester Wert. Fragen Sie nach einem garantierten Grenzwert.",
    fr: "« Environ » : pas une valeur ferme. Demandez une limite garantie.",
    es: "\"Aproximadamente\": no es un valor firme. Pida un límite garantizado." },
  { re: /问题不大|没问题|应该可以|应该没问题/, risk: "medium",
    en: "\"Should be fine\" — not a commitment. Get the value in writing.",
    it: "\"Non dovrebbe essere un problema\": non è un impegno. Fatti dare il valore per iscritto.",
    de: "„Sollte passen“ ist keine Zusage. Lassen Sie sich den Wert schriftlich geben.",
    fr: "« Ça devrait aller » n'est pas un engagement. Obtenez la valeur par écrit.",
    es: "\"No debería haber problema\" no es un compromiso. Pida el valor por escrito." },
];

/** A note says a part was swapped or claimed "the same", whatever language the note itself is in. */
export const isPartChangeNote = (n: { text_en: string; quote: string }) =>
  /substitut|domestic|changed a part|same parameters/i.test(n.text_en) || SOFT_CLAIMS[0].re.test(n.quote) || SOFT_CLAIMS[1].re.test(n.quote);
