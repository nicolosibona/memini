// End-to-end through the one core entry point, in mock mode (no AI): the sourcing demo (§15) and the China-business flow.
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LLM_PROVIDER = "mock";
process.env.MOCK_DELAY_MS = "0";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memini-"));

const { openDb, DEMO_USER, DEMO_WORKSPACE } = await import("@/lib/db");
const { handleIncoming, storeFile } = await import("@/lib/core/ingest");
const { resetDemo } = await import("@/lib/demo/seed");
const { DEMO_TEXTS } = await import("@/data/demo/fixtures");
const { openAlerts } = await import("@/lib/core/audit");
const { currentTerms } = await import("@/lib/core/facts");
const { listTasks } = await import("@/lib/core/tasks");
const { listMatters } = await import("@/lib/core/matters");
const { listEntities } = await import("@/lib/core/entities");

type Item = Parameters<typeof handleIncoming>[0]["items"][number];
let db: ReturnType<typeof openDb>;
const send = (items: Item[]) => handleIncoming({ userId: DEMO_USER, channel: "sim", items }, db);
const demoFile = (name: string) => storeFile(name, fs.readFileSync(path.join("data/demo", name)));
const entityNamed = (n: string) => listEntities(db, DEMO_WORKSPACE, { includeSelf: true }).find((e) => e.display_name === n)!.id;

