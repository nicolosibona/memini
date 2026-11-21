// /contacts/[id] opened from inside the workspace: a slide-over over whatever page you were on.
import { appDb, CURRENT_WS } from "@/lib/server";
import { getEntity } from "@/lib/core/entities";
import { EntityDetail } from "@/components/EntityDetail";
import { DrawerFrame } from "@/components/shell/DrawerFrame";

export const dynamic = "force-dynamic";

export default async function ContactDrawer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  if (getEntity(db, id)?.workspace_id !== CURRENT_WS) return null;
  return (
    <DrawerFrame fullHref={`/contacts/${id}`}>
      <EntityDetail db={db} id={id} variant="drawer" />
    </DrawerFrame>
  );
}
