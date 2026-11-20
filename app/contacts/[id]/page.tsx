import { notFound } from "next/navigation";
import Link from "next/link";
import { appDb, CURRENT_WS } from "@/lib/server";
import { getEntity } from "@/lib/core/entities";
import { EntityDetail } from "@/components/EntityDetail";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  if (getEntity(db, id)?.workspace_id !== CURRENT_WS) notFound();
  return (
    <>
      <Link href="/contacts" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-4"><Icon name="back" className="size-3.5" />Contacts</Link>
      <EntityDetail db={db} id={id} />
    </>
  );
}
