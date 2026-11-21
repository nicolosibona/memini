"use client";
// The "Outreach" tab of the Work hub: set target terms, send a Chinese RFQ to many factories at once,
// watch replies land and get filtered, and push the verified few into Quotes. The hub renders the page title.
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { OutreachCampaign, OutreachRecipient, OutreachStatus } from "@/lib/core/outreach";
import { Card, Empty, Pill, Dot, FIELD, btnCls } from "./ui";
import { CopyButton } from "./CopyButton";
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
  no_reply: { label: "No reply", tone: "neutral", dot: "neutral" },
  filtered_out: { label: "Filtered out", tone: "bad", dot: "bad" },
  shortlisted: { label: "Shortlisted", tone: "ok", dot: "ok" },
};

const FUNNEL = [
  { key: "sent", label: "Awaiting reply", hint: "Chinese RFQ sent on WeChat", num: "text-ink", dot: "wechat" },
  { key: "no_reply", label: "No reply", hint: "Missed the deadline", num: "text-muted", dot: "neutral" },
  { key: "filtered_out", label: "Filtered out", hint: "Over budget, high MOQ or a red flag", num: "text-bad", dot: "bad" },
  { key: "shortlisted", label: "Shortlisted", hint: "Verified and sent to Quotes", num: "text-ok", dot: "ok" },
] as const;

