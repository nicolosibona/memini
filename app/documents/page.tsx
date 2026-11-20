import Link from "next/link";
import { appDb, CURRENT_WS } from "@/lib/server";
import { DOC_TYPES, type DocType } from "@/lib/core/domain";
import { Card, PageHeader, Empty, fmtDate, Pill } from "@/components/ui";
import { Icon } from "@/components/Icon";
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
    <div className="rise">
      <PageHeader title="Documents" description="Everything you've forwarded or uploaded, read and filed. Expiry dates turn into renewal reminders automatically." />
      <Card className="overflow-x-auto">
        {docs.length ? (
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="px-4 py-2.5 font-normal">Document</th><th className="px-4 py-2.5 font-normal">Type</th><th className="px-4 py-2.5 font-normal">Filed under</th><th className="px-4 py-2.5 font-normal">Expires</th><th className="px-4 py-2.5 font-normal">Added</th></tr></thead>
            <tbody className="divide-y divide-line">
              {docs.map((d) => {
                const exp = d.expires_at?.slice(0, 10);
                const tone = exp ? (exp < t0 ? "bad" : exp < addDays(t0, (DOC_TYPES[d.doc_type] as { expiryLeadDays?: number })?.expiryLeadDays ?? 30) ? "warn" : null) : null;
                return (
                  <tr key={d.id} className="hover:bg-hover">
                    <td className="px-4 py-2.5"><Link href={d.file_path ? `/documents/${d.id}` : d.matter_id ? `/matters/${d.matter_id}` : "#"} className="flex items-center gap-2 font-medium hover:underline"><Icon name="file" className="size-3.5 text-muted" />{d.title}</Link></td>
                    <td className="px-4 py-2.5 text-muted">{DOC_TYPES[d.doc_type]?.label ?? d.doc_type}</td>
                    <td className="px-4 py-2.5 text-muted">{d.matter ? <Link href={`/matters/${d.matter_id}`} className="hover:text-ink">{d.matter}</Link> : <Pill tone="warn">To file</Pill>}{d.entity ? <span className="text-faint"> · {d.entity}</span> : null}</td>
                    <td className="px-4 py-2.5 tabular">{exp ? <span className={tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-muted"}>{fmtDate(exp, { year: true })}</span> : <span className="text-faint">—</span>}</td>
                    <td className="px-4 py-2.5 text-muted tabular">{fmtDate(d.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty icon="file">No documents yet.</Empty>}
      </Card>
    </div>
  );
}
