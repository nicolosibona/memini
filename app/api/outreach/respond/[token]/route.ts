import { NextResponse } from "next/server";
import { appDb, CURRENT_WS, jsonBody } from "@/lib/server";
import { getOutreachByToken, submitOutreachResponse, type SupplierSubmission } from "@/lib/core/outreach";
import { pulse } from "@/lib/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await appDb();
  const found = getOutreachByToken(db, token);
  if (!found) return NextResponse.json({ error: "RFQ token not found" }, { status: 404 });
  return NextResponse.json({
    campaign: {
      id: found.campaign.id,
      productTitle: found.campaign.productTitle,
      targetQuantity: found.campaign.targetQuantity,
      preferredIncoterm: found.campaign.preferredIncoterm,
      maxLeadTimeDays: found.campaign.maxLeadTimeDays,
      deadline: found.campaign.deadline,
      currency: found.campaign.currency,
    },
    recipient: {
      contactId: found.recipient.contactId,
      contactName: found.recipient.contactName,
      legalNameZh: found.recipient.legalNameZh,
      status: found.recipient.status,
      submittedQuote: found.recipient.submittedQuote,
      respondedAt: found.recipient.respondedAt,
    },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await jsonBody<Partial<SupplierSubmission>>(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const db = await appDb();
  const found = getOutreachByToken(db, token);
  if (!found) return NextResponse.json({ error: "RFQ link not found or expired" }, { status: 404 });

  const unitPrice = Number(body.unitPrice);
  const moq = Number(body.moq);
  const leadTimeDays = Number(body.leadTimeDays);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return NextResponse.json({ error: "请填写有效的单价 (Valid unit price is required)" }, { status: 400 });
  }
  if (!Number.isFinite(moq) || moq <= 0) {
    return NextResponse.json({ error: "请填写有效的起订量 MOQ (Valid MOQ is required)" }, { status: 400 });
  }
  if (!Number.isFinite(leadTimeDays) || leadTimeDays <= 0) {
    return NextResponse.json({ error: "请填写有效的交期天数 (Valid lead time is required)" }, { status: 400 });
  }

  try {
    const result = await submitOutreachResponse(db, token, {
      unitPrice,
      currency: body.currency ?? found.campaign.currency,
      moq,
      leadTimeDays,
      incoterm: body.incoterm ?? found.campaign.preferredIncoterm,
      port: body.port ?? null,
      paymentTerms: body.paymentTerms ?? null,
      beneficiaryName: body.beneficiaryName ?? null,
      notes: body.notes ?? null,
    });
    return NextResponse.json({
      ok: true,
      status: result.recipient.status,
      filterReason: result.recipient.filterReason,
      quoteDocumentId: result.quoteDocumentId,
      supplierMatterId: result.supplierMatterId,
      recipient: result.recipient,
      campaign: result.campaign,
      pulse: pulse(db, CURRENT_WS),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
