import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LLM_PROVIDER = "mock";
process.env.MOCK_DELAY_MS = "0";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "memini-outreach-"));

const { openDb, DEMO_WORKSPACE } = await import("@/lib/db");
const { resetDemo } = await import("@/lib/demo/seed");
const { createEntity } = await import("@/lib/core/entities");
const { listMatters } = await import("@/lib/core/matters");
const { comparisons } = await import("@/lib/core/memory");
const {
  createOutreachCampaign,
  ensureOutreachSuppliers,
  evaluateAutoFilter,
  getOutreachByToken,
  listOutreachCampaigns,
  simulateOutreachCampaign,
  submitOutreachResponse,
} = await import("@/lib/core/outreach");

let db: ReturnType<typeof openDb>;

describe("Automated First Contact — RFQ Outreach & Auto-Filtering", () => {
  beforeEach(async () => {
    db = openDb(":memory:");
    await resetDemo(db, { profile: "sourcing" });
  });

  it("creates an outreach campaign, generates Chinese RFQ messages with unique /rfq/[token] links, and marks recipients as sent", async () => {
    const suppliers = ensureOutreachSuppliers(db, DEMO_WORKSPACE);
    expect(suppliers.length).toBeGreaterThanOrEqual(8);

    const matter = listMatters(db, DEMO_WORKSPACE)[0];
    const selectedIds = suppliers.slice(0, 6).map((s) => s.id);

    const campaign = await createOutreachCampaign(db, {
      workspaceId: DEMO_WORKSPACE,
      matterId: matter.id,
      targetPrice: 4.0,
      currency: "USD",
      targetQuantity: 1000,
      preferredIncoterm: "FOB",
      maxLeadTimeDays: 20,
      deadline: "2026-12-01",
      contactIds: selectedIds,
    });

    expect(campaign.matterId).toBe(matter.id);
    expect(campaign.targetPrice).toBe(4.0);
    expect(campaign.currency).toBe("USD");
    expect(campaign.targetQuantity).toBe(1000);
    expect(campaign.preferredIncoterm).toBe("FOB");
    expect(campaign.maxLeadTimeDays).toBe(20);
    expect(campaign.recipients).toHaveLength(6);

    const tokens = new Set<string>();
    for (const r of campaign.recipients) {
      expect(r.status).toBe("sent");
      expect(r.token).toBeTruthy();
      tokens.add(r.token);
      expect(r.chineseMessage).toContain(`/rfq/${r.token}`);
      expect(r.chineseMessage).toContain("1,000");
      expect(r.chineseMessage).toContain("FOB");

      const lookup = getOutreachByToken(db, r.token);
      expect(lookup?.recipient.contactId).toBe(r.contactId);
      expect(lookup?.campaign.id).toBe(campaign.id);
    }
    expect(tokens.size).toBe(6);
    expect(listOutreachCampaigns(db, DEMO_WORKSPACE)).toHaveLength(1);
  });

  it("deterministic evaluateAutoFilter checks price (+25%), MOQ (1.5x), and critical red flags", () => {
    // 1. Within bounds -> shortlisted
    const ok = evaluateAutoFilter({
      targetPrice: 4.0,
      targetCurrency: "USD",
      targetQuantity: 1000,
      unitPrice: 4.8, // +20% (<= +25%)
      quoteCurrency: "USD",
      moq: 1500, // 1.5x (<= 1.5x)
      alerts: [{ severity: "amber", code: "COMMITMENT_LATE", title: "Late sample" }], // amber is not critical
    });
    expect(ok.status).toBe("shortlisted");
    expect(ok.filterReason).toBeUndefined();

    // 2. Price exceeds targetPrice * 1.25 -> filtered_out
    const highPrice = evaluateAutoFilter({
      targetPrice: 4.0,
      targetCurrency: "USD",
      targetQuantity: 1000,
      unitPrice: 5.8, // +45%
      quoteCurrency: "USD",
      moq: 1000,
      alerts: [],
    });
    expect(highPrice.status).toBe("filtered_out");
    expect(highPrice.filterReason).toContain("Price +45% over budget");

    // 3. MOQ exceeds targetQuantity * 1.5 -> filtered_out
    const highMoq = evaluateAutoFilter({
      targetPrice: 4.0,
      targetCurrency: "USD",
      targetQuantity: 1000,
      unitPrice: 3.9,
      quoteCurrency: "USD",
      moq: 2500, // 2.5x (> 1.5x)
      alerts: [],
    });
    expect(highMoq.status).toBe("filtered_out");
    expect(highMoq.filterReason).toContain("MOQ too high");

    // 4. Critical red flag from audit.ts -> filtered_out
    const redFlag = evaluateAutoFilter({
      targetPrice: 4.0,
      targetCurrency: "USD",
      targetQuantity: 1000,
      unitPrice: 3.8,
      quoteCurrency: "USD",
      moq: 500,
      alerts: [{ severity: "red", code: "PERSONAL_ACCOUNT", title: 'Payee "陈丽" looks like a private person' }],
    });
    expect(redFlag.status).toBe("filtered_out");
    expect(redFlag.filterReason).toContain("Critical red flag");
  });

  it("ingests responses through ingest.ts + audit.ts, filters out unrealistic/red-flag quotes, and pushes ONLY shortlisted quotes into /compare", async () => {
    const matter = listMatters(db, DEMO_WORKSPACE)[0];
    const sGood1 = createEntity(db, DEMO_WORKSPACE, {
      kind: "supplier",
      display_name: "Shenzhen GoodFactory 1",
      legal_name_zh: "深圳市优品电子有限公司",
    });
    const sGood2 = createEntity(db, DEMO_WORKSPACE, {
      kind: "supplier",
      display_name: "Ningbo GoodFactory 2",
      legal_name_zh: "宁波市佳源科技有限公司",
    });
    const sOverBudget = createEntity(db, DEMO_WORKSPACE, {
      kind: "supplier",
      display_name: "Guangzhou Expensive Co",
      legal_name_zh: "广州市高价电子有限公司",
    });
    const sHighMoq = createEntity(db, DEMO_WORKSPACE, {
      kind: "supplier",
      display_name: "Foshan BulkOnly Co",
      legal_name_zh: "佛山市大批量制造有限公司",
    });
    const sRedFlag = createEntity(db, DEMO_WORKSPACE, {
      kind: "supplier",
      display_name: "Dongguan Hongfa Revoked",
      legal_name_zh: "东莞市宏发电器有限公司",
      credit_code: "91441900MA4U6E1B9U", // Revoked (吊销) in registry.json -> audit.ts flags REGISTRY_INACTIVE (red)
    });
    const sNoReply = createEntity(db, DEMO_WORKSPACE, {
      kind: "supplier",
      display_name: "Ghost Supplier Co",
      legal_name_zh: "苏州市静默电子有限公司",
    });

    const campaign = await createOutreachCampaign(db, {
      workspaceId: DEMO_WORKSPACE,
      matterId: matter.id,
      targetPrice: 4.0,
      currency: "USD",
      targetQuantity: 1000,
      preferredIncoterm: "FOB",
      maxLeadTimeDays: 20,
      contactIds: [sGood1.id, sGood2.id, sOverBudget.id, sHighMoq.id, sRedFlag.id, sNoReply.id],
    });

    const tokenOf = (contactId: string) => campaign.recipients.find((r) => r.contactId === contactId)!.token;

    // 1. Good supplier 1 submits realistic USD quote -> shortlisted
    const r1 = await submitOutreachResponse(db, tokenOf(sGood1.id), {
      unitPrice: 3.85,
      currency: "USD",
      moq: 500,
      leadTimeDays: 14,
      incoterm: "FOB",
      port: "Shenzhen",
      notes: "含CE认证，可随时寄样",
    });
    expect(r1.recipient.status).toBe("shortlisted");
    expect(r1.quoteDocumentId).toBeTruthy();

    // 2. Good supplier 2 submits realistic RMB quote (27.36 RMB = $3.80 USD at 7.2) -> shortlisted
    const r2 = await submitOutreachResponse(db, tokenOf(sGood2.id), {
      unitPrice: 27.36,
      currency: "RMB",
      moq: 1000,
      leadTimeDays: 18,
      incoterm: "FOB",
      port: "Ningbo",
    });
    expect(r2.recipient.status).toBe("shortlisted");

    // 3. Over-budget supplier submits $6.00 (+50% > +25%) -> filtered_out
    const r3 = await submitOutreachResponse(db, tokenOf(sOverBudget.id), {
      unitPrice: 6.0,
      currency: "USD",
      moq: 500,
      leadTimeDays: 15,
      incoterm: "FOB",
    });
    expect(r3.recipient.status).toBe("filtered_out");
    expect(r3.recipient.filterReason).toContain("Price +50% over budget");

    // 4. High-MOQ supplier submits MOQ 3000 (> 1000 * 1.5) -> filtered_out
    const r4 = await submitOutreachResponse(db, tokenOf(sHighMoq.id), {
      unitPrice: 3.9,
      currency: "USD",
      moq: 3000,
      leadTimeDays: 15,
      incoterm: "FOB",
    });
    expect(r4.recipient.status).toBe("filtered_out");
    expect(r4.recipient.filterReason).toContain("MOQ too high");

    // 5. Red-flag supplier (revoked license in registry + personal account) -> filtered_out by audit.ts
    const r5 = await submitOutreachResponse(db, tokenOf(sRedFlag.id), {
      unitPrice: 3.7,
      currency: "USD",
      moq: 500,
      leadTimeDays: 12,
      incoterm: "FOB",
      beneficiaryName: "陈丽",
    });
    expect(r5.recipient.status).toBe("filtered_out");
    expect(r5.recipient.filterReason).toContain("Critical red flag");

    // 6. Verify /compare integration: ONLY the 2 shortlisted suppliers appear in comparisons()
    const groups = comparisons(db, DEMO_WORKSPACE);
    const chargerGroup = groups.find((g) => g.subject.toLowerCase().includes("charger"))!;
    expect(chargerGroup).toBeDefined();
    expect(chargerGroup.rows).toHaveLength(2);
    expect(chargerGroup.rows.map((r) => r.entity_id).sort()).toEqual([sGood1.id, sGood2.id].sort());

    const row1 = chargerGroup.rows.find((r) => r.entity_id === sGood1.id)!;
    expect(row1.terms.unit_price?.value).toBe("USD 3.85");
    expect(row1.terms.moq?.value).toBe("500");
    expect(row1.terms.lead_time_days?.value).toBe("14 days");
    expect(row1.terms.incoterm?.value).toBe("FOB");
  });

  it("simulateOutreachCampaign realistically simulates no_reply, filtered_out, and 2-3 shortlisted quotes into /compare", async () => {
    const suppliers = ensureOutreachSuppliers(db, DEMO_WORKSPACE);
    const matter = listMatters(db, DEMO_WORKSPACE)[0];

    const campaign = await createOutreachCampaign(db, {
      workspaceId: DEMO_WORKSPACE,
      matterId: matter.id,
      targetPrice: 4.2,
      currency: "USD",
      targetQuantity: 1000,
      preferredIncoterm: "FOB",
      maxLeadTimeDays: 20,
      contactIds: suppliers.slice(0, 8).map((s) => s.id),
    });

    const simulated = await simulateOutreachCampaign(db, campaign.id);
    const shortlisted = simulated.recipients.filter((r) => r.status === "shortlisted");
    const filteredOut = simulated.recipients.filter((r) => r.status === "filtered_out");
    const noReply = simulated.recipients.filter((r) => r.status === "no_reply");

    expect(shortlisted).toHaveLength(3);
    expect(filteredOut).toHaveLength(3);
    expect(noReply).toHaveLength(2);

    // Filtered out recipients must all have clear filterReasons
    expect(filteredOut.every((r) => !!r.filterReason)).toBe(true);
    expect(filteredOut.some((r) => r.filterReason!.includes("over budget"))).toBe(true);
    expect(filteredOut.some((r) => r.filterReason!.includes("MOQ too high"))).toBe(true);
    expect(filteredOut.some((r) => r.filterReason!.includes("Critical red flag"))).toBe(true);

    // /compare should have ONLY the 3 shortlisted quotes for this product
    const groups = comparisons(db, DEMO_WORKSPACE);
    const chargerGroup = groups.find((g) => g.subject.toLowerCase().includes("charger"))!;
    expect(chargerGroup.rows).toHaveLength(3);
    expect(chargerGroup.rows.map((r) => r.entity_id).sort()).toEqual(
      shortlisted.map((r) => r.contactId).sort(),
    );
  });
});
