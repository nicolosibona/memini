import Link from "next/link";
import { appDb, CURRENT_WS } from "@/lib/server";
import { comparisons, COMPARE_KEYS } from "@/lib/core/memory";
import { factLabel } from "@/lib/core/facts";
import { Card, Page, TrustPill, Empty, Pill, BracketLink } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { HubHeader } from "@/components/shell/Hub";
import { hubCounts } from "@/components/shell/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quotes" };

export default async function ComparePage() {
  const db = await appDb();
  const groups = comparisons(db, CURRENT_WS);
  const multi = groups.filter((g) => g.rows.length > 1);
  const single = groups.filter((g) => g.rows.length === 1);
  const num = (v?: string) => (v ? Number(v.replace(/[^\d.]/g, "")) : NaN);

  return (
    <Page>
      <HubHeader
        hub="work" tab="quotes" counts={hubCounts(db)}
        lead="Quotes side by side."
        rest="Same product, same terms."
        note="Only suppliers quoting the same product are compared. Set the product on a purchase to group it here."
        actions={<BracketLink href="/outreach">Ask more suppliers</BracketLink>}
      />
      {!multi.length && <Card><Empty icon="scale">No product has two quotes yet. Start an outreach, or forward a second quote for the same product.</Empty></Card>}
      <div className="space-y-8">
        {multi.map((g) => {
          const best = (k: string) => { const v = g.rows.map((r) => num(r.terms[k]?.value)).filter((n) => !isNaN(n)); return v.length > 1 ? Math.min(...v) : NaN; };
          const bestPrice = best("unit_price"), bestLead = best("lead_time_days");
          const incos = new Set(g.rows.map((r) => r.terms.incoterm?.value).filter(Boolean));
          return (
            <section key={g.key} id={encodeURIComponent(g.key)} className="scroll-mt-28">
              <div className="flex items-baseline justify-between gap-3 mb-3 px-1">
                <h2 className="text-[20px] font-medium tracking-[-0.02em]">{g.subject}</h2>
                <span className="text-[13px] text-faint tabular">{g.rows.length} quotes</span>
              </div>
              <Card className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[560px]">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="px-6 py-4 w-40" />
                      {g.rows.map((r) => (
                        <th key={r.matter_id} className="px-6 py-4 align-top font-normal min-w-44">
                          <Link href={`/matters/${r.matter_id}`} className="hover:underline underline-offset-2">
                            <div className="text-[12.5px] text-muted">{r.label}</div>
                            <div className="font-medium text-[15px] text-ink">{r.name}</div>
                          </Link>
                          <div className="mt-2"><TrustPill trust={r.trust} /></div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {COMPARE_KEYS.map((k) => (
                      <tr key={k}>
                        <td className="px-6 py-3.5 text-muted">{factLabel(k)}</td>
                        {g.rows.map((r) => {
                          const t = r.terms[k];
                          const isBest = (k === "unit_price" && num(t?.value) === bestPrice) || (k === "lead_time_days" && num(t?.value) === bestLead);
                          return (
                            <td key={r.matter_id} className={`px-6 py-3.5 align-top ${isBest ? "bg-ok-soft/50" : ""}`}>
                              {t ? (
                                <>
                                  <span className={`mono font-medium text-[14px] ${t.conflicting ? "text-bad" : ""}`}>{t.value}</span>
                                  {t.conflicting && <Icon name="alert" className="inline size-3.5 text-bad ml-1 -mt-0.5" />}
                                  {isBest && <Pill tone="ok" className="ml-2">Best</Pill>}
                                  <div className="text-[11.5px] text-faint mt-0.5">{t.source}</div>
                                </>
                              ) : <span className="text-faint">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr>
                      <td className="px-6 py-3.5 text-muted">Business license</td>
                      {g.rows.map((r) => <td key={r.matter_id} className="px-6 py-3.5">{r.has_license ? <span className="text-ok">Received</span> : <span className="text-warn">Missing</span>}</td>)}
                    </tr>
                    <tr>
                      <td className="px-6 py-3.5 text-muted">Open checks</td>
                      {g.rows.map((r) => <td key={r.matter_id} className="px-6 py-3.5 tabular">{r.open_red ? <span className="text-bad">{r.open_red} high</span> : null}{r.open_red && r.open_amber ? " · " : ""}{r.open_amber ? <span className="text-warn">{r.open_amber} to check</span> : null}{!r.open_red && !r.open_amber && <span className="text-faint">—</span>}</td>)}
                    </tr>
                  </tbody>
                </table>
              </Card>
              {incos.size > 1 && <p className="text-[12.5px] text-warn mt-3 px-1 flex items-center gap-1.5"><Icon name="alert" className="size-3.5 shrink-0" />Different Incoterms ({[...incos].join(" vs ")}): an EXW price leaves export and inland freight to you, so it isn&apos;t comparable with FOB.</p>}
            </section>
          );
        })}
      </div>
      {single.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[15px] font-medium mb-3 px-1">Only one quote so far</h2>
          <Card className="divide-y divide-line">
            {single.map((g) => (
              <Link key={g.key} href={`/matters/${g.rows[0].matter_id}`} className="flex items-center gap-3 px-6 py-3.5 text-[14px] hover:bg-hover first:rounded-t-3xl last:rounded-b-3xl">
                <span className="flex-1">{g.subject}</span><span className="text-[12.5px] text-muted">{g.rows[0].label}</span>
              </Link>
            ))}
          </Card>
        </section>
      )}
    </Page>
  );
}