const LABEL = "block text-[13px] text-ink-2 mb-1.5";
const HINT = "text-[12px] text-faint mt-1.5";

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

  // New-outreach form state
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
  const [statusFilter, setStatusFilter] = useState<"all" | OutreachStatus>("all");

  useEffect(() => {
    setCampaigns(initialCampaigns);
    if (!activeCampaignId && initialCampaigns[0]) {
      setActiveCampaignId(initialCampaigns[0].id);
    }
  }, [initialCampaigns, activeCampaignId]);

  // Listen to memini:pulse so when a supplier submits /rfq/[token] in another tab, this view updates live
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
    if (!confirm("Replace all data with the demo workspace? This cannot be undone.")) return;
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
    <div className="space-y-6">
      {/* Campaign switcher */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        {campaigns.length > 0 ? (
          <div className="inline-flex max-w-full flex-wrap gap-1 rounded-full border border-line bg-card/80 p-1 text-[13px]">
            {campaigns.map((c) => {
              const on = !showSetup && activeCampaign?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setActiveCampaignId(c.id);
                    setShowSetup(false);
                  }}
                  className={`press inline-flex h-8 max-w-full items-center gap-1.5 rounded-full px-3.5 ${on ? "bg-ink text-white" : "text-muted hover:bg-hover hover:text-ink"}`}
                >
                  <span className="truncate">{c.productTitle}</span>
                  <span className="tabular opacity-60">{c.recipients.length}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}
        <button type="button" aria-pressed={showSetup} onClick={() => setShowSetup((s) => !s)} className="bracket">
          {showSetup && campaigns.length > 0 ? "Back to campaign" : "New outreach"}
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-2xl bg-bad-soft px-5 py-3.5 text-[14px] text-bad">
          <Icon name="alert" className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── New outreach ── */}
      {showSetup && (
        <Card className="enter p-5 sm:p-8">
          <div className="mb-7 max-w-[62ch]">
            <div className="mb-2 text-[12.5px] font-medium text-faint">New outreach</div>
            <h2 className="text-[24px] font-medium leading-[1.15] tracking-[-0.03em] text-pretty">
              <span className="text-ink">Set your target terms</span> <span className="text-stone">and choose the factories to ask.</span>
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              Memini writes a natural business-Chinese RFQ with its own mobile reply link for each supplier, then filters the quotes as they arrive.
            </p>
          </div>

          <form onSubmit={handleCreateCampaign} className="space-y-7">
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-1">
                <label htmlFor="ro-product" className={LABEL}>Product</label>
                <select id="ro-product" value={matterId} onChange={(e) => setMatterId(e.target.value)} className={`${FIELD} w-full`}>
                  {matters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.subject || m.title}
                    </option>
                  ))}
                  <option value="__new__">New product…</option>
                </select>
                {matterId === "__new__" && (
                  <input
                    type="text"
                    required
                    aria-label="New product name"
                    placeholder="e.g. 65W GaN USB-C charger"
                    value={newProductTitle}
                    onChange={(e) => setNewProductTitle(e.target.value)}
                    className={`${FIELD} mt-2 w-full`}
                  />
                )}
              </div>

              <div>
                <label htmlFor="ro-qty" className={LABEL}>Target quantity (pcs)</label>
                <input id="ro-qty" type="number" min={1} required value={targetQuantity} onChange={(e) => setTargetQuantity(e.target.value)} className={`${FIELD} mono w-full`} />
                <div className={HINT}>Filters out MOQ above {Math.floor(Number(targetQuantity || 0) * 1.5).toLocaleString("en-US")} pcs (1.5×)</div>
              </div>

              <div>
                <label htmlFor="ro-price" className={LABEL}>Target unit price</label>
                <div className="flex gap-2">
                  <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={FIELD}>
                    <option value="USD">USD ($)</option>
                    <option value="CNY">RMB (¥)</option>
                  </select>
                  <input id="ro-price" type="number" step="0.01" min="0.01" required value={targetPrice} onChange={(e) => setTargetPrice(e.target.value)} className={`${FIELD} mono min-w-0 flex-1`} />
                </div>
                <div className={HINT}>Filters out prices above {currency} {(Number(targetPrice || 0) * 1.25).toFixed(2)} (+25%)</div>
              </div>

              <div>
                <label htmlFor="ro-inco" className={LABEL}>Preferred Incoterm</label>
                <select id="ro-inco" value={preferredIncoterm} onChange={(e) => setPreferredIncoterm(e.target.value)} className={`${FIELD} w-full`}>
                  <option value="FOB">FOB (Free on Board)</option>
                  <option value="EXW">EXW (Ex Works)</option>
                  <option value="CIF">CIF (Cost, Insurance &amp; Freight)</option>
                  <option value="DDP">DDP (Delivered Duty Paid)</option>
                </select>
              </div>

              <div>
                <label htmlFor="ro-lead" className={LABEL}>Max lead time (days)</label>
                <input id="ro-lead" type="number" min={1} required value={maxLeadTimeDays} onChange={(e) => setMaxLeadTimeDays(e.target.value)} className={`${FIELD} mono w-full`} />
              </div>

              <div>
                <label htmlFor="ro-deadline" className={LABEL}>Quote deadline</label>
                <input id="ro-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={`${FIELD} mono w-full`} />
              </div>
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                <span className="text-[14px] font-medium text-ink">
                  Suppliers <span className="font-normal text-faint tabular">· {selectedIds.length} selected, 5–10 works best</span>
                </span>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
                  <button type="button" onClick={() => setSelectedIds(suppliers.slice(0, 8).map((s) => s.id))} className="font-medium text-ink hover:underline">
                    Select 8
                  </button>
                  <button type="button" onClick={() => setSelectedIds(suppliers.map((s) => s.id))} className="text-muted hover:text-ink">
                    All {suppliers.length}
                  </button>
                  <button type="button" onClick={() => setSelectedIds([])} className="text-muted hover:text-ink">
                    Clear
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {suppliers.map((s) => {
                  const checked = selectedIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors ${
                        checked ? "border-ink bg-ivory ring-1 ring-ink" : "border-line bg-card hover:bg-hover"
                      }`}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleSupplier(s.id)} className="mt-1 size-4 shrink-0 accent-ink" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{s.label}</span>
                        <span className="block truncate text-[12px] text-muted">{s.legalNameZh ?? s.displayName}</span>
                        {s.contactPerson && <span className="mt-0.5 block truncate text-[11.5px] text-wechat-dark">WeChat: {s.contactPerson}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
              <div className="max-w-[46ch] text-[12.5px] leading-relaxed text-faint">
                Writes {selectedIds.length} Simplified Chinese RFQ message{selectedIds.length === 1 ? "" : "s"}, each with its own <span className="mono text-muted">/rfq/…</span> reply link.
              </div>
              <button type="submit" disabled={creating || selectedIds.length === 0} className={btnCls("wechat")}>
                <Icon name="wechat" className="size-4" />
                {creating ? "Writing the Chinese inquiries…" : `Send Chinese RFQ to ${selectedIds.length} supplier${selectedIds.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* ── The campaign ── */}
      {activeCampaign && !showSetup && (
        <div className="enter space-y-6">
          <Card className="p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-5">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-wechat-dark">
                  <Dot tone="wechat" live />
                  Live on WeChat
                </div>
                <h2 className="display text-[30px] leading-[1.1] text-ink sm:text-[36px]">{activeCampaign.productTitle}</h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Chip label="Target">{activeCampaign.currency} {activeCampaign.targetPrice.toFixed(2)}</Chip>
                  <Chip label="Qty">{activeCampaign.targetQuantity.toLocaleString("en-US")} pcs</Chip>
                  <Chip label="Incoterm">{activeCampaign.preferredIncoterm}</Chip>
                  <Chip label="Lead time">≤ {activeCampaign.maxLeadTimeDays} days</Chip>
                  {activeCampaign.deadline && <Chip label="Deadline">{activeCampaign.deadline}</Chip>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button type="button" onClick={handleSimulate} disabled={simulating} className={btnCls("secondary")}>
                  <Icon name="play" className="size-3.5" />
                  {simulating ? "Simulating replies…" : "Simulate replies"}
                </button>
                <Link href="/compare" className={btnCls("primary")}>
                  <Icon name="scale" className="size-4" />
                  Open shortlist in Quotes
                  {counts.shortlisted > 0 && <span className="tabular rounded-full bg-white/20 px-2 py-0.5 text-[12px] font-semibold leading-none text-white">{counts.shortlisted}</span>}
                </Link>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[12.5px] text-muted">
              <span className="mr-1 text-faint">Auto-filter</span>
              <Pill>Price ≤ {activeCampaign.currency} {(activeCampaign.targetPrice * 1.25).toFixed(2)} (+25%)</Pill>
              <Pill>MOQ ≤ {Math.floor(activeCampaign.targetQuantity * 1.5).toLocaleString("en-US")} pcs (1.5×)</Pill>
              <Pill>No red flags in the registry and payee check</Pill>
            </div>
          </Card>

          {/* Funnel */}
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            {FUNNEL.map((f) => {
              const active = statusFilter === f.key;
              const n = counts[f.key];
              return (
                <button key={f.key} type="button" aria-pressed={active} onClick={() => setStatusFilter(active ? "all" : f.key)} className="block h-full text-left">
                  <Card className={`lift h-full px-5 py-5 sm:px-6 ${active ? "border-ink/30 ring-1 ring-ink" : ""}`}>
                    <div className="flex items-center justify-between gap-2 text-[13px] text-muted">
                      <span>{f.label}</span>
                      <Dot tone={f.dot} live={f.key === "shortlisted" && n > 0} />
                    </div>
                    <div className={`display tabular mt-3 text-[44px] leading-none ${f.num}`}>
                      {n}
                      {f.key === "sent" && <span className="ml-1.5 font-sans text-[15px] text-faint">/ {counts.total}</span>}
                    </div>
                    <div className="mt-2.5 text-[12px] leading-snug text-faint">{f.hint}</div>
                  </Card>
                </button>
              );
            })}
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="inline-flex max-w-full flex-wrap gap-1 rounded-full border border-line bg-card/80 p-1 text-[13px]">
              {(
                [
                  ["all", "All", counts.total],
                  ["shortlisted", "Shortlisted", counts.shortlisted],
                  ["filtered_out", "Filtered out", counts.filtered_out],
                  ["no_reply", "No reply", counts.no_reply],
                  ["sent", "Awaiting", counts.sent],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={statusFilter === k}
                  onClick={() => setStatusFilter(k)}
                  className={`press inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 ${statusFilter === k ? "bg-ink text-white" : "text-muted hover:bg-hover hover:text-ink"}`}
                >
                  {label} <span className="tabular opacity-60">{n}</span>
                </button>
              ))}
            </div>
            <div className="text-[12.5px] text-faint">Open a supplier&apos;s Chinese RFQ &amp; QR to preview the WeChat message.</div>
          </div>

          {/* Recipients */}
          <Card className="divide-y divide-line overflow-hidden">
            {visibleRecipients.map((r) => (
              <RecipientItem key={r.token} recipient={r} expanded={expandedToken === r.token} onToggleExpand={() => setExpandedToken(expandedToken === r.token ? null : r.token)} />
            ))}
            {!visibleRecipients.length && <Empty icon="send">No suppliers in this view.</Empty>}
          </Card>
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="flex justify-end pt-2">
          <button type="button" onClick={handleResetDemo} disabled={resetting} className={btnCls("quiet", "sm")}>
            <Icon name="refresh" className="size-3.5" />
            {resetting ? "Resetting…" : "Reset demo data"}
          </button>
        </div>
      )}
    </div>
  );
}

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-baseline gap-1.5 whitespace-nowrap rounded-full border border-line bg-ivory px-3 text-[12.5px] leading-7">
      <span className="text-faint">{label}</span>
      <span className="mono font-medium text-ink">{children}</span>
    </span>
  );
}

function RecipientItem({ recipient: r, expanded, onToggleExpand }: { recipient: OutreachRecipient; expanded: boolean; onToggleExpand: () => void }) {
  const meta = STATUS_META[r.status] ?? STATUS_META.sent;
  const rfqPath = `/rfq/${r.token}`;
  const q = r.submittedQuote;

  return (
    <div className="px-5 py-5 transition-colors sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="text-[15px] font-medium text-ink">{r.contactLabel}</span>
            {r.legalNameZh && <span lang="zh-CN" className="text-[13px] text-muted">{r.legalNameZh}</span>}
            <Pill tone={meta.tone}>
              <Dot tone={meta.dot} />
              {meta.label}
            </Pill>
          </div>

          {r.status === "filtered_out" && r.filterReason && (
            <div className="mt-2.5 inline-flex max-w-full items-start gap-2 rounded-xl bg-bad-soft px-3 py-1.5 text-[13px] text-bad">
              <Icon name="alert" className="mt-0.5 size-3.5 shrink-0" />
              <span>Filtered automatically: {r.filterReason}</span>
            </div>
          )}
          {r.status === "no_reply" && <div className="mt-1.5 text-[13px] text-muted">{r.filterReason ?? "No quote before the deadline, so it is left out of the comparison."}</div>}

          {q && (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
              <QuoteFact label="Unit price">{q.currency} {q.unitPrice.toFixed(2)}</QuoteFact>
              <QuoteFact label="MOQ">{q.moq.toLocaleString("en-US")} pcs</QuoteFact>
              <QuoteFact label="Lead time">{q.leadTimeDays} days</QuoteFact>
              <QuoteFact label="Incoterm">{q.incoterm}{q.port ? ` ${q.port}` : ""}</QuoteFact>
              {q.notes && <div className="basis-full italic text-muted">&ldquo;{q.notes}&rdquo;</div>}
            </dl>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {r.status === "shortlisted" && r.supplierMatterId && (
            <Link href={`/matters/${r.supplierMatterId}`} className={btnCls("secondary", "sm")}>
              <Icon name="check" className="size-3.5 text-ok" />
              Matter file
            </Link>
          )}
          <Link href={rfqPath} target="_blank" rel="noreferrer" className={btnCls("secondary", "sm")}>
            <Icon name="phone" className="size-3.5" />
            Supplier form (中文)
          </Link>
          <button type="button" onClick={onToggleExpand} aria-expanded={expanded} className={btnCls("secondary", "sm")}>
            <Icon name="qr" className="size-3.5" />
            {expanded ? "Hide RFQ & QR" : "Chinese RFQ & QR"}
          </button>
        </div>
      </div>

      {expanded && <RfqPreview recipient={r} path={rfqPath} />}
    </div>
  );
}

function QuoteFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-faint">{label}</dt>
      <dd className="mono font-medium text-ink">{children}</dd>
    </div>
  );
}

function RfqPreview({ recipient: r, path }: { recipient: OutreachRecipient; path: string }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  return (
    <div className="rise mt-5 grid grid-cols-1 gap-4 border-t border-line pt-5 lg:grid-cols-[minmax(0,1fr)_232px]">
      <div className="rounded-2xl border border-wechat/30 bg-wechat-soft px-4 py-3.5 sm:px-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-wechat-dark">中文 · ready to send on WeChat</span>
          <CopyButton text={r.chineseMessage} label="Copy" className="press h-7 rounded-full bg-wechat-dark px-3 text-[12.5px] font-medium text-white hover:bg-[#046e36]" />
        </div>
        <div lang="zh-CN" className="whitespace-pre-wrap break-words text-[14.5px] leading-[1.75] text-ink">
          {r.chineseMessage}
        </div>
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-wechat/20 pt-3 text-[12px]">
          <span className="mono min-w-0 break-all text-muted">{url}</span>
          <Link href={path} target="_blank" rel="noreferrer" className="bracket">
            Open form
          </Link>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-ivory p-4 text-center">
        <div className="rounded-xl border border-line bg-white p-2.5">
          <QRCodeSVG value={url} size={136} level="M" marginSize={0} fgColor="#161513" />
        </div>
        <div lang="zh-CN" className="mt-2.5 text-[13px] font-medium text-ink">微信扫码报价</div>
        <div className="mt-0.5 text-[11.5px] text-faint">Scan in WeChat to open the quote form</div>
      </div>
    </div>
  );
}
