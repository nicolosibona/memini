// Electronics spec-check demo: your spec (EN) + the supplier's datasheet (中文) + a WeChat message where the supplier
// swaps the output capacitor for a "same parameters" domestic part. PDFs/PNGs of the HTML files: scripts/gen-spec-demo.sh.
export const SPEC_DEMO_FILES = ["PS-1205_requirements_EN.html", "PS-1205_规格书.html"] as const;

export const SPEC_DEMO_TEXTS = {
  /** the supplier on WeChat, a day after the datasheet */
  swap: "王工：您好，PS-1205的输出电容我们换成国产的了，1000μF 16V 85℃，参数一样，不影响使用。交期还是25天。",
  /** the demo chat: what the buyer wrote to the supplier, and the supplier's answer (forward both to the bot) */
  mine: "Hi Wang, for PS-1205 we need: input voltage 100–240 VAC, output voltage 12 V, output current 5 A, ripple ≤ 120 mV, efficiency ≥ 88%, no-load power ≤ 0.2 W, operating temperature -20 to +70 °C, output capacitor 1000 µF ≥ 25 V 105 °C, certifications CE and RoHS.",
  reply: "您好，没问题。PS-1205输入电压100-240Vac，输出电压12V，输出电流5A，纹波≤150mV，效率88%（典型值），工作温度-10℃～+50℃，空载功耗≤0.3W，认证有CE和RoHS。",
  /** requirements typed by the buyer instead of a PDF */
  typed: "Our requirements for PS-1205:\nRipple & noise: ≤ 120 mV p-p\nEfficiency: ≥ 88 %\nOperating temperature: -20 to +70 °C\nOutput capacitor: 1000 µF, rated voltage ≥ 25 V, 105 °C",
} as const;
