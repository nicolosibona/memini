// LIVE tests: real AI calls. Run with `npm run test:live` after filling .env.local (LLM_PROVIDER=gateway or anthropic).
// They answer the open questions of blueprint §17.11 (does the gateway pass structured outputs, images, tools?) and act as the
// §19.7 bake-off: every demo document must be read as the golden answer says, and fallbacks count as FAILURES here.
// Change MODEL_* in .env.local and re-run to compare models; the summary prints latency and estimated cost per step.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

try { process.loadEnvFile(".env.local"); } catch { /* no .env.local */ }
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memini-live-"));
process.env.DB_PATH = ":memory:";

const live = !!process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== "mock";
const d = live ? describe : describe.skip;

const { callJSON, provider, modelFor } = await import("@/lib/adapters/llm");
const { getDb, DEMO_USER, DEMO_WORKSPACE } = await import("@/lib/db");
const { extractDocument, extractText } = await import("@/lib/core/extract");
const { handleIncoming, storeFile } = await import("@/lib/core/ingest");
const { resetDemo } = await import("@/lib/demo/seed");
const { ask } = await import("@/lib/core/assistant");
const { DEMO_TEXTS } = await import("@/data/demo/fixtures");
const { z } = await import("zod");

const demo = (f: string) => storeFile(f, fs.readFileSync(path.join("data/demo", f)));
const facts = (x: { facts: { key: string; value_number: number | null; value_text: string | null }[] }) =>
  Object.fromEntries(x.facts.map((f) => [f.key, f.value_number ?? f.value_text]));

d(`live AI (${provider})`, () => {
  beforeAll(async () => { await resetDemo(getDb(), { profile: "china_business" }); });
  afterAll(() => {
    const rows = getDb().prepare(`SELECT step, model, source, COUNT(*) n, ROUND(AVG(ms)) avg_ms, ROUND(SUM(est_cost_usd), 4) usd FROM llm_calls GROUP BY step, model, source`).all();
    console.table(rows);
  });

  describe("gateway capabilities (§17.11)", () => {
    it("structured output (JSON schema) round-trip", async () => {
      const r = await callJSON({ step: "intent", system: "Classify.", text: "How much did Seller 2 quote?", schema: z.object({ intent: z.enum(["content", "question", "command"]), confidence: z.number() }), fallback: () => ({ intent: "command" as const, confidence: 0 }) });
      expect(r.source, r.error).toBe(provider);
      expect(r.data.intent).toBe("question");
    });
    it("image input", async () => {
      // 1×1 red PNG: only checks that images pass through the gateway
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
      const r = await callJSON({ step: "extract", system: "Describe the image.", text: "What is the dominant colour?", imageDataUrls: [`data:image/png;base64,${png}`], schema: z.object({ colour: z.string() }), fallback: () => ({ colour: "FALLBACK" }) });
      expect(r.source, r.error).toBe(provider);
    });
  });

  describe("document extraction vs golden answers", () => {
    it("business license → identity", async () => {
      const { data, source } = await extractDocument(demo("abc_business_license.html"));
      expect(source).toBe(provider);
      expect(data.doc_type).toBe("business_license");
      const subj = data.parties.find((p) => p.role === "subject");
      expect(subj?.name).toBe("深圳市ABC科技有限公司");
      expect(subj?.credit_code).toBe("91440300MA5G7K2C4D");
    });
    it("proforma → the two traps are readable", async () => {
      const { data, source } = await extractDocument(demo("abc_proforma_PI-2026-118.html"));
      expect(source).toBe(provider);
      expect(data.doc_type).toBe("proforma_invoice");
      expect(facts(data).incoterm).toMatch(/EXW/i);
      expect(data.line_items[0]?.unit_price).toBe(4.2);
      expect(data.parties.find((p) => p.role === "seller")?.name).toMatch(/ABC/);
      expect(data.parties.find((p) => p.role === "beneficiary")?.name).toContain("鑫达");
      expect(data.parties.find((p) => p.role === "buyer")?.name).toMatch(/Nordlys/);
    });
    it("lease → rent, deposit, personal payee, end date", async () => {
      const { data, source } = await extractDocument(demo("office_lease_contract.html"));
      expect(source).toBe(provider);
      expect(data.doc_type).toBe("lease_contract");
      const f = facts(data);
      expect(f.rent_amount).toBe(19500);
      expect(f.security_deposit).toBe(39000);
      expect(data.parties.find((p) => p.role === "landlord")?.name).toBe("上海静安置业有限公司");
      expect(data.parties.find((p) => p.role === "beneficiary")?.name).toBe("王芳");
      expect(data.expiry_date ?? f.lease_end).toBe("2027-11-30");
    });
    it("tax notice → authority + deadline", async () => {
      const { data, source } = await extractDocument(demo("tax_notice_vat.html"));
      expect(source).toBe(provider);
      expect(data.doc_type).toBe("tax_notice");
      expect(data.parties.find((p) => p.role === "authority")?.name).toContain("静安区税务局");
      expect([facts(data).filing_deadline, ...data.tasks.map((t) => t.due)]).toContain("2026-12-15");
    });
    it("CE certificate → models + expiry, holder is not an identifying role", async () => {
      const { data } = await extractDocument(demo("abc_ce_certificate.html"));
      expect(data.doc_type).toBe("certificate");
      expect(data.expiry_date).toBe("2029-03-09");
      expect(data.parties.some((p) => ["seller", "subject", "issuer"].includes(p.role) && /ABC/.test(p.name))).toBe(false);
    });
  });

  describe("chat understanding", () => {
    it("Lisa's message: facts with real quotes, subtext, the sample promise", async () => {
      const { data, source } = await extractText(DEMO_TEXTS.lisa, new Date().toISOString());
      expect(source).toBe(provider);
      const f = facts(data);
      expect(f.unit_price).toBe(4.2);
      expect(f.incoterm).toMatch(/FOB/i);
      expect(f.lead_time_days).toBe(15);
      expect(data.translation.length).toBeGreaterThan(40);
      expect(data.subtext.some((s) => s.phrase.includes("尽量"))).toBe(true);
      expect(data.tasks.some((t) => t.who === "counterparty")).toBe(true);
      for (const x of data.facts) expect(DEMO_TEXTS.lisa).toContain(x.quote_original.replace(/\s/g, "").slice(0, 4));
    });
  });

  describe("end to end", () => {
    it("forwarding the lease raises the 3 red flags and drafts Chinese", async () => {
      const [r] = await handleIncoming({ userId: DEMO_USER, channel: "sim", items: [{ kind: "file", filePath: demo("office_lease_contract.html") }] }, getDb());
      expect(r.text).toContain("Filed under: Jing'an Property");
      expect(r.text).toContain("3 RED FLAGS");
      expect(r.text).toMatch(/[一-鿿]{10,}/);
    });
    it("assistant with tools answers from memory with sources", async () => {
      const a = await ask(getDb(), DEMO_WORKSPACE, "Is Seller 1 or Seller 2 the better deal for the charger?");
      expect(a.source).toBe("live");
      expect(a.tools).toContain("compare_quotes");
      expect(a.text).toMatch(/3\.95/);
    });
  });

  it("prints the models in use", () => {
    console.log(Object.fromEntries((["intent", "extract", "analyze", "draft", "assistant"] as const).map((s) => [s, modelFor(s)])));
  });
});

if (!live) describe("live AI", () => it.skip("set LLM_PROVIDER (gateway | anthropic) and keys in .env.local to run these", () => {}));
