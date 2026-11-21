import { notFound } from "next/navigation";
import { appDb } from "@/lib/server";
import { DocumentView } from "@/components/DocumentView";
import { BackLink, Page } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  const view = await DocumentView({ db, id });
  if (!view) notFound();
  const m = db.prepare(`SELECT matter_id, (SELECT title FROM matters WHERE id = documents.matter_id) AS title FROM documents WHERE id = ?`).get(id) as { matter_id: string | null; title: string | null };
  return (
    <Page>
      <BackLink href={m.matter_id ? `/matters/${m.matter_id}` : "/documents"}>{m.title ?? "Documents"}</BackLink>
      {view}
    </Page>
  );
}
