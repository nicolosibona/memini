// /matters/[id] opened from inside the workspace: a slide-over over whatever page you were on.
import { appDb, CURRENT_WS } from "@/lib/server";
import { getMatter } from "@/lib/core/matters";
import { MatterDetail } from "@/components/MatterDetail";
import { DrawerFrame } from "@/components/shell/DrawerFrame";

export const dynamic = "force-dynamic";

export default async function MatterDrawer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  if (getMatter(db, id)?.workspace_id !== CURRENT_WS) return null;
  return (
    <DrawerFrame fullHref={`/matters/${id}`}>
      <MatterDetail db={db} id={id} variant="drawer" />
    </DrawerFrame>
  );
}
