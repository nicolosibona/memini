"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { OutreachCampaign, OutreachRecipient, OutreachStatus } from "@/lib/core/outreach";
import { Card, Pill, Dot, btnCls } from "./ui";
import { Icon } from "./Icon";

export type MatterOption = {
  id: string;
  title: string;
  subject: string;
};

export type SupplierOption = {
  id: string;
  label: string;
  displayName: string;
  legalNameZh: string | null;
  creditCode: string | null;
  contactPerson: string | null;
};

const STATUS_META: Record<
  OutreachStatus,
  { label: string; tone: "neutral" | "info" | "warn" | "bad" | "ok" | "wechat"; dot: "neutral" | "warn" | "bad" | "ok" | "wechat" }
> = {
  pending: { label: "Pending", tone: "neutral", dot: "neutral" },
  sent: { label: "Sent", tone: "info", dot: "wechat" },
  no_reply: { label: "No Reply", tone: "neutral", dot: "neutral" },
  filtered_out: { label: "Filtered Out", tone: "bad", dot: "bad" },
  shortlisted: { label: "Shortlisted", tone: "ok", dot: "ok" },
};

export function OutreachDashboard({
  initialCampaigns,
  matters,
  suppliers,
  defaultDeadline,
}: {
  initialCampaigns: OutreachCampaign[];
  matters: MatterOption[];
  suppliers: SupplierOption[];
  defaultDeadline: string;
}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>(initialCampaigns);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(initialCampaigns[0]?.id ?? null);
  const [showSetup, setShowSetup] = useState<boolean>(initialCampaigns.length === 0);

  // Step 1 form state
  const [matterId, setMatterId] = useState<string>(matters[0]?.id ?? "__new__");
  const [newProductTitle, setNewProductTitle] = useState<string>("");
  const [targetPrice, setTargetPrice] = useState<string>("4.00");
  const [currency, setCurrency] = useState<string>("USD");
  const [targetQuantity, setTargetQuantity] = useState<string>("1000");
  const [preferredIncoterm, setPreferredIncoterm] = useState<string>("FOB");
  const [maxLeadTimeDays, setMaxLeadTimeDays] = useState<string>("20");
  const [deadline, setDeadline] = useState<string>(defaultDeadline);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => suppliers.slice(0, 8).map((s) => s.id));

  // UI state
  const [creating, setCreating] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedToken, setExpandedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | OutreachStatus>("all");

  useEffect(() => {
    setCampaigns(initialCampaigns);
    if (!activeCampaignId && initialCampaigns[0]) {
      setActiveCampaignId(initialCampaigns[0].id);
    }
  }, [initialCampaigns, activeCampaignId]);

  // Listen to memini:pulse so when a supplier submits /rfq/[token] in another tab, this dashboard updates live
  useEffect(() => {
    const onPulse = async () => {
      try {
        const r = await fetch("/api/outreach", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { campaigns: OutreachCampaign[] };
          setCampaigns(j.campaigns);
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("memini:pulse", onPulse);
    return () => window.removeEventListener("memini:pulse", onPulse);
  }, []);

  const activeCampaign = campaigns.find((c) => c.id === activeCampaignId) ?? campaigns[0] ?? null;

  const toggleSupplier = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (selectedIds.length === 0) {
      setError("Please select at least 1 supplier (5–10 recommended).");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matterId: matterId === "__new__" ? undefined : matterId,
          newProductTitle: matterId === "__new__" ? newProductTitle : undefined,
          targetPrice: Number(targetPrice),
          currency,
          targetQuantity: Number(targetQuantity),
          preferredIncoterm,
          maxLeadTimeDays: Number(maxLeadTimeDays),
          deadline: deadline || null,
          contactIds: selectedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create outreach campaign");
      const created = data.campaign as OutreachCampaign;
      setCampaigns((prev) => [created, ...prev]);
      setActiveCampaignId(created.id);
      setShowSetup(false);
      setStatusFilter("all");
      setExpandedToken(created.recipients[0]?.token ?? null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleSimulate = async () => {
    if (!activeCampaign) return;
    setError(null);
    setSimulating(true);
    try {
      const res = await fetch(`/api/outreach/${activeCampaign.id}/simulate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Simulation failed");
      const updated = data.campaign as OutreachCampaign;
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setStatusFilter("all");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSimulating(false);
    }
  };

  const handleResetDemo = async () => {
    setError(null);
    setResetting(true);
    try {
      await fetch("/api/demo/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      window.location.href = "/outreach";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

  const copyText = (token: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken((t) => (t === token ? null : t)), 2000);
  };

  const counts = activeCampaign
    ? {
        total: activeCampaign.recipients.length,
        sent: activeCampaign.recipients.filter((r) => r.status === "sent").length,
        no_reply: activeCampaign.recipients.filter((r) => r.status === "no_reply").length,
        filtered_out: activeCampaign.recipients.filter((r) => r.status === "filtered_out").length,
        shortlisted: activeCampaign.recipients.filter((r) => r.status === "shortlisted").length,
      }
    : { total: 0, sent: 0, no_reply: 0, filtered_out: 0, shortlisted: 0 };

  const visibleRecipients = activeCampaign
    ? activeCampaign.recipients.filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
    : [];

  return (
    <div className="space-y-8">
      {/* Mode / Campaign Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSetup(true)}
            className={btnCls(showSetup ? "primary" : "secondary", "sm")}
          >
            <Icon name="plus" className="size-3.5" />
            Step 1: Setup New RFQ Outreach
          </button>
          {campaigns.map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setActiveCampaignId(c.id);
                setShowSetup(false);
              }}
              className={btnCls(!showSetup && activeCampaign?.id === c.id ? "primary" : "secondary", "sm")}
            >
              <Icon name="send" className="size-3.5" />
              {c.productTitle} ({c.recipients.length} suppliers)
              {idx === 0 && <Pill tone="brand" className="ml-1">Latest</Pill>}
            </button>
          ))}
        </div>
        {campaigns.length > 0 && (
          <button
            type="button"
            onClick={handleResetDemo}
            disabled={resetting}
            className={btnCls("secondary", "sm")}
          >
            <Icon name="refresh" className="size-3.5" />
            {resetting ? "Resetting…" : "Reset Demo"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-bad bg-bad-soft px-5 py-3.5 text-[14px] text-bad flex items-center gap-2.5">
          <Icon name="alert" className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── STEP 1: SETUP CAMPAIGN ── */}
      {showSetup && (
        <Card className="p-6 sm:p-8 enter">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
            <div>
              <div className="text-[12.5px] font-semibold uppercase tracking-wider text-brand mb-1">Step 1 · Outreach Setup</div>
              <h2 className="display text-[28px] leading-tight text-ink">Configure Target Terms & Select Factories</h2>
              <p className="text-[14px] text-muted mt-1">
                Memini generates a natural business-Chinese RFQ with a unique mobile response link for each supplier, then auto-filters quotes as they arrive.
              </p>
            </div>
            {campaigns.length > 0 && (
              <button type="button" onClick={() => setShowSetup(false)} className={btnCls("secondary", "sm")}>
                Back to Live Funnel →
              </button>
            )}
          </div>

          <form onSubmit={handleCreateCampaign} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Product / Matter selection */}
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Product (Matter)</label>
                <select
                  value={matterId}
                  onChange={(e) => setMatterId(e.target.value)}
                  className="w-full h-10 rounded-xl border border-line bg-paper px-3 text-[14px] text-ink"
                >
                  {matters.map((m) => (
                    <option key={m.id} value={m.id}>
                      📦 {m.subject || m.title}
                    </option>
                  ))}
                  <option value="__new__">➕ New product purchase…</option>
                </select>
                {matterId === "__new__" && (
                  <input
                    type="text"
                    required
                    placeholder="e.g. 65W GaN USB-C Charger"
                    value={newProductTitle}
                    onChange={(e) => setNewProductTitle(e.target.value)}
                    className="mt-2 w-full h-10 rounded-xl border border-line bg-paper px-3 text-[14px] text-ink"
                  />
                )}
              </div>

              {/* Target Quantity */}
              <div>
                <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Target Quantity (pcs)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={targetQuantity}
                  onChange={(e) => setTargetQuantity(e.target.value)}
                  className="w-full h-10 rounded-xl border border-line bg-paper px-3 text-[14px] tabular text-ink"
                />
                <div className="text-[11.5px] text-muted mt-1">
                  Auto-filters MOQ &gt; {Math.floor(Number(targetQuantity || 0) * 1.5).toLocaleString("en-US")} pcs (1.5×)
                </div>
              </div>

              {/* Target Unit Price + Currency */}
              <div>
                <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Target Unit Price</label>
                <div className="flex gap-2">
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="h-10 rounded-xl border border-line bg-paper px-2.5 text-[14px] text-ink"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="CNY">RMB (¥)</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    className="flex-1 min-w-0 h-10 rounded-xl border border-line bg-paper px-3 text-[14px] tabular text-ink"
                  />
                </div>
                <div className="text-[11.5px] text-muted mt-1">
                  Auto-filters price &gt; {currency} {(Number(targetPrice || 0) * 1.25).toFixed(2)} (+25%)
                </div>
              </div>

              {/* Preferred Incoterm */}
              <div>
                <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Preferred Incoterm</label>
                <select
                  value={preferredIncoterm}
                  onChange={(e) => setPreferredIncoterm(e.target.value)}
                  className="w-full h-10 rounded-xl border border-line bg-paper px-3 text-[14px] text-ink"
                >
                  <option value="FOB">FOB (Free on Board)</option>
                  <option value="EXW">EXW (Ex Works)</option>
                  <option value="CIF">CIF (Cost, Insurance & Freight)</option>
                  <option value="DDP">DDP (Delivered Duty Paid)</option>
                </select>
              </div>

              {/* Max Lead Time */}
              <div>
                <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Max Lead Time (days)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={maxLeadTimeDays}
                  onChange={(e) => setMaxLeadTimeDays(e.target.value)}
                  className="w-full h-10 rounded-xl border border-line bg-paper px-3 text-[14px] tabular text-ink"
                />
              </div>

              {/* Quote Deadline */}
              <div>
                <label className="block text-[13px] font-medium text-ink-2 mb-1.5">Quote Deadline</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full h-10 rounded-xl border border-line bg-paper px-3 text-[14px] tabular text-ink"
                />
              </div>
            </div>

            {/* Supplier Selection Checkboxes (5–10 suppliers) */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <label className="text-[13.5px] font-semibold text-ink">
                  Select Suppliers from Contacts ({selectedIds.length} selected · 5–10 recommended)
                </label>
                <div className="flex gap-2 text-[12.5px]">
                  <button
                    type="button"
                    onClick={() => setSelectedIds(suppliers.slice(0, 8).map((s) => s.id))}
                    className="text-brand hover:underline font-medium"
                  >
                    Select 8 recommended
                  </button>
                  <span className="text-faint">·</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds(suppliers.map((s) => s.id))}
                    className="text-muted hover:text-ink"
                  >
                    Select all ({suppliers.length})
                  </button>
                  <span className="text-faint">·</span>
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="text-muted hover:text-ink"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {suppliers.map((s) => {
                  const checked = selectedIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                        checked ? "border-ink bg-paper shadow-[0_0_0_1px_var(--color-ink)]" : "border-line bg-card hover:bg-hover"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSupplier(s.id)}
                        className="mt-1 size-4 accent-brand rounded"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium text-ink truncate">{s.label}</span>
                        <span className="block text-[12px] text-muted truncate">
                          {s.legalNameZh ?? s.displayName}
                        </span>
                        {s.contactPerson && (
                          <span className="inline-block text-[11.5px] text-wechat-dark mt-0.5">
                            WeChat: {s.contactPerson}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-line">
              <div className="text-[13px] text-muted">
                Generates {selectedIds.length} natural Simplified Chinese RFQ messages with unique <code className="text-ink">/rfq/[token]</code> links.
              </div>
              <button type="submit" disabled={creating || selectedIds.length === 0} className={btnCls("wechat")}>
                <Icon name="wechat" className="size-4" />
                {creating ? "Generating Chinese Inquiries…" : `Send Chinese RFQ to ${selectedIds.length} Suppliers`}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* ── STEP 2: LIVE FUNNEL DASHBOARD ── */}
      {activeCampaign && (
        <div className="space-y-6 enter">
          {/* Header Banner & Demo CTA Actions */}
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-wechat-dark mb-1">
                  <Dot tone="wechat" live />
                  <span>Step 2 · Live WeChat RFQ Funnel</span>
                </div>
                <h2 className="display text-[30px] leading-tight text-ink">{activeCampaign.productTitle}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-[13.5px] text-muted">
                  <span>
                    Target: <strong className="text-ink tabular">{activeCampaign.currency} {activeCampaign.targetPrice.toFixed(2)}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Qty: <strong className="text-ink tabular">{activeCampaign.targetQuantity.toLocaleString("en-US")} pcs</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Incoterm: <strong className="text-ink">{activeCampaign.preferredIncoterm}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Lead Time: <strong className="text-ink tabular">≤ {activeCampaign.maxLeadTimeDays} days</strong>
                  </span>
                  {activeCampaign.deadline && (
                    <>
                      <span>·</span>
                      <span>Deadline: <strong className="text-ink">{activeCampaign.deadline}</strong></span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleSimulate}
                  disabled={simulating}
                  className={btnCls("wechat")}
                >
                  <Icon name="sparkle" className="size-4" />
                  {simulating ? "Simulating & Auditing…" : "Simulate Supplier Replies (Demo)"}
                </button>
                <Link href="/compare" className={btnCls("primary")}>
                  <Icon name="scale" className="size-4" />
                  View Shortlisted in /compare →
                  {counts.shortlisted > 0 && (
                    <span className="ml-1 rounded-full bg-ok px-2 py-0.5 text-[12px] font-semibold text-white tabular">
                      {counts.shortlisted}
                    </span>
                  )}
                </Link>
              </div>
            </div>

            {/* Deterministic Auto-Filter Rules Bar */}
            <div className="mt-5 pt-4 border-t border-line flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
              <span className="font-semibold text-ink-2">Deterministic Auto-Filter Rules:</span>
              <Pill tone="neutral">
                Max Unit Price ≤ {activeCampaign.currency} {(activeCampaign.targetPrice * 1.25).toFixed(2)} (+25%)
              </Pill>
              <Pill tone="neutral">
                Max MOQ ≤ {Math.floor(activeCampaign.targetQuantity * 1.5).toLocaleString("en-US")} pcs (1.5×)
              </Pill>
              <Pill tone="neutral">
                Audit Engine: 0 Critical Red Flags (Registry & Payee Check)
              </Pill>
            </div>
          </Card>

          {/* 4-Stage Visual Funnel Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === "sent" ? "all" : "sent")}
              className="text-left"
            >
              <Card className={`p-5 transition-all ${statusFilter === "sent" ? "ring-2 ring-ink" : "hover:bg-hover"}`}>
                <div className="flex items-center justify-between text-[13px] text-muted">
                  <span>1. Dispatched / Awaiting</span>
                  <Dot tone="wechat" />
                </div>
                <div className="display text-[36px] leading-none tabular mt-2 text-ink">
                  {counts.sent} <span className="text-[16px] text-muted font-sans">/ {counts.total}</span>
                </div>
                <div className="text-[12px] text-muted mt-2">Chinese RFQ + WeChat link sent</div>
              </Card>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === "no_reply" ? "all" : "no_reply")}
              className="text-left"
            >
              <Card className={`p-5 transition-all ${statusFilter === "no_reply" ? "ring-2 ring-ink" : "hover:bg-hover"}`}>
                <div className="flex items-center justify-between text-[13px] text-muted">
                  <span>2. No Reply</span>
                  <Dot tone="neutral" />
                </div>
                <div className="display text-[36px] leading-none tabular mt-2 text-muted">{counts.no_reply}</div>
                <div className="text-[12px] text-muted mt-2">Ghosted or missed deadline</div>
              </Card>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === "filtered_out" ? "all" : "filtered_out")}
              className="text-left"
            >
              <Card className={`p-5 transition-all ${statusFilter === "filtered_out" ? "ring-2 ring-bad" : "hover:bg-hover"}`}>
                <div className="flex items-center justify-between text-[13px] text-bad font-medium">
                  <span>3. Filtered Out</span>
                  <Dot tone="bad" />
                </div>
                <div className="display text-[36px] leading-none tabular mt-2 text-bad">{counts.filtered_out}</div>
                <div className="text-[12px] text-muted mt-2">Over budget, high MOQ, or red flag</div>
              </Card>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === "shortlisted" ? "all" : "shortlisted")}
              className="text-left"
            >
              <Card className={`p-5 transition-all ${statusFilter === "shortlisted" ? "ring-2 ring-ok" : "hover:bg-hover"}`}>
                <div className="flex items-center justify-between text-[13px] text-ok font-medium">
                  <span>4. Shortlisted → /compare</span>
                  <Dot tone="ok" live={counts.shortlisted > 0} />
                </div>
                <div className="display text-[36px] leading-none tabular mt-2 text-ok">{counts.shortlisted}</div>
                <div className="text-[12px] text-muted mt-2">Verified & pushed to /compare</div>
              </Card>
            </button>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex flex-wrap gap-1 p-1 rounded-full border border-line bg-card text-[13px]">
              {(
                [
                  ["all", `All (${counts.total})`],
                  ["shortlisted", `Shortlisted (${counts.shortlisted})`],
                  ["filtered_out", `Filtered Out (${counts.filtered_out})`],
                  ["no_reply", `No Reply (${counts.no_reply})`],
                  ["sent", `Awaiting (${counts.sent})`],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setStatusFilter(k)}
                  className={`press rounded-full px-3.5 h-8 inline-flex items-center gap-1.5 ${
                    statusFilter === k ? "bg-ink text-white" : "text-muted hover:text-ink hover:bg-hover"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-[12.5px] text-muted">
              Click any supplier&apos;s <strong className="text-ink">Chinese RFQ &amp; QR</strong> button to preview the WeChat inquiry or open the supplier mobile form.
            </div>
          </div>

          {/* Recipient Rows */}
          <Card className="divide-y divide-line">
            {visibleRecipients.map((r) => (
              <RecipientItem
                key={r.token}
                recipient={r}
                expanded={expandedToken === r.token}
                onToggleExpand={() => setExpandedToken(expandedToken === r.token ? null : r.token)}
                copied={copiedToken === r.token}
                onCopy={(text) => copyText(r.token, text)}
              />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function RecipientItem({
  recipient: r,
  expanded,
  onToggleExpand,
  copied,
  onCopy,
}: {
  recipient: OutreachRecipient;
  expanded: boolean;
  onToggleExpand: () => void;
  copied: boolean;
  onCopy: (text: string) => void;
}) {
  const meta = STATUS_META[r.status] ?? STATUS_META.sent;
  const rfqPath = `/rfq/${r.token}`;
  const rfqFullUrl = typeof window !== "undefined" ? `${window.location.origin}${rfqPath}` : rfqPath;
  const q = r.submittedQuote;

  return (
    <div className="p-5 transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[15px] font-semibold text-ink">{r.contactLabel}</span>
            {r.legalNameZh && <span className="text-[13px] text-muted">{r.legalNameZh}</span>}
            <Pill tone={meta.tone}>
              <Dot tone={meta.dot} />
              {meta.label}
            </Pill>
          </div>

          {/* Filter Reason if Filtered Out or No Reply */}
          {r.status === "filtered_out" && r.filterReason && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-xl bg-bad-soft px-3 py-1.5 text-[13px] text-bad font-medium">
              <Icon name="alert" className="size-4 shrink-0" />
              <span>Auto-filtered: {r.filterReason}</span>
            </div>
          )}
          {r.status === "no_reply" && (
            <div className="mt-1.5 text-[13px] text-muted">
              {r.filterReason ?? "No quote submitted before deadline — excluded from comparison."}
            </div>
          )}

          {/* Submitted Quote Details if Responded */}
          {q && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
              <span>
                Unit Price: <strong className="tabular text-ink">{q.currency} {q.unitPrice.toFixed(2)}</strong>
              </span>
              <span>
                MOQ: <strong className="tabular text-ink">{q.moq.toLocaleString("en-US")} pcs</strong>
              </span>
              <span>
                Lead Time: <strong className="tabular text-ink">{q.leadTimeDays} days</strong>
              </span>
              <span>
                Incoterm: <strong className="text-ink">{q.incoterm}{q.port ? ` ${q.port}` : ""}</strong>
              </span>
              {q.notes && <span className="text-muted italic">&ldquo;{q.notes}&rdquo;</span>}
            </div>
          )}
        </div>

        {/* Actions on Right */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {r.status === "shortlisted" && r.supplierMatterId && (
            <Link href={`/matters/${r.supplierMatterId}`} className={btnCls("secondary", "sm")}>
              <Icon name="check" className="size-3.5 text-ok" />
              Matter File
            </Link>
          )}
          <Link href={rfqPath} target="_blank" className={btnCls("secondary", "sm")}>
            <Icon name="phone" className="size-3.5" />
            Supplier Form (中文)
          </Link>
          <button type="button" onClick={onToggleExpand} className={btnCls("secondary", "sm")}>
            <Icon name="qr" className="size-3.5" />
            {expanded ? "Hide Inquiry & QR" : "Chinese RFQ & QR"}
          </button>
        </div>
      </div>

      {/* Expanded Preview: Generated Business-Chinese Message + Mobile Web Funnel Link & QR */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-line grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4 rise">
          <div className="rounded-xl bg-paper border border-line p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[12.5px] font-medium text-muted flex items-center gap-1.5">
                <Icon name="wechat" className="size-3.5 text-wechat" />
                Generated Standardized Business-Chinese Inquiry (微信客服 / WeChat Outreach)
              </span>
              <button
                type="button"
                onClick={() => onCopy(r.chineseMessage)}
                className="text-[12.5px] font-medium text-brand hover:underline"
              >
                {copied ? "✓ Copied" : "Copy Chinese Message"}
              </button>
            </div>
            <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-ink bg-card rounded-lg p-3.5 border border-line">
              {r.chineseMessage}
            </pre>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
              <span className="text-muted truncate">
                Unique Inbound Link: <code className="text-ink font-mono">{rfqFullUrl}</code>
              </span>
              <Link href={rfqPath} target="_blank" className="text-brand font-medium hover:underline">
                Open supplier form in browser →
              </Link>
            </div>
          </div>

          <div className="rounded-xl bg-card border border-line p-4 flex flex-col items-center justify-center text-center">
            <div className="rounded-xl bg-white p-2.5 border border-line">
              <QRCodeSVG value={rfqFullUrl} size={136} level="M" marginSize={0} fgColor="#1a1917" />
            </div>
            <div className="text-[12px] font-medium text-ink mt-2">微信扫码报价</div>
            <div className="text-[11px] text-muted">Scan in WeChat to open mobile quote form</div>
          </div>
        </div>
      )}
    </div>
  );
}
