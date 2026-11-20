// Mobile page opened from a WeChat link (signed, expiring token — blueprint §9, §12): a matter or a contact.
import { notFound } from "next/navigation";
import { appDb } from "@/lib/server";
import { verifyLink } from "@/lib/core/links";
import { getMatter } from "@/lib/core/matters";
import { getEntity } from "@/lib/core/entities";
import { MatterDetail } from "@/components/MatterDetail";
import { EntityDetail } from "@/components/EntityDetail";

export const dynamic = "force-dynamic";
export const metadata = { title: "Details", robots: { index: false } };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = verifyLink(token);
  if (!t) notFound();
  const db = await appDb();
  if (t.kind === "m" ? !getMatter(db, t.id) : !getEntity(db, t.id)) notFound();
  return (
    <div className="max-w-xl mx-auto">
      <div className="text-xs text-muted mb-4 flex items-center gap-1.5"><span className="grid place-items-center size-5 rounded bg-brand text-white text-[10px] font-[family-name:var(--font-seal)]">印</span>Memini · verify before paying</div>
      {t.kind === "m" ? <MatterDetail db={db} id={t.id} compact /> : <EntityDetail db={db} id={t.id} compact />}
    </div>
  );
}
