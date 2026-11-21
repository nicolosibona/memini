import { appDb, CURRENT_WS } from "@/lib/server";
import { ensureOutreachSuppliers, listOutreachCampaigns } from "@/lib/core/outreach";
import { createMatter, listMatters } from "@/lib/core/matters";
import { entityLabel } from "@/lib/core/entities";
import { addDays, today } from "@/lib/db";
import { Page, PageHeader } from "@/components/ui";
import { OutreachDashboard, type MatterOption, type SupplierOption } from "@/components/OutreachDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "RFQ Outreach & Auto-Filter" };

export default async function OutreachPage() {
  const db = await appDb();
  const suppliers = ensureOutreachSuppliers(db, CURRENT_WS);
  const campaigns = listOutreachCampaigns(db, CURRENT_WS);

  // Gather unique product purchase matters so the buyer can pick an existing product or create a new one
  let allPurchases = listMatters(db, CURRENT_WS, { profile: "china_business" }).filter((m) => m.kind === "purchase");
  if (!allPurchases.length) {
    allPurchases = [createMatter(db, CURRENT_WS, { kind: "purchase", subject: "65W USB-C charger", title: "65W USB-C charger" })];
  }

  const seenSubjects = new Set<string>();
  const matterOptions: MatterOption[] = [];
  for (const m of allPurchases) {
    const key = (m.subject_norm ?? m.subject ?? m.title).toLowerCase();
    if (seenSubjects.has(key)) continue;
    seenSubjects.add(key);
    matterOptions.push({
      id: m.id,
      title: m.title,
      subject: m.subject ?? m.title,
    });
  }

  const supplierOptions: SupplierOption[] = suppliers.map((s) => {
    const ct = db
      .prepare(`SELECT name, wechat_nickname FROM contacts WHERE entity_id = ? LIMIT 1`)
      .get(s.id) as { name: string; wechat_nickname: string | null } | undefined;
    return {
      id: s.id,
      label: entityLabel(s),
      displayName: s.display_name,
      legalNameZh: s.legal_name_zh,
      creditCode: s.credit_code,
      contactPerson: ct?.wechat_nickname ?? ct?.name ?? null,
    };
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Automated First Contact · 微信客服 RFQ Funnel"
        title="RFQ Outreach & Auto-Filter"
        description="Send standardized business-Chinese inquiries to 5–10 factories at once, ingest their mobile responses through Memini's audit engine, and push only the 2–3 verified quotes into /compare."
      />
      <OutreachDashboard
        initialCampaigns={campaigns}
        matters={matterOptions}
        suppliers={supplierOptions}
        defaultDeadline={addDays(today(), 7)}
      />
    </Page>
  );
}
