import { notFound } from "next/navigation";
import { appDb, CURRENT_WS } from "@/lib/server";
import { getEntity } from "@/lib/core/entities";
import { EntityDetail } from "@/components/EntityDetail";
import { BackLink, Page } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  if (getEntity(db, id)?.workspace_id !== CURRENT_WS) notFound();
  return (
    <Page>
      <BackLink href="/contacts">Memory</BackLink>
      <EntityDetail db={db} id={id} />
    </Page>
  );
}
