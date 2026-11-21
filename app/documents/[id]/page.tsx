import fs from "node:fs";
import { notFound } from "next/navigation";
import { appDb, CURRENT_WS } from "@/lib/server";
import { mimeOf, originalFileName } from "@/lib/core/extract";
import { formatValue, parseValue, factLabel, type FactRow } from "@/lib/core/facts";
import { DOC_TYPES, type DocType } from "@/lib/core/domain";
import type { DocumentExtraction } from "@/lib/core/schemas";
import { BackLink, Card, Page, Section, Pill, Empty, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  const d = db.prepare(`SELECT d.*, m.title AS matter_title, e.display_name AS entity_name FROM documents d LEFT JOIN matters m ON m.id = d.matter_id LEFT JOIN entities e ON e.id = d.entity_id WHERE d.id = ? AND d.workspace_id = ?`)
    .get(id, CURRENT_WS) as { id: string; doc_type: DocType; title: string; matter_id: string | null; matter_title: string | null; entity_name: string | null; extracted_json: string; file_path: string | null; expires_at: string | null } | undefined;
  if (!d) notFound();
  const x = JSON.parse(d.extracted_json ?? "{}") as Partial<DocumentExtraction>;
  const facts = db.prepare(`SELECT * FROM facts WHERE source_document_id = ? ORDER BY id`).all(id) as FactRow[];
  const mime = d.file_path ? mimeOf(d.file_path) : "";
  const src = `/api/documents/${id}/file`;
  // eslint-disable-next-line @next/next/no-img-element -- private, auth-scoped file; next/image optimization doesn't apply
  const image = <img src={src} alt="Original document" className="w-full" />;

  return (
    <Page>
      <BackLink href={d.matter_id ? `/matters/${d.matter_id}` : "/inbox"}>{d.matter_title ?? "To file"}</BackLink>
      <header className="enter mb-8">
        <div className="text-[13px] font-medium text-muted mb-2">{DOC_TYPES[d.doc_type]?.label ?? d.doc_type} · {DOC_TYPES[d.doc_type]?.zh}{d.entity_name ? ` · ${d.entity_name}` : ""}</div>
        <h1 className="display text-[40px] leading-[1.05]">{d.title}</h1>
        {x.summary && <p className="text-[15px] leading-relaxed text-muted mt-2 max-w-[65ch]">{x.summary}</p>}
        <div className="flex gap-2 mt-3">
          {typeof x.confidence === "number" && <Pill tone={x.confidence >= 0.8 ? "ok" : "warn"}>Read with {Math.round(x.confidence * 100)}% confidence</Pill>}
          {d.expires_at && <Pill>Expires {fmtDate(d.expires_at, { year: true })}</Pill>}
        </div>
      </header>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card className="overflow-hidden min-h-[480px]">
          {!d.file_path ? <Empty icon="file">No original file stored for this document.</Empty>
            : mime.startsWith("image/") ? image
            : mime === "text/html" && fs.existsSync(d.file_path) ? <iframe srcDoc={fs.readFileSync(d.file_path, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "")} sandbox="" className="w-full h-[760px]" title="Original document" />
            : <iframe src={src} sandbox="" className="w-full h-[760px]" title="Original document" />}
        </Card>
        <div>
          <Section title="What I read">
            <Card className="divide-y divide-line">
              {facts.map((f) => (
                <div key={f.id} className="grid grid-cols-[minmax(110px,150px)_1fr] gap-3 px-5 py-2.5 text-[14px]">
                  <span className="text-muted">{factLabel(f.key)}</span>
                  <span className="tabular">{formatValue(f.key, parseValue(f.value_json))}{f.status === "superseded" && <span className="text-[12.5px] text-faint"> · replaced by a newer document</span>}</span>
                </div>
              ))}
              {!facts.length && <Empty icon="file">Nothing saved yet{d.matter_id ? "" : " — file it under a contact first"}.</Empty>}
            </Card>
          </Section>
          {!!x.parties?.length && (
            <Section title="Parties">
              <Card className="divide-y divide-line">
                {x.parties.map((p, i) => (
                  <div key={i} className="grid grid-cols-[110px_1fr] gap-3 px-5 py-2.5 text-[14px]">
                    <span className="text-muted capitalize">{p.role.replace("_", " ")}</span>
                    <span>{p.name}{p.name_alt ? <span className="text-muted"> · {p.name_alt}</span> : null}{p.credit_code ? <span className="block text-[12.5px] text-muted font-mono">{p.credit_code}</span> : null}</span>
                  </div>
                ))}
              </Card>
            </Section>
          )}
          {d.file_path && <p className="text-[13px] text-muted">File: {originalFileName(d.file_path)} · <a href={src} target="_blank" rel="noreferrer" className="underline">open original</a></p>}
        </div>
      </div>
    </Page>
  );
}
