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

  // seen in the server logs after the demo: a thank-you became a spec line with a "谢谢" draft for the supplier,
  // and "i have a meeting" opened an empty check
  it("chit-chat and the user's own plans never go into the spec check", async () => {
    const id = currentCheck(db, DEMO_USER)!.id;
    const items = () => loadCheck(db, id)!.items.length;
    const before = items();
    const [thanks] = await send([{ kind: "text", text: "GRAZIE" }]);
    expect(thanks.kind).toBe("text");
    expect(thanks.text).toContain("You're welcome");
    expect(thanks.copy).toBeUndefined();
    const [hi] = await send([{ kind: "text", text: "ciao!" }]);
    expect(hi.text).toContain("spec checker");
    const [meeting] = await send([{ kind: "text", text: "i have a meeting" }]);
    expect(meeting.text).toContain("Which day?");
    const [dated] = await send([{ kind: "text", text: "I have a meeting with the supplier on 15 December" }]);
    expect(dated.text).toContain("📅 Added");
    const [other] = await send([{ kind: "text", text: "send it to the factory later" }]);
    expect(other.text).toContain("didn't find any technical value");
    expect(items()).toBe(before);
    expect(currentCheck(db, DEMO_USER)!.id).toBe(id);
    // a typed requirement with a value still counts
    await send([{ kind: "text", text: "ripple ≤ 100 mV" }]);
    expect(items()).toBe(before + 1);
  });
});

describe("small talk", async () => {
  const { smallTalk } = await import("@/lib/core/ingest");
  it("recognises courtesies in EN / IT / ZH, alone", () => {
    for (const t of ["GRAZIE", "grazie mille 🙏", "thanks!", "ok thanks", "谢谢", "谢谢您！"]) expect(smallTalk(t), t).toBe("thanks");
    for (const t of ["ciao", "Hello!", "您好", "buongiorno"]) expect(smallTalk(t), t).toBe("greeting");
    for (const t of ["ok", "perfetto!", "收到", "好的"]) expect(smallTalk(t), t).toBe("ack");
    for (const t of ["thanks, but the ripple is 150 mV", "您好，纹波≤150mV", "ok send the excel", "ciao, quali sono le mie cose da fare?"]) expect(smallTalk(t), t).toBeNull();
  });
});

describe("rejected AI key", async () => {
  const { isAuthError } = await import("@/lib/adapters/llm");
  it("is told apart from other failures", () => {
    expect(isAuthError('401 {"error":{"message":"Invalid token. (request id: x)","type":"shell_api_error"}}')).toBe(true);
    expect(isAuthError("invalid_api_key")).toBe(true);
    expect(isAuthError("timeout after 4000ms")).toBe(false);
    expect(isAuthError("Failed to parse structured output")).toBe(false);
  });
});

describe("the user's language (set on the web app)", async () => {
  const { workspaceLang, setWorkspaceLang, FULL_LANGS } = await import("@/lib/core/lang");
  const { glossaryTranslate, ruleRead } = await import("@/lib/core/spec/extract");
  const { specWelcome } = await import("@/lib/core/spec/flow");
  const db = openDb(":memory:");
  await resetDemo(db, { profile: "electronics" });
  const ws = (db.prepare(`SELECT workspace_id AS w FROM users WHERE id = ?`).get(DEMO_USER) as { w: string }).w;
  const send = (items: Item[]) => handleIncoming({ userId: DEMO_USER, channel: "sim", items }, db);

  it("the bot greets in it and offers no language menu (the choice is on the web)", async () => {
    setWorkspaceLang(db, ws, "it");
    const [w] = await send([{ kind: "text", text: "ciao" }]);
    expect(w.kind).toBe("text");
    expect(w.text).toContain("tra italiano e cinese");
    expect(w.text).toContain("Impostazioni nel sito");
    expect(w.text).not.toContain("/lang");
    const [cmd] = await send([{ kind: "text", text: "/lang de" }]);
    expect(workspaceLang(db, ws)).toBe("it");
    expect(cmd.text ?? "").not.toContain("Deutsch");
    for (const l of FULL_LANGS) expect(Buffer.byteLength(specWelcome(l).text), l).toBeLessThanOrEqual(900);
  });

  it("the check, the bot replies and the sheet follow it; the supplier still gets Chinese", async () => {
    await send([{ kind: "text", text: "Temperatura di esercizio: -20 ~ +70 °C\nRipple e rumore: ≤ 120 mV" }]);
    const [r] = await send([{ kind: "text", text: SPEC_DEMO_TEXTS.reply }]);
    expect(r.text).toContain("🇮🇹");
    expect(r.text).toContain("Temperatura di esercizio: tu -20 ~ +70 °C → fornitore -10℃～+50℃");
    expect(r.text).toMatch(/Finora: 🔴 2/);
    expect(r.prompt).toContain("foglio di verifica");
    const replies = await send([{ kind: "text", text: "excel" }]);
    expect(replies[0].text).toContain("🔴 2 NON CONFORMI");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(replies[1].file!.path);
    const sheet = wb.worksheets[0];
    expect(sheet.name).toBe("核对表 Verifica");
    expect(String(sheet.getRow(4).getCell(2).value)).toBe("参数 Parametro");
    const labels: string[] = [];
    sheet.eachRow((row) => labels.push(String(row.getCell(2).value ?? "")));
    expect(labels).toContain("纹波噪声 Ripple e rumore");
    expect(replies[2].copy!.text).toContain("纹波噪声：我方要求 ≤ 120 mV");
  });

  it("languages without their own table: the bot stays in English", async () => {
    setWorkspaceLang(db, ws, "pt");
    const [w] = await send([{ kind: "text", text: "hello" }]);
    expect(w.text).toContain("between Português and Chinese");
  });

  it("rule translation, rule reading and the translation check work in the user's language", () => {
    expect(glossaryTranslate("输出电压：12V", false, "it")).toContain("Tensione di uscita");
    expect(glossaryTranslate("Tensione di uscita: 12 V", true, "it")).toContain("输出电压");
    expect(ruleRead("Betriebstemperatur: -20 ~ +70 °C", { lang: "de" }).parameters.map((p) => p.key)).toContain("operating_temp");
    expect(ruleRead("参数一样", { lang: "fr" }).notes[0].text_en).toContain("Mêmes paramètres");
    expect(checkTranslation("效率不低于88%", "Efficienza almeno 88%").ok).toBe(true);
    expect(checkTranslation("效率不低于88%", "Wirkungsgrad höchstens 88%").flipped.length).toBe(1);
  });
});
