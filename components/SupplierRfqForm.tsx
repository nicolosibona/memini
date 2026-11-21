"use client";
import { useState } from "react";
import type { SubmittedQuote } from "@/lib/core/outreach";

export function SupplierRfqForm({
  token,
  supplierNameZh,
  productTitle,
  targetQuantity,
  preferredIncoterm,
  maxLeadTimeDays,
  defaultCurrency,
  deadline,
  existingQuote,
}: {
  token: string;
  supplierNameZh: string;
  productTitle: string;
  targetQuantity: number;
  preferredIncoterm: string;
  maxLeadTimeDays: number;
  defaultCurrency: string;
  deadline?: string | null;
  existingQuote?: SubmittedQuote | null;
}) {
  const [unitPrice, setUnitPrice] = useState<string>(existingQuote ? String(existingQuote.unitPrice) : "");
  const [currency, setCurrency] = useState<string>(existingQuote?.currency ?? defaultCurrency ?? "USD");
  const [moq, setMoq] = useState<string>(existingQuote ? String(existingQuote.moq) : String(targetQuantity));
  const [leadTimeDays, setLeadTimeDays] = useState<string>(
    existingQuote ? String(existingQuote.leadTimeDays) : String(maxLeadTimeDays),
  );
  const [incoterm, setIncoterm] = useState<string>(existingQuote?.incoterm ?? preferredIncoterm ?? "FOB");
  const [port, setPort] = useState<string>(existingQuote?.port ?? "深圳");
  const [notes, setNotes] = useState<string>(existingQuote?.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedQuote | null>(existingQuote ?? null);
  const [editing, setEditing] = useState<boolean>(!existingQuote);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/outreach/respond/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unitPrice: Number(unitPrice),
          currency,
          moq: Number(moq),
          leadTimeDays: Number(leadTimeDays),
          incoterm,
          port: port.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败，请检查填写内容后重试");
      setSubmitted(data.recipient?.submittedQuote ?? {
        unitPrice: Number(unitPrice),
        currency,
        moq: Number(moq),
        leadTimeDays: Number(leadTimeDays),
        incoterm,
        port: port.trim() || null,
        notes: notes.trim() || null,
        submittedAt: new Date().toISOString(),
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f6f7] text-[#1a1917] pb-12">
      {/* Top WeChat Mobile Bar */}
      <div className="bg-[#07c160] text-white px-4 py-4 shadow-sm">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center size-8 rounded-lg bg-white text-[#07c160] font-bold text-[15px]">
              印
            </span>
            <div>
              <div className="text-[15px] font-semibold leading-tight">微信外贸询价直通车</div>
              <div className="text-[11.5px] opacity-90">免登录 · 30秒极速提交标准报价单</div>
            </div>
          </div>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11.5px] font-medium">
            官方核验通道
          </span>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-4 space-y-4">
        {/* Buyer Request Summary Card in Simplified Chinese */}
        <div className="rounded-2xl bg-white border border-[#e5e6eb] p-4 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#f0f1f5]">
            <div>
              <div className="text-[12px] text-[#6f6b64]">受邀报价供应商</div>
              <div className="text-[15px] font-semibold text-[#1a1917] mt-0.5">{supplierNameZh}</div>
            </div>
            <span className="rounded-lg bg-[#e5f7ed] text-[#05994c] px-2.5 py-1 text-[12px] font-medium">
              待贵司报价
            </span>
          </div>

          <div className="text-[12.5px] font-medium text-[#6f6b64] mb-2">采购方需求明细</div>
          <div className="rounded-xl bg-[#faf9f7] border border-[#ebe8e3] p-3.5 space-y-2 text-[13.5px]">
            <div className="flex justify-between gap-2">
              <span className="text-[#6f6b64]">采购产品：</span>
              <span className="font-semibold text-[#1a1917] text-right">{productTitle}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#6f6b64]">计划采购数量：</span>
              <span className="font-semibold text-[#1a1917] tabular">{targetQuantity.toLocaleString("zh-CN")} 个</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#6f6b64]">期望贸易条款：</span>
              <span className="font-medium text-[#1a1917]">{preferredIncoterm}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-[#6f6b64]">期望交货期：</span>
              <span className="font-medium text-[#1a1917] tabular">{maxLeadTimeDays} 天以内</span>
            </div>
            {deadline && (
              <div className="flex justify-between gap-2">
                <span className="text-[#6f6b64]">报价截止日期：</span>
                <span className="font-medium text-[#d23f2e] tabular">{deadline}</span>
              </div>
            )}
          </div>
        </div>

        {/* Submission Success View */}
        {submitted && !editing ? (
          <div className="rounded-2xl bg-white border border-[#e5e6eb] p-6 text-center space-y-4 shadow-xs">
            <div className="mx-auto size-12 rounded-full bg-[#e5f7ed] text-[#07c160] grid place-items-center text-[24px] font-bold">
              ✓
            </div>
            <div>
              <h2 className="text-[18px] font-bold text-[#1a1917]">报价单已成功提交！</h2>
              <p className="text-[13px] text-[#6f6b64] mt-1">
                系统已自动为您生成标准报价单并推送至采购方比价工作台，感谢您的配合。
              </p>
            </div>

            <div className="rounded-xl bg-[#faf9f7] border border-[#ebe8e3] p-3.5 text-left text-[13.5px] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[#6f6b64]">报价单价：</span>
                <span className="font-semibold tabular">
                  {submitted.currency === "CNY" ? "¥" : "$"}
                  {submitted.unitPrice.toFixed(2)} ({submitted.currency === "CNY" ? "人民币 RMB" : "美元 USD"})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6f6b64]">最低起订量 (MOQ)：</span>
                <span className="font-semibold tabular">{submitted.moq.toLocaleString("zh-CN")} 个</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6f6b64]">交货周期：</span>
                <span className="font-semibold tabular">{submitted.leadTimeDays} 天</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6f6b64]">贸易条款：</span>
                <span className="font-semibold">
                  {submitted.incoterm}
                  {submitted.port ? ` ${submitted.port}` : ""}
                </span>
              </div>
              {submitted.notes && (
                <div className="pt-1 border-t border-[#ebe8e3] text-[#45423d]">
                  <span className="text-[#6f6b64]">备注说明：</span>
                  {submitted.notes}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setEditing(true)}
              className="w-full h-11 rounded-xl border border-[#dcd8d1] bg-white text-[14px] font-medium text-[#1a1917] hover:bg-[#f4f2ee]"
            >
              重新修改报价
            </button>
          </div>
        ) : (
          /* 30-Second Simplified Chinese Supplier Form */
          <form onSubmit={handleSubmit} className="rounded-2xl bg-white border border-[#e5e6eb] p-4 space-y-4 shadow-xs">
            <div className="text-[15px] font-bold text-[#1a1917] pb-2 border-b border-[#f0f1f5]">
              填写贵司报价信息
            </div>

            {error && (
              <div className="rounded-xl bg-[#fcebe9] text-[#cc3229] px-3.5 py-2.5 text-[13px] font-medium">
                {error}
              </div>
            )}

            {/* Unit Price + Currency (RMB / USD) */}
            <div>
              <label className="block text-[13px] font-medium text-[#1a1917] mb-1.5">
                1. 产品单价 <span className="text-[#d23f2e]">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-11 rounded-xl border border-[#dcd8d1] bg-[#faf9f7] px-3 text-[14px] font-medium text-[#1a1917]"
                >
                  <option value="USD">美元 (USD $)</option>
                  <option value="CNY">人民币 (RMB ¥)</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="请输入含税/出厂单价，如 3.85"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className="flex-1 min-w-0 h-11 rounded-xl border border-[#dcd8d1] bg-white px-3.5 text-[15px] tabular text-[#1a1917]"
                />
              </div>
            </div>

            {/* MOQ */}
            <div>
              <label className="block text-[13px] font-medium text-[#1a1917] mb-1.5">
                2. 最低起订量 (MOQ / 个) <span className="text-[#d23f2e]">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                placeholder="例如：500"
                value={moq}
                onChange={(e) => setMoq(e.target.value)}
                className="w-full h-11 rounded-xl border border-[#dcd8d1] bg-white px-3.5 text-[15px] tabular text-[#1a1917]"
              />
            </div>

            {/* Lead Time */}
            <div>
              <label className="block text-[13px] font-medium text-[#1a1917] mb-1.5">
                3. 生产交货周期 (交期 / 天) <span className="text-[#d23f2e]">*</span>
              </label>
              <input
                type="number"
                min="1"
                required
                placeholder="收到定金后交货天数，如 15"
                value={leadTimeDays}
                onChange={(e) => setLeadTimeDays(e.target.value)}
                className="w-full h-11 rounded-xl border border-[#dcd8d1] bg-white px-3.5 text-[15px] tabular text-[#1a1917]"
              />
            </div>

            {/* Incoterm & Port */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[13px] font-medium text-[#1a1917] mb-1.5">
                  4. 贸易条款 <span className="text-[#d23f2e]">*</span>
                </label>
                <select
                  value={incoterm}
                  onChange={(e) => setIncoterm(e.target.value)}
                  className="w-full h-11 rounded-xl border border-[#dcd8d1] bg-[#faf9f7] px-3 text-[14px] font-medium text-[#1a1917]"
                >
                  <option value="FOB">FOB (离岸价)</option>
                  <option value="EXW">EXW (工厂交货)</option>
                  <option value="CIF">CIF (到岸价)</option>
                  <option value="DDP">DDP (完税交货)</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-[#1a1917] mb-1.5">
                  交货港 / 城市
                </label>
                <input
                  type="text"
                  placeholder="如：深圳 / 宁波"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full h-11 rounded-xl border border-[#dcd8d1] bg-white px-3 text-[14px] text-[#1a1917]"
                />
              </div>
            </div>

            {/* Optional Notes */}
            <div>
              <label className="block text-[13px] font-medium text-[#1a1917] mb-1.5">
                5. 补充说明 / 备注 (选填)
              </label>
              <textarea
                rows={3}
                placeholder="可填写：付款方式（如30%定金）、CE/FCC认证情况、打样周期、包装规格等…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-xl border border-[#dcd8d1] bg-white p-3 text-[14px] text-[#1a1917]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-xl bg-[#07c160] hover:bg-[#05994c] active:scale-[0.99] transition-all text-white font-semibold text-[15px] shadow-sm disabled:opacity-50"
            >
              {submitting ? "正在提交并生成报价单…" : "立即提交报价单"}
            </button>

            <div className="text-center text-[11.5px] text-[#6f6b64]">
              提交即代表贵司确认以上报价真实有效 · 微信客服自动建档
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
