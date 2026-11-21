import Link from "next/link";
import { appDb, CURRENT_WS } from "@/lib/server";
import { DOC_TYPES, type DocType } from "@/lib/core/domain";
import { Card, Page, Empty, fmtDate, Pill } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { HubHeader } from "@/components/shell/Hub";
import { hubCounts } from "@/components/shell/data";
import { addDays, today } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const db = await appDb();
  const docs = db.prepare(
    `SELECT d.id, d.doc_type, d.title, d.expires_at, d.created_at, d.file_path, e.display_name AS entity, m.title AS matter, d.matter_id
     FROM documents d LEFT JOIN entities e ON e.id = d.entity_id LEFT JOIN matters m ON m.id = d.matter_id
     WHERE d.workspace_id = ? ORDER BY d.created_at DESC`,
  ).all(CURRENT_WS) as { id: string; doc_type: DocType; title: string; expires_at: string | null; created_at: string; file_path: string | null; entity: string | null; matter: string | null; matter_id: string | null }[];
  const t0 = today();

  return (
    <Page>
      <HubHeader
        hub="memory" tab="documents" counts={hubCounts(db)}
        lead="Everything you've forwarded."
        rest="Read, filed, checked."
        note="Expiry dates become renewal reminders automatically."
      />
      <Card className="overflow-x-auto">
        {docs.length ? (
          <table className="w-full text-[13px] min-w-[640px]">
            <thead><tr className="border-b border-line text-left text-[12.5px] text-faint"><th className="px-6 py-4 font-normal">Document</th><th className="px-4 py-4 font-normal">Type</th><th className="px-4 py-4 font-normal">Filed under</th><th className="px-4 py-4 font-normal">Expires</th><th className="px-6 py-4 font-normal text-right">Added</th></tr></thead>
            <tbody className="divide-y divide-line">
              {docs.map((d) => {
                const exp = d.expires_at?.slice(0, 10);
                const tone = exp ? (exp < t0 ? "bad" : exp < addDays(t0, (DOC_TYPES[d.doc_type] as { expiryLeadDays?: number })?.expiryLeadDays ?? 30) ? "warn" : null) : null;
                return (
                  <tr key={d.id} className="hover:bg-hover transition-colors">
                    <td className="px-6 py-3.5"><Link href={d.file_path ? `/documents/${d.id}` : d.matter_id ? `/matters/${d.matter_id}` : "/documents"} className="flex items-center gap-2.5 text-[14px] font-medium hover:underline underline-offset-2"><Icon name="file" className="size-3.5 text-faint shrink-0" /><span className="truncate max-w-[280px]">{d.title}</span></Link></td>
                    <td className="px-4 py-3.5 text-muted whitespace-nowrap">{DOC_TYPES[d.doc_type]?.label ?? d.doc_type}</td>
                    <td className="px-4 py-3.5 text-muted">{d.matter ? <Link href={`/matters/${d.matter_id}`} className="hover:text-ink">{d.matter}</Link> : <Pill tone="warn">To file</Pill>}{d.entity ? <span className="text-faint"> · {d.entity}</span> : null}</td>
                    <td className="px-4 py-3.5 mono whitespace-nowrap">{exp ? <span className={tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-muted"}>{fmtDate(exp, { year: true })}</span> : <span className="text-faint">—</span>}</td>
                    <td className="px-6 py-3.5 text-muted mono text-right whitespace-nowrap">{fmtDate(d.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty icon="file">No documents yet. Drop one into the conversation and it appears here, read and filed.</Empty>}
      </Card>
    </Page>
  );
}
