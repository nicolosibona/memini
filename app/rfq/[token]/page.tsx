// Public Chinese Supplier Mobile Page (/rfq/[token]):
// Designed for WeChat's built-in browser — 100% Simplified Chinese, no login required.
import { notFound } from "next/navigation";
import { appDb } from "@/lib/server";
import { getOutreachByToken } from "@/lib/core/outreach";
import { SupplierRfqForm } from "@/components/SupplierRfqForm";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "外贸采购询价单 · 微信快速报价",
  robots: { index: false },
};

export default async function SupplierRfqPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await appDb();
  const found = getOutreachByToken(db, token);
  if (!found) notFound();

  const { campaign, recipient, supplier } = found;
  const supplierNameZh = supplier?.legal_name_zh ?? supplier?.display_name ?? recipient.contactName;

  return (
    <SupplierRfqForm
      token={token}
      supplierNameZh={supplierNameZh}
      productTitle={campaign.productTitle}
      targetQuantity={campaign.targetQuantity}
      preferredIncoterm={campaign.preferredIncoterm}
      maxLeadTimeDays={campaign.maxLeadTimeDays}
      defaultCurrency={campaign.currency}
      deadline={campaign.deadline}
      existingQuote={recipient.submittedQuote}
    />
  );
}
