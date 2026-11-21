import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { listPendingItems } from "@/lib/core/ingest";
import { listEntities, resolveEntity, entityLabel, type Clue } from "@/lib/core/entities";
import { documentClues, originalFileName } from "@/lib/core/extract";
import { ENTITY_KINDS, type EntityKind } from "@/lib/core/domain";
import { InboxList, type InboxItem } from "@/components/InboxList";
import { Page, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "To file" };

export default async function InboxPage() {
  const db = await appDb();
  const profile = workspaceProfile(db);
  const msgs = listPendingItems(db, CURRENT_WS);
  const contacts = listEntities(db, CURRENT_WS, { includeSelf: true }).map((e) => ({ id: e.id, label: entityLabel(e), kind: ENTITY_KINDS[e.kind].label }));
  const items: InboxItem[] = msgs.map((m) => {
    const x = m.extracted_json ? JSON.parse(m.extracted_json) : {};
    const clues: Clue[] = x.type === "document" ? documentClues(x.data) : [];
    if (m.original_author) clues.push({ kind: "wechat_nickname", value: m.original_author, strong: false });
    const r = resolveEntity(db, { workspaceId: CURRENT_WS, clues });
    return {
      id: m.id, kind: m.kind, received_at: m.received_at,
      title: x.type === "document" ? x.data.title : m.file_path ? originalFileName(m.file_path) : (m.text_original ?? "").slice(0, 160),
      summary: x.type === "document" ? x.data.summary : x.type === "text" ? x.data.translation : null,
      document_id: x.type === "document" ? x.document_id : null, author: m.original_author,
      suggestion: r.candidates[0]?.reason ? r.candidates[0].id : null, newName: r.newName, newKind: r.newKind, conflict: r.conflict,
    };
  });
  const kinds = (profile.def.entityKinds as readonly EntityKind[]).filter((k) => !k.startsWith("self")).map((k) => ({ key: k, label: ENTITY_KINDS[k].label }));
  return (
    <Page narrow>
      <PageHeader title="To file" description="I never guess who something is from. These had no name or code I could match for sure — pick the contact and I'll file it, check it and track its dates." />
      <InboxList items={items} contacts={contacts} kinds={kinds} />
    </Page>
  );
}
