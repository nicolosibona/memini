import Link from "next/link";
import { appDb, CURRENT_WS } from "@/lib/server";
import { listChecks, checkTitle } from "@/lib/core/spec/store";
import { Card, CardHead, Empty, Page, PageHeader, Pill, ago, btnCls } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { SPEC_DEMO_TEXTS } from "@/data/demo/spec";

export const dynamic = "force-dynamic";
export const metadata = { title: "Spec checks" };

const DEMO = [
  { file: "PS-1205_requirements_EN", label: "Your spec · PS-1205 (EN)" },
  { file: "PS-1205_规格书", label: "Supplier datasheet · 规格书 (中文)" },
];

export default async function SpecsPage() {
  const db = await appDb();
  const checks = listChecks(db, CURRENT_WS);
  return (
    <Page>
      <PageHeader
        eyebrow="Electronics"
        title="Spec checks."
        rest="Your spec against what the supplier sends."
        description="Forward your specification and the supplier's datasheets, test reports and WeChat messages to the bot. The AI reads and translates every technical line with a locked glossary; code then verifies every number, unit and limit and compares each parameter with your spec. You get a bilingual spreadsheet and a Chinese message for the supplier, who confirms it line by line."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <Card>
          <CardHead title="Checks" count={checks.length || ""} />
          {!checks.length ? (
            <Empty icon="scale">No checks yet. Forward your spec to the WeChat bot, or drop it in the chat below.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {checks.map((c) => (
                <li key={c.id}>
                  <Link href={`/specs/${c.id}`} className="flex items-center gap-4 px-6 py-4 hover:bg-hover last:rounded-b-3xl">
                    <span className="grid place-items-center size-10 rounded-2xl bg-line-2 shrink-0"><Icon name="scale" className="size-5 text-ink-2" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium truncate">{checkTitle(c)}</span>
                      <span className="block text-[13px] text-muted truncate">{c.supplier_name ?? "Supplier not named yet"} · {c.items} item{c.items === 1 ? "" : "s"} · {ago(c.updated_at)}</span>
                    </span>
                    {c.mismatches ? <Pill tone="bad">{c.mismatches} mismatch{c.mismatches > 1 ? "es" : ""}</Pill> : <Pill tone="ok">No mismatch</Pill>}
                    {c.status === "open" && <Pill tone="neutral">Open</Pill>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card tone="ivory">
          <CardHead title="Demo documents" />
          <p className="px-6 text-[13.5px] text-muted leading-relaxed">The demo chat: forward these to the bot (or merge-forward your chat with the supplier), then write <b className="text-ink">excel</b>.</p>
          {[SPEC_DEMO_TEXTS.mine, SPEC_DEMO_TEXTS.reply, SPEC_DEMO_TEXTS.swap].map((t) => (
            <p key={t} lang={/[一-鿿]/.test(t) ? "zh-CN" : undefined} className="mx-6 mt-3 rounded-2xl bg-card border border-line px-4 py-3 text-[14px] leading-relaxed select-all">{t}</p>
          ))}
          <p className="px-6 pt-4 text-[13px] text-muted">Optional documents:</p>
          <ul className="px-6 py-4 space-y-2">
            {DEMO.map((d) => (
              <li key={d.file} className="flex items-center justify-between gap-3">
                <span className="text-[14px] min-w-0 truncate">{d.label}</span>
                <span className="flex gap-1.5 shrink-0">
                  <a className={btnCls("secondary", "sm")} href={`/demo/spec/${encodeURIComponent(d.file)}.pdf`} target="_blank" rel="noreferrer">PDF</a>
                  <a className={btnCls("secondary", "sm")} href={`/demo/spec/${encodeURIComponent(d.file)}.png`} target="_blank" rel="noreferrer">Photo</a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
