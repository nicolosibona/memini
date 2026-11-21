import { appDb, CURRENT_WS } from "@/lib/server";
import { ensureOutreachSuppliers, listOutreachCampaigns } from "@/lib/core/outreach";
import { createMatter, listMatters } from "@/lib/core/matters";
import { entityLabel } from "@/lib/core/entities";
import { addDays, today } from "@/lib/db";
import { Page } from "@/components/ui";
import { HubHeader } from "@/components/shell/Hub";
import { hubCounts } from "@/components/shell/data";
import { OutreachDashboard, type MatterOption, type SupplierOption } from "@/components/OutreachDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outreach" };

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
      <HubHeader
        hub="work" tab="outreach" counts={hubCounts(db)}
        lead="Ask many factories at once."
        rest="Keep only the verified quotes."
        note="Memini sends a business-Chinese inquiry to each, reads their replies through the audit engine, and passes only the verified quotes to Quotes."
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
