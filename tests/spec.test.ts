// Electronics spec check, end to end in mock mode (no AI): spec + datasheet + a supplier chat through handleIncoming,
// then the deterministic table, the translation check and the .xlsx.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";

process.env.LLM_PROVIDER = "mock";
process.env.MOCK_DELAY_MS = "0";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memini-spec-"));

const { openDb, DEMO_USER } = await import("@/lib/db");
const { handleIncoming, storeFile } = await import("@/lib/core/ingest");
const { resetDemo } = await import("@/lib/demo/seed");
const { loadCheck, currentCheck } = await import("@/lib/core/spec/store");
const { judge } = await import("@/lib/core/spec/compare");
const { checkTranslation, parseQty, parseRange, fmtQty } = await import("@/lib/core/spec/quantity");
const { SPEC_DEMO_TEXTS } = await import("@/data/demo/spec");

type Item = Parameters<typeof handleIncoming>[0]["items"][number];
const p = (key: string, value: string, op: string, side: "requirement" | "supplier" = "requirement") =>
  ({ key, component: null, label: key, value, op, num: null, num_max: null, unit: null, quote: value, item_id: "x", item_title: "x", side, order: 0 }) as never;

describe("quantities", () => {
  it("parses units in both languages and prefixes", () => {
    expect(parseQty("150mVp-p")).toEqual({ value: 0.15, dim: "V" });
    expect(parseQty("1000μF")!.value).toBeCloseTo(0.001);
    expect(parseQty("1000UF")!.value).toBeCloseTo(0.001);
    expect(parseQty("16伏")).toEqual({ value: 16, dim: "V" });
    expect(parseQty("30000小时")).toEqual({ value: 30000, dim: "h" });
    expect(parseQty("1.5m")).toEqual({ value: 1.5, dim: "m" });
    expect(parseRange("-10℃～+50℃")).toEqual({ lo: { value: -10, dim: "°C" }, hi: { value: 50, dim: "°C" } });
    expect(parseRange("100-240Vac")!.hi).toEqual({ value: 240, dim: "V" });
    expect(fmtQty({ value: 0.00047, dim: "F" })).toBe("470 µF");
  });

  it("judges each rule", () => {
    expect(judge("rated_voltage", p("rated_voltage", "≥ 25 V", "min"), p("rated_voltage", "16V", "eq", "supplier")).status).toBe("mismatch");
    expect(judge("ripple_noise", p("ripple_noise", "≤ 120 mV p-p", "max"), p("ripple_noise", "≤0.1V", "max", "supplier")).status).toBe("ok");
    expect(judge("operating_temp", p("operating_temp", "-20 to +70 °C", "range"), p("operating_temp", "-10℃～+50℃", "range", "supplier")).status).toBe("mismatch");
    expect(judge("efficiency", p("efficiency", "≥ 88 %", "min"), p("efficiency", "88%（典型值）", "typ", "supplier")).status).toBe("check");
    expect(judge("protections", p("protections", "OVP, OCP, SCP, OTP", "text"), p("protections", "过压保护、过流保护、短路保护", "text", "supplier")).en).toBe("Missing: OTP");
    expect(judge("certifications", p("certifications", "CE, RoHS", "text"), p("certifications", "CE、FCC、RoHS", "text", "supplier")).status).toBe("ok");
    expect(judge("capacitance", p("capacitance", "1000 µF", "eq"), null).status).toBe("missing");
  });

  it("translation check catches a lost number and a flipped limit", () => {
    expect(checkTranslation("纹波噪声：≤150mVp-p", "Ripple & noise: ≤150mVp-p").ok).toBe(true);
    expect(checkTranslation("工作温度：-10℃～+50℃", "Operating temperature: -10 to 50 °C").ok).toBe(true);
    expect(checkTranslation("输出电容：1000μF/25V 105℃", "Output capacitor: 1000 µF / 25 V").missing).toEqual(["105℃"]);
    expect(checkTranslation("效率不低于88%", "Efficiency at most 88%").flipped.length).toBe(1);
    expect(checkTranslation("型号：PS-1205", "Model: PS-1250").missing).toContain("PS-1205");
  });
});

