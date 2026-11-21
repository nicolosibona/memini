import { notFound } from "next/navigation";
import { appDb, CURRENT_WS } from "@/lib/server";
import { loadCheck, checkTitle } from "@/lib/core/spec/store";
import { STATUS_LABEL, type Status } from "@/lib/core/spec/compare";
import { supplierMessageZh } from "@/lib/core/spec/flow";
import { sheetFileName } from "@/lib/core/spec/sheet";
import { BackLink, Card, CardHead, Figure, Page, PageHeader, Pill, ago, btnCls } from "@/components/ui";
import { ChineseCard } from "@/components/ReplyBubble";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spec check" };

const TONE: Record<Status, "ok" | "bad" | "warn" | "neutral"> = { ok: "ok", mismatch: "bad", missing: "warn", check: "warn", info: "neutral" };

export default async function SpecCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  const v = loadCheck(db, id);
  if (!v || v.check.workspace_id !== CURRENT_WS) notFound();
  const c = v.counts;
  const reqN = v.items.filter((i) => i.side === "requirement").length;
  const compared = reqN > 0 && reqN < v.items.length;
  const badLines = v.segments.filter((s) => !s.check.ok);

  return (
    <Page>
      <BackLink href="/specs">Spec checks</BackLink>
      <PageHeader
        eyebrow={<>{v.check.status === "open" ? "Open check" : "Closed check"} · updated {ago(v.check.updated_at)}</>}
        title={checkTitle(v.check)}
        rest={v.check.supplier_name ? `· ${v.check.supplier_name}` : undefined}
        actions={
          <a href={`/api/specs/${v.check.id}/sheet`} className={btnCls("primary")} download={sheetFileName(v)}>
            <Icon name="file" className="size-4" />Download sheet (.xlsx)
          </a>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Figure label="Mismatches" value={c.mismatch} tone={c.mismatch ? "bad" : "neutral"} hint="Below or outside your spec" />
        <Figure label="To confirm / not stated" value={c.check + c.missing} tone={c.check + c.missing ? "warn" : "neutral"} hint="Typical-only, different wording, missing" />
        <Figure label="OK" value={c.ok} tone="ok" hint="Meets your spec" />
        <Figure label="Translated lines verified" value={`${v.translation.verified}/${v.translation.lines}`} tone={badLines.length ? "warn" : "ok"} hint="Numbers, units, limits, part numbers" />
      </div>

      <Card className="overflow-x-auto mb-6">
        <CardHead title="Verification · 核对表" count={`${v.rows.length} lines`} />
        <table className="w-full text-[13.5px] min-w-[860px]">
          <thead>
            <tr className="border-y border-line text-left text-[12px] text-muted">
              <th className="px-6 py-3 font-medium">Parameter · 参数</th>
              <th className="px-4 py-3 font-medium">Your spec</th>
              <th className="px-4 py-3 font-medium">Supplier</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-6 py-3 font-medium">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {v.rows.map((r, i) => (
              <tr key={i} className={r.status === "mismatch" ? "bg-bad-soft/40" : ""}>
                <td className="px-6 py-3 align-top"><div className="font-medium">{r.label_en}</div><div lang="zh-CN" className="text-[12.5px] text-muted">{r.label_zh}</div></td>
                <td className="px-4 py-3 align-top mono text-[13px]">{r.req?.value ?? <span className="text-faint">—</span>}</td>
                <td className="px-4 py-3 align-top">
                  <div className={`mono text-[13px] ${r.status === "mismatch" ? "text-bad font-semibold" : ""}`}>{r.sup?.value ?? <span className="text-faint">not stated</span>}</div>
                  {r.sup && <div className="text-[11.5px] text-faint mt-0.5">{r.sup.item_title}</div>}
                  {r.earlier.map((e, k) => <div key={k} className="text-[11.5px] text-warn mt-0.5">was <span className="mono line-through">{e.value}</span> · {e.item_title}</div>)}
                </td>
                <td className="px-4 py-3 align-top"><Pill tone={TONE[r.status]}>{STATUS_LABEL[r.status].icon} {STATUS_LABEL[r.status].en}</Pill></td>
                <td className="px-6 py-3 align-top text-[13px] text-ink-2 max-w-[340px]">{r.reason_en}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] items-start">
        <div className="space-y-6 min-w-0">
          <Card>
            <CardHead title="Translation · 翻译" count={badLines.length ? `${badLines.length} to check` : "all numbers kept"} />
            <ul className="divide-y divide-line">
              {v.segments.map((s, i) => (
                <li key={i} className="px-6 py-3 grid gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] text-[13.5px]">
                  <span lang={/[一-鿿]/.test(s.original) ? "zh-CN" : undefined} className="text-ink">{s.original}</span>
                  <span lang={/[一-鿿]/.test(s.translation) ? "zh-CN" : undefined} className="text-ink-2">{s.translation}</span>
                  <span className="text-[12px] whitespace-nowrap">
                    {s.check.ok ? <span className="text-ok">✓ numbers kept</span> : <span className="text-bad">⚠️ {[...s.check.missing.map((m) => `missing ${m}`), ...s.check.flipped].join(", ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          {v.notes.length > 0 && (
            <Card>
              <CardHead title="Claims to handle with care" count={v.notes.length} />
              <ul className="divide-y divide-line">
                {v.notes.map((n, i) => (
                  <li key={i} className="px-6 py-3 text-[13.5px] flex gap-3">
                    <Pill tone={n.risk === "high" ? "bad" : "warn"}>{n.risk}</Pill>
                    <span><span lang="zh-CN" className="font-medium">「{n.quote}」</span> {n.text_en} <span className="text-faint">— {n.item_title}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card className="p-5">
            <div className="text-[13px] text-muted mb-3">Message for the supplier, to send with the sheet</div>
            <ChineseCard text={supplierMessageZh(v, compared)} />
          </Card>
          <Card>
            <CardHead title="What was forwarded" count={v.items.length} />
            <ul className="divide-y divide-line">
              {v.items.map((it) => (
                <li key={it.id} className="px-6 py-3 flex items-center gap-3 text-[13.5px]">
                  <span>{it.side === "requirement" ? "📐" : "🏭"}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{it.title}</span><span className="block text-[12px] text-muted">{it.side === "requirement" ? "Your spec" : "Supplier"} · {it.data.parameters.length} values · read by {it.source === "fallback" || it.source === "mock" ? "rules" : "AI"}</span></span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}
