// Document body — the original beside what Memini read from it. Used by /documents/[id] and its slide-over.
import fs from "node:fs";
import type { ReactNode } from "react";
import type { DB } from "@/lib/db";
import { CURRENT_WS } from "@/lib/server";
import { mimeOf, originalFileName } from "@/lib/core/extract";
import { formatValue, parseValue, factLabel, type FactRow } from "@/lib/core/facts";
import { DOC_TYPES, type DocType } from "@/lib/core/domain";
import type { DocumentExtraction } from "@/lib/core/schemas";
import { Card, CardHead, Headline, Lede, Pill, Empty, fmtDate } from "./ui";

type Doc = { id: string; doc_type: DocType; title: string; matter_id: string | null; matter_title: string | null; entity_name: string | null; extracted_json: string; file_path: string | null; expires_at: string | null };

export async function DocumentView({ db, id, variant = "page" }: { db: DB; id: string; variant?: "page" | "drawer" }): Promise<ReactNode | null> {
  const d = db.prepare(`SELECT d.*, m.title AS matter_title, e.display_name AS entity_name FROM documents d LEFT JOIN matters m ON m.id = d.matter_id LEFT JOIN entities e ON e.id = d.entity_id WHERE d.id = ? AND d.workspace_id = ?`)
    .get(id, CURRENT_WS) as Doc | undefined;
  if (!d) return null;
  const x = JSON.parse(d.extracted_json ?? "{}") as Partial<DocumentExtraction>;
  const facts = db.prepare(`SELECT * FROM facts WHERE source_document_id = ? ORDER BY id`).all(id) as FactRow[];
  const mime = d.file_path ? mimeOf(d.file_path) : "";
  const src = `/api/documents/${id}/file`;
  const side = variant === "page";
  // eslint-disable-next-line @next/next/no-img-element -- private, auth-scoped file; next/image optimization doesn't apply
  const image = <img src={src} alt="Original document" className="w-full" />;

  return (
    <div className="rise">
      <header className="mb-8">
        <div className="text-[12.5px] font-medium text-faint mb-3">{DOC_TYPES[d.doc_type]?.label ?? d.doc_type} · {DOC_TYPES[d.doc_type]?.zh}{d.entity_name ? ` · ${d.entity_name}` : ""}</div>
        <Headline lead={d.title} className="max-w-[760px]" />
        {x.summary && <Lede>{x.summary}</Lede>}
        <div className="flex flex-wrap gap-2 mt-4">
          {typeof x.confidence === "number" && <Pill tone={x.confidence >= 0.8 ? "ok" : "warn"}>Read with {Math.round(x.confidence * 100)}% confidence</Pill>}
          {d.expires_at && <Pill>Expires {fmtDate(d.expires_at, { year: true })}</Pill>}
        </div>
      </header>
      <div className={`grid grid-cols-1 gap-6 ${side ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" : ""}`}>
        <Card className="overflow-hidden min-h-[360px] self-start">
          {!d.file_path ? <Empty icon="file">No original file stored for this document.</Empty>
            : mime.startsWith("image/") ? image
            : mime === "text/html" && fs.existsSync(d.file_path) ? <iframe srcDoc={fs.readFileSync(d.file_path, "utf8").replace(/<script[\s\S]*?<\/script>/gi, "")} sandbox="" className={`w-full ${side ? "h-[760px]" : "h-[560px]"}`} title="Original document" />
            : <iframe src={src} sandbox="" className={`w-full ${side ? "h-[760px]" : "h-[560px]"}`} title="Original document" />}
        </Card>
        <div className="space-y-6 min-w-0">
          <Card>
            <CardHead title="What I read" />
            <div className="divide-y divide-line">
              {facts.map((f) => (
                <div key={f.id} className="grid grid-cols-[minmax(100px,150px)_1fr] gap-3 px-6 py-3 text-[14px]">
                  <span className="text-muted">{factLabel(f.key)}</span>
                  <span className="tabular">{formatValue(f.key, parseValue(f.value_json))}{f.status === "superseded" && <span className="text-[12.5px] text-faint"> · replaced by a newer document</span>}</span>
                </div>
              ))}
              {!facts.length && <Empty icon="file">Nothing saved yet{d.matter_id ? "" : ". File it under a contact first"}.</Empty>}
            </div>
          </Card>
          {!!x.parties?.length && (
            <Card>
              <CardHead title="Parties" />
              <div className="divide-y divide-line">
                {x.parties.map((p, i) => (
                  <div key={i} className="grid grid-cols-[100px_minmax(0,1fr)] gap-3 px-6 py-3 text-[14px]">
                    <span className="text-muted capitalize">{p.role.replace("_", " ")}</span>
                    <span>{p.name}{p.name_alt ? <span className="text-muted"> · {p.name_alt}</span> : null}{p.credit_code ? <span className="mono block text-[12.5px] text-muted">{p.credit_code}</span> : null}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {d.file_path && <p className="text-[13px] text-muted px-1">File: {originalFileName(d.file_path)} · <a href={src} target="_blank" rel="noreferrer" className="underline underline-offset-2">open original</a></p>}
        </div>
      </div>
    </div>
  );
}