describe("spec check through the bot", async () => {
  const db = openDb(":memory:");
  await resetDemo(db, { profile: "electronics" });
  const send = (items: Item[]) => handleIncoming({ userId: DEMO_USER, channel: "sim", items }, db);
  const file = (name: string) => storeFile(name, fs.readFileSync(path.join("data/demo/spec", name)));
  const view = () => loadCheck(db, currentCheck(db, DEMO_USER)!.id)!;

  it("a forward gets ONE short reply, no file (fast, within WeChat's limit)", async () => {
    const replies = await send([{ kind: "file", filePath: file("PS-1205_requirements_EN.html") }]);
    expect(replies.map((r) => r.kind)).toEqual(["menu"]);
    expect(replies[0].text).toContain("📐");
    expect(replies[0].buttons!.map((b) => b.id)).toContain("spec:sheet");
  });

  it("datasheet + chat → mismatches as they come, the capacitor swap caught", async () => {
    await send([{ kind: "file", filePath: file("PS-1205_规格书.html") }]);
    const [r] = await send([{ kind: "text", text: SPEC_DEMO_TEXTS.swap }]);
    expect(r.text).toContain("Output capacitor – rated voltage: you ≥ 25 V → supplier 16V (was 25V)");
    expect(r.text).toMatch(/So far: 🔴 6/);
    const v = view();
    const row = (label: string) => v.rows.find((x) => x.label_en === label)!;
    expect(row("Ripple & noise").status).toBe("mismatch");
    expect(row("Operating temperature").status).toBe("mismatch");
    expect(row("MTBF").status).toBe("mismatch");
    expect(row("Protections").reason_en).toBe("Missing: OTP");
    expect(row("Efficiency").status).toBe("check");
    expect(row("Output capacitor – temperature rating").status).toBe("mismatch");
    expect(row("Certifications").status).toBe("ok");
    expect(v.counts.mismatch).toBe(6);
  });

  it("\"excel\" → summary with EU warnings, the file, the Chinese message", async () => {
    const replies = await send([{ kind: "text", text: "fammi l'excel" }]);
    expect(replies.map((r) => r.kind)).toEqual(["text", "file", "menu"]);
    expect(replies[0].text).toMatch(/🔴 6 MISMATCHES/);
    expect(replies[0].text).toContain("🇪🇺 EU compliance");
    expect(replies[0].text).toContain("no-load ≤0.3W > 0.21 W");
    expect(replies[2].copy!.text).toContain("纹波噪声：我方要求 ≤ 120 mV p-p，贵方 ≤150mVp-p");
    expect(replies[2].copy!.text).toContain("欧盟符合性声明");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(replies[1].file!.path);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["核对表 Check"]);
    const ws = wb.worksheets[0];
    expect(String(ws.getRow(5).getCell(2).value)).toContain("Part number");
    expect(ws.getRow(5).getCell(7).dataValidation?.type).toBe("list");
    const all: string[] = [];
    ws.eachRow((r) => all.push(String(r.getCell(2).value ?? "")));
    expect(all.some((t) => t.includes("EU 2019/1782"))).toBe(true);
  });

  it("forwarded chat prose (both sides) is read without a model too", async () => {
    await send([{ kind: "text", text: "/new" }]);
    const [mine] = await send([{ kind: "merged", originalAuthor: "Nicolò", text: SPEC_DEMO_TEXTS.mine }]);
    expect(mine.text).toContain("📐 Nicolò");
    const [theirs] = await send([{ kind: "merged", originalAuthor: "王工", text: SPEC_DEMO_TEXTS.reply }]);
    expect(theirs.text).toContain("🏭 王工");
    const v = view();
    const row = (label: string) => v.rows.find((x) => x.label_en === label)!;
    expect(row("Ripple & noise").status).toBe("mismatch");
    expect(row("Operating temperature").status).toBe("mismatch");
    expect(row("Efficiency").status).toBe("check");
  });

  it("a batch with a newer one waiting (WeChat burst) stays silent; its item is still in the check", async () => {
    const before = view().items.length;
    const r = await handleIncoming({ userId: DEMO_USER, channel: "sim", items: [{ kind: "text", text: "效率：≥90%" }], superseded: () => true }, db);
    expect(r).toEqual([]);
    expect(view().items.length).toBe(before + 1);
  });

  it("/new starts a fresh check", async () => {
    const before = currentCheck(db, DEMO_USER)!.id;
    const [r] = await send([{ kind: "text", text: "/new" }]);
    expect(r.text).toContain("New spec check");
    expect(currentCheck(db, DEMO_USER)!.id).not.toBe(before);
  });
});
