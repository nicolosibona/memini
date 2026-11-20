import { describe, expect, it } from "vitest";
import { checkCreditCode, creditCodeCheckChar, looksLikePerson, nameSimilarity, normalizeName, isChinese } from "@/lib/core/normalize";
import registry from "@/data/registry.json";

describe("credit code", () => {
  it("accepts every demo registry code", () => {
    for (const c of registry.companies) expect(checkCreditCode(c.credit_code).valid).toBe(true);
  });
  it("accepts a well-known public example (Tencent Shenzhen)", () => {
    // 深圳市腾讯计算机系统有限公司
    expect(checkCreditCode("91440300708461136T").valid).toBe(true);
  });
  it("normalizes spaces and case", () => {
    expect(checkCreditCode(" 91440300 708461136t ").normalized).toBe("91440300708461136T");
  });
  it("rejects a wrong check digit", () => {
    const r = checkCreditCode("91440300708461136A");
    expect(r).toMatchObject({ valid: false, reason: "check_digit" });
  });
  it("rejects bad length and charset", () => {
    expect(checkCreditCode("9144030070846113").reason).toBe("length");
    expect(checkCreditCode("9144030070846I136T").reason).toBe("charset");
  });
  it("computes the check char", () => {
    expect(creditCodeCheckChar("91440300708461136")).toBe("T");
  });
});

describe("company names", () => {
  it("strips legal suffixes and city markers", () => {
    expect(normalizeName("深圳市ABC科技有限公司")).toBe("深圳abc科技");
    expect(normalizeName("Shenzhen ABC Technology Co., Ltd.")).toBe("shenzhenabctechnology");
    expect(normalizeName("Ningbo XYZ Electronics Co.,Ltd")).toBe("ningboxyzelectronics");
    expect(normalizeName("鑫达贸易（深圳）有限公司")).toBe("鑫达贸易深圳");
  });
  it("does not eat 'co' inside a word", () => {
    expect(normalizeName("Ningbo Disco")).toBe("ningbodisco");
  });
  it("scores partial matches", () => {
    expect(nameSimilarity("ABC Tech", "Shenzhen ABC Tech Co., Ltd.")).toBeGreaterThan(0.8);
    expect(nameSimilarity("深圳市ABC科技有限公司", "深圳ABC科技")).toBe(1);
    expect(nameSimilarity("宁波XYZ电子", "深圳市ABC科技")).toBeLessThan(0.3);
  });
});

describe("helpers", () => {
  it("spots personal beneficiaries", () => {
    expect(looksLikePerson("陈丽")).toBe(true);
    expect(looksLikePerson("ZHANG WEI")).toBe(true);
    expect(looksLikePerson("深圳市鑫达贸易有限公司")).toBe(false);
    expect(looksLikePerson("Shenzhen Xinda Trading Co., Ltd.")).toBe(false);
  });
  it("detects Chinese text", () => {
    expect(isChinese("亲，每个4.2美金，FOB深圳")).toBe(true);
    expect(isChinese("How much did Seller 2 quote?")).toBe(false);
  });
});
