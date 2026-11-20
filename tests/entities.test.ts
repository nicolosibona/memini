import { beforeEach, describe, expect, it } from "vitest";
import { openDb, DEMO_WORKSPACE, type DB } from "@/lib/db";
import { createEntity, learnAliases, resolveEntity, shortName, type Clue } from "@/lib/core/entities";
import { createMatter, pickMatter, comparableGroups } from "@/lib/core/matters";

const ABC_CODE = "91440300MA5G7K2C4D";
let db: DB, abc: string, xyz: string, landlord: string;
const strong = (value: string, role = "subject", kind: Clue["kind"] = "legal_name"): Clue => ({ kind, value, strong: true, role });

beforeEach(() => {
  db = openDb(":memory:");
  abc = createEntity(db, DEMO_WORKSPACE, { kind: "supplier", display_name: "Shenzhen ABC Tech", legal_name_zh: "深圳市ABC科技有限公司", legal_name_en: "Shenzhen ABC Technology Co., Ltd." }).id;
  xyz = createEntity(db, DEMO_WORKSPACE, { kind: "supplier", display_name: "Ningbo XYZ", legal_name_zh: "宁波XYZ电子有限公司" }).id;
  landlord = createEntity(db, DEMO_WORKSPACE, { kind: "landlord", display_name: "Jing'an Property", legal_name_zh: "上海静安置业有限公司" }).id;
});
const resolve = (clues: Clue[], recent?: string) => resolveEntity(db, { workspaceId: DEMO_WORKSPACE, clues, recentEntityId: recent });

describe("resolveEntity — never guess", () => {
  it("certain on an exact license name", () => expect(resolve([strong("深圳市ABC科技有限公司")]).certainId).toBe(abc));
  it("certain on a landlord name from a lease", () => expect(resolve([strong("上海静安置业有限公司", "landlord")]).certainId).toBe(landlord));
  it("certain on a known credit code", () => {
    db.prepare(`UPDATE entities SET credit_code = ? WHERE id = ?`).run(ABC_CODE, abc);
    expect(resolve([strong(ABC_CODE, "seller", "credit_code")]).certainId).toBe(abc);
  });
  it("weak clues (names typed in a chat) never make it certain", () => {
    const r = resolve([{ kind: "legal_name", value: "深圳市ABC科技有限公司", strong: false }]);
    expect(r.certainId).toBeNull();
    expect(r.candidates[0].id).toBe(abc);
  });
  it("asks when there is no clue, recent counterparty first", () => {
    const r = resolve([], xyz);
    expect(r.certainId).toBeNull();
    expect(r.guessId).toBe(xyz);
  });
  it("a nickname ranks first but is never certain; an ambiguous one doesn't rank", () => {
    learnAliases(db, abc, [{ kind: "wechat_nickname", value: "Lisa 🌸 Sales", strong: false }], "user_choice");
    expect(resolve([{ kind: "wechat_nickname", value: "Lisa 🌸 Sales", strong: false }], xyz).candidates[0].id).toBe(abc);
    learnAliases(db, xyz, [{ kind: "wechat_nickname", value: "Lisa 🌸 Sales", strong: false }], "user_choice");
    expect(resolve([{ kind: "wechat_nickname", value: "Lisa 🌸 Sales", strong: false }]).guessId).toBeNull();
  });
  it("conflict: license and proforma point to different companies", () => {
    const r = resolve([strong("深圳市ABC科技有限公司"), strong("深圳市鑫达贸易有限公司", "seller")]);
    expect(r.certainId).toBeNull();
    expect(r.conflict).toContain("鑫达");
  });
  it("an unknown authority becomes a proposed new government office", () => {
    const r = resolve([{ kind: "legal_name", value: "国家税务总局上海市徐汇区税务局", strong: true, role: "authority", partyKind: "government" }]);
    expect(r.newName).toBe("国家税务总局上海市徐汇区税务局");
    expect(r.newKind).toBe("government");
  });
  it("your own company is never a counterparty clue", () => {
    expect(resolve([strong("Nordlys Home Goods ApS", "seller")]).newName).toBeNull();
  });
});

describe("matters", () => {
  it("one supplier, two different products → two purchases; same product → same purchase", () => {
    const first = pickMatter(db, DEMO_WORKSPACE, { kind: "purchase", entityId: abc, subject: "65W USB-C charger" });
    const again = pickMatter(db, DEMO_WORKSPACE, { kind: "purchase", entityId: abc, subject: "65W GaN USB-C charger" });
    const other = pickMatter(db, DEMO_WORKSPACE, { kind: "purchase", entityId: abc, subject: "Power bank 20000mAh" });
    expect("matter" in first && "matter" in again && first.matter.id === again.matter.id).toBe(true);
    expect("matter" in other && "matter" in first && other.matter.id !== first.matter.id).toBe(true);
  });
  it("tax matters are workspace-wide (the tax office's notice joins the accountant's matter)", () => {
    const tax = createMatter(db, DEMO_WORKSPACE, { kind: "tax", entityId: landlord, title: "Tax & accounting" });
    const pick = pickMatter(db, DEMO_WORKSPACE, { kind: "tax", entityId: abc });
    expect("matter" in pick && pick.matter.id).toBe(tax.id);
  });
  it("only purchases of the same product are comparable", () => {
    createMatter(db, DEMO_WORKSPACE, { kind: "purchase", entityId: abc, subject: "65W USB-C charger" });
    createMatter(db, DEMO_WORKSPACE, { kind: "purchase", entityId: xyz, subject: "65W usb-c Charger" });
    createMatter(db, DEMO_WORKSPACE, { kind: "purchase", entityId: xyz, subject: "Bamboo cutting board" });
    const groups = comparableGroups(db, DEMO_WORKSPACE);
    expect(groups[0].matters).toHaveLength(2);
    expect(groups.find((g) => g.subject === "Bamboo cutting board")!.matters).toHaveLength(1);
  });
});

describe("shortName", () => {
  it("drops suffixes", () => {
    expect(shortName("深圳市ABC科技有限公司")).toBe("深圳ABC科技");
    expect(shortName("Guangzhou DEF Hardware Co., Ltd.")).toBe("Guangzhou DEF Hardware");
  });
});

describe("menu order follows the content", () => {
  it("a quote puts suppliers before the landlord, even if the landlord was more recent", () => {
    const db2 = openDb(":memory:");
    const a = createEntity(db2, DEMO_WORKSPACE, { kind: "supplier", display_name: "A" }).id;
    const b = createEntity(db2, DEMO_WORKSPACE, { kind: "supplier", display_name: "B" }).id;
    const l = createEntity(db2, DEMO_WORKSPACE, { kind: "landlord", display_name: "L" }).id;
    db2.prepare(`UPDATE entities SET last_activity_at = CASE id WHEN ? THEN '2026-11-20' WHEN ? THEN '2026-11-01' ELSE '2026-11-19' END`).run(l, b);
    const r = resolveEntity(db2, { workspaceId: DEMO_WORKSPACE, clues: [], recentEntityId: a, preferKinds: ["supplier"] });
    expect(r.candidates.map((c) => c.id).slice(0, 3)).toEqual([a, b, l]);
    expect(r.guessId).toBe(a);
  });
});
