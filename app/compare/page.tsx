import Link from "next/link";
import { appDb, CURRENT_WS } from "@/lib/server";
import { comparisons, COMPARE_KEYS } from "@/lib/core/memory";
import { factLabel } from "@/lib/core/facts";
import { Card, PageHeader, Section, TrustPill, Empty, Pill } from "@/components/ui";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare quotes" };

export default async function ComparePage() {
  const db = await appDb();
  const groups = comparisons(db, CURRENT_WS);
  const multi = groups.filter((g) => g.rows.length > 1);
  const single = groups.filter((g) => g.rows.length === 1);
  const num = (v?: string) => (v ? Number(v.replace(/[^\d.]/g, "")) : NaN);

  return (
    <div className="rise">
      <PageHeader title="Compare quotes" description="Only suppliers quoting the same product are compared. Set the product on a purchase to group it here." />
      {!multi.length && <Card><Empty icon="scale">No product has two quotes yet.</Empty></Card>}
      {multi.map((g) => {
        const best = (k: string) => { const v = g.rows.map((r) => num(r.terms[k]?.value)).filter((n) => !isNaN(n)); return v.length > 1 ? Math.min(...v) : NaN; };
        const bestPrice = best("unit_price"), bestLead = best("lead_time_days");
        const incos = new Set(g.rows.map((r) => r.terms.incoterm?.value).filter(Boolean));
        return (
          <Section key={g.key} title={g.subject} right={`${g.rows.length} quotes`}>
            <div id={encodeURIComponent(g.key)} />
            <Card className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="px-4 py-3 w-40" />
                    {g.rows.map((r) => (
                      <th key={r.matter_id} className="px-4 py-3 align-top font-normal min-w-44">
                        <Link href={`/matters/${r.matter_id}`} className="hover:underline">
                          <div className="text-xs text-muted">{r.label}</div>
                          <div className="font-medium text-sm">{r.name}</div>
                        </Link>
                        <div className="mt-1.5"><TrustPill trust={r.trust} /></div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {COMPARE_KEYS.map((k) => (
                    <tr key={k}>
                      <td className="px-4 py-2.5 text-muted">{factLabel(k)}</td>
                      {g.rows.map((r) => {
                        const t = r.terms[k];
                        const isBest = (k === "unit_price" && num(t?.value) === bestPrice) || (k === "lead_time_days" && num(t?.value) === bestLead);
                        return (
                          <td key={r.matter_id} className="px-4 py-2.5 align-top">
                            {t ? (
                              <>
                                <span className={`tabular font-medium ${t.conflicting ? "text-bad" : ""}`}>{t.value}</span>
                                {t.conflicting && <Icon name="alert" className="inline size-3.5 text-bad ml-1 -mt-0.5" />}
                                {isBest && <Pill tone="ok" className="ml-1.5">Best</Pill>}
                                <div className="text-[11px] text-muted">{t.source}</div>
                              </>
                            ) : <span className="text-faint">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td className="px-4 py-2.5 text-muted">Business license</td>
                    {g.rows.map((r) => <td key={r.matter_id} className="px-4 py-2.5">{r.has_license ? <span className="text-ok">Received</span> : <span className="text-warn">Missing</span>}</td>)}
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-muted">Open checks</td>
                    {g.rows.map((r) => <td key={r.matter_id} className="px-4 py-2.5 tabular">{r.open_red ? <span className="text-bad">{r.open_red} high</span> : null}{r.open_red && r.open_amber ? " · " : ""}{r.open_amber ? <span className="text-warn">{r.open_amber} to check</span> : null}{!r.open_red && !r.open_amber && <span className="text-faint">—</span>}</td>)}
                  </tr>
                </tbody>
              </table>
            </Card>
            {incos.size > 1 && <p className="text-xs text-warn mt-2 flex items-center gap-1"><Icon name="alert" className="size-3.5" />Different Incoterms ({[...incos].join(" vs ")}): an EXW price leaves export and inland freight to you, so it isn&apos;t comparable with FOB.</p>}
          </Section>
        );
      })}
      {single.length > 0 && (
        <Section title="Only one quote so far">
          <Card className="divide-y divide-line">
            {single.map((g) => (
              <Link key={g.key} href={`/matters/${g.rows[0].matter_id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-hover">
                <span className="flex-1">{g.subject}</span><span className="text-xs text-muted">{g.rows[0].label}</span>
              </Link>
            ))}
          </Card>
        </Section>
      )}
    </div>
  );
}
