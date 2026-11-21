import { notFound } from "next/navigation";
import { appDb, CURRENT_WS } from "@/lib/server";
import { getMatter } from "@/lib/core/matters";
import { MatterDetail } from "@/components/MatterDetail";
import { BackLink, Page } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  if (getMatter(db, id)?.workspace_id !== CURRENT_WS) notFound();
  return (
    <Page>
      <BackLink href="/matters">Work</BackLink>
      <MatterDetail db={db} id={id} />
    </Page>
  );
}
