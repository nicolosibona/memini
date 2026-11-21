// /documents/[id] opened from inside the workspace: a slide-over over whatever page you were on.
import { appDb } from "@/lib/server";
import { DocumentView } from "@/components/DocumentView";
import { DrawerFrame } from "@/components/shell/DrawerFrame";

export const dynamic = "force-dynamic";

export default async function DocumentDrawer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  const view = await DocumentView({ db, id, variant: "drawer" });
  if (!view) return null;
  return <DrawerFrame fullHref={`/documents/${id}`}>{view}</DrawerFrame>;
}
