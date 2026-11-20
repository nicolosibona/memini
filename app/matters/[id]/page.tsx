import { notFound } from "next/navigation";
import Link from "next/link";
import { appDb, CURRENT_WS } from "@/lib/server";
import { getMatter } from "@/lib/core/matters";
import { MatterDetail } from "@/components/MatterDetail";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

export default async function MatterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await appDb();
  if (getMatter(db, id)?.workspace_id !== CURRENT_WS) notFound();
  return (
    <>
      <Link href="/matters" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-4"><Icon name="back" className="size-3.5" />Matters</Link>
      <MatterDetail db={db} id={id} />
    </>
  );
}