describe("sourcing demo script", async () => {
  db = openDb(":memory:");
  await resetDemo(db, { profile: "sourcing" });
  const s1 = entityNamed("Shenzhen ABC Tech"), s2 = entityNamed("Ningbo XYZ");
  const purchase1 = () => listMatters(db, DEMO_WORKSPACE, { entityId: s1 })[0];

  it("only suppliers in the sourcing profile; Seller 2's late promise is flagged", () => {
    expect(listEntities(db, DEMO_WORKSPACE).map((e) => e.kind)).toEqual(["supplier", "supplier"]);
    expect(openAlerts(db, { entityId: s2 }).map((a) => a.code)).toContain("COMMITMENT_LATE");
  });

  it("step 2: no company name → menu with Seller 1 first; nothing saved yet", async () => {
    const [menu] = await send([{ kind: "text", text: DEMO_TEXTS.lisa }]);
    expect(menu.kind).toBe("menu");
    expect(menu.text).toContain("Who is this from? I think it's Seller 1");
    expect(menu.buttons![0].id).toBe(`ent:${s1}`);
    expect(menu.buttons!.map((b) => b.id)).toEqual(expect.arrayContaining(["ent:new", "ent:skip"]));
    expect(db.prepare(`SELECT COUNT(*) AS n FROM facts WHERE quote_original = '每个4.2美金'`).get()).toEqual({ n: 0 });
  });

  it("a second uncertain message joins the same question and the menu is sent again", async () => {
    const [r] = await send([{ kind: "text", text: "亲，包装是白盒，50个一箱。" }]);
    expect(r.kind).toBe("menu");
    expect(r.text).toContain("2 items are waiting");
    expect(r.buttons![0].id).toBe(`ent:${s1}`);
    expect(r.buttons!.map((b) => b.id)).toEqual(expect.arrayContaining(["ent:new", "ent:skip"]));
  });

  it("tap Seller 1 → filed under the charger purchase, 4.50 superseded by 4.20, promise tracked", async () => {
    const [r] = await send([{ kind: "text", menuId: `ent:${s1}` }]);
    expect(r.text).toContain("Filed under: Seller 1");
    expect(r.text).toContain("65W USB-C charger");
    expect(r.buttons!.map((b) => b.label)).toEqual(["Change where it's filed", "Mark terms as agreed"]);
    const price = currentTerms(db, { matterId: purchase1().id }).find((t) => t.key === "unit_price")!;
    expect(JSON.parse(price.current.value_json).amount).toBe(4.2);
    expect(listTasks(db, DEMO_WORKSPACE, { entityId: s1 }).map((t) => t.what)).toContain("Ship the sample");
  });

  it("step 3: license + proforma → recognized, 2 red flags, Chinese reply", async () => {
    const replies = await send([{ kind: "file", filePath: demoFile("abc_business_license.html") }, { kind: "file", filePath: demoFile("abc_proforma_PI-2026-118.html") }]);
    expect(replies).toHaveLength(1);
    const t = replies[0].text;
    expect(t).toContain("2 RED FLAGS");
    expect(t).toMatch(/Incoterm changed: EXW/);
    expect(t).toMatch(/Payee \(深圳市鑫达贸易有限公司\) is NOT/);
    expect(t).toContain("对公账户");
    expect(t).toMatch(/Consistent: .*unit price USD 4\.20/);
    expect(listMatters(db, DEMO_WORKSPACE, { entityId: s1 })).toHaveLength(1); // same purchase, not a new one
    expect(db.prepare(`SELECT credit_code, registry_status FROM entities WHERE id = ?`).get(s1)).toEqual({ credit_code: "91440300MA5G7K2C4D", registry_status: "存续" });
  });

  it("step 4: comparison only within the same product, with sources and warnings", async () => {
    const [r] = await send([{ kind: "text", text: DEMO_TEXTS.question }]);
    expect(r.text).toContain("65W USB-C charger:");
    expect(r.text).toContain("USD 3.95");
    expect(r.text).toContain("Seller 2 hasn't sent a business license");
    expect(r.text).toContain("EXW price isn't comparable");
  });

  it("change where it's filed: facts move, alerts on the wrong profile close", async () => {
    const [menu] = await send([{ kind: "file", filePath: demoFile("abc_ce_certificate.html") }]);
    expect(menu.kind).toBe("menu"); // a certificate holder never identifies the supplier
    const [r2] = await send([{ kind: "text", menuId: `ent:${s2}` }]);
    expect(openAlerts(db, { entityId: s2 }).map((a) => a.code)).toContain("CERT_HOLDER_MISMATCH");
    const chg = r2.buttons!.find((b) => b.id.startsWith("chg:"))!;
    const [m2] = await send([{ kind: "text", menuId: chg.id }]);
    expect(m2.buttons![0].id).toBe(`ent:${s1}`);
    const [moved] = await send([{ kind: "text", menuId: `ent:${s1}` }]);
    expect(moved.text).toContain("Moved from Seller 2");
    expect(openAlerts(db, { entityId: s2 }).map((a) => a.code)).not.toContain("CERT_HOLDER_MISMATCH");
    expect(db.prepare(`SELECT COUNT(*) AS n FROM facts WHERE entity_id = ? AND key = 'cert_model'`).get(s1)).toEqual({ n: 2 });
  });

  it("commands and WeCom retry dedupe", async () => {
    expect((await send([{ kind: "text", text: "/alerts" }]))[0].text).toContain("Incoterm changed");
    const item: Item = { kind: "text", text: "What did Seller 2 quote?", externalMsgId: "wx-1" };
    expect(await send([item])).toHaveLength(1);
    expect(await send([item])).toHaveLength(0);
  });

  it("an unanswered question from hours ago is closed: a new forward gets its own menu, the old items wait in To file", async () => {
    const [first] = await send([{ kind: "text", text: "亲，样品下周一寄出。" }]);
    expect(first.kind).toBe("menu");
    const old = db.prepare(`SELECT id FROM pending_groups WHERE status = 'open' AND awaiting = 'entity_choice'`).get() as { id: string };
    db.prepare(`UPDATE pending_groups SET menu_sent_at = ? WHERE id = ?`).run(new Date(Date.now() - 3 * 3600_000).toISOString(), old.id);
    const [next] = await send([{ kind: "text", text: "亲，模具费可以免掉。" }]);
    expect(next.kind).toBe("menu");
    expect(next.text).not.toContain("items are waiting");
    expect((db.prepare(`SELECT status FROM pending_groups WHERE id = ?`).get(old.id) as { status: string }).status).toBe("expired");
    expect((db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE text_original = '亲，样品下周一寄出。' AND status = 'pending'`).get() as { n: number }).n).toBe(1);
  });
});

describe("China business flow", async () => {
  beforeEach(async () => { db = openDb(":memory:"); await resetDemo(db, { profile: "china_business" }); });

  it("seed: residence permit renewal due soon, rent recurring", () => {
    const tasks = listTasks(db, DEMO_WORKSPACE, { status: "open" }).map((t) => t.what);
    expect(tasks.some((t) => t.startsWith("Renew Residence permit"))).toBe(true);
    expect(openAlerts(db, { workspaceId: DEMO_WORKSPACE }).map((a) => a.code)).toContain("DEADLINE_SOON");
  });

  it("a lease forwarded → filed under the landlord's lease, 3 red flags, Chinese reply, rent becomes a monthly payment", async () => {
    const landlord = entityNamed("Jing'an Property");
    const [r] = await send([{ kind: "file", filePath: demoFile("office_lease_contract.html") }]);
    expect(r.text).toContain("Filed under: Jing'an Property");
    expect(r.text).toContain("Office lease – Room 1203");
    expect(r.text).toContain("3 RED FLAGS");
    expect(r.text).toMatch(/Rent \(per month\) changed: CNY 19,500/);
    expect(r.text).toMatch(/Payee "王芳" looks like a private person/);
    expect(r.text).toContain("租金");
    expect(r.text).toContain("Don't pay or sign until the red flags are cleared");
    expect(r.text).not.toMatch(/• Pay the security deposit/);
    const codes = openAlerts(db, { entityId: landlord }).map((a) => a.code);
    expect(codes.filter((c) => c === "AMOUNT_CHANGED")).toHaveLength(2);
    // the next rent reminder follows the contract, not the chat
    expect(listTasks(db, DEMO_WORKSPACE, { entityId: landlord }).some((t) => t.kind === "payment" && t.what.startsWith("Pay rent (CNY 19,500)"))).toBe(true);
  });

  it("a tax notice → filed under Tax with a deadline, no Chinese reply to a government office", async () => {
    const [r] = await send([{ kind: "file", filePath: demoFile("tax_notice_vat.html") }]);
    expect(r.text).toContain("Filed under: Jing'an Tax Bureau");
    expect(r.text).toContain("Tax & accounting");
    expect(r.text).not.toContain("Suggested reply");
    expect(r.text).toContain("File October + November VAT returns");
    const t = listTasks(db, DEMO_WORKSPACE, { status: "open" }).find((x) => x.what.startsWith("File October"));
    expect(t?.due_at).toBe("2026-12-15");
    expect(t?.matter_title).toBe("Tax & accounting");
  });

  it("deadlines question", async () => {
    const [r] = await send([{ kind: "text", text: "What's due this month?" }]);
    expect(r.text).toMatch(/Renew Residence permit|Pay rent|fapiao/);
  });
});
