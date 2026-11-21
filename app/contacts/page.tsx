import Link from "next/link";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { listEntities, entityLabel } from "@/lib/core/entities";
import { listMatters } from "@/lib/core/matters";
import { trustLight, openAlerts } from "@/lib/core/audit";
import { ENTITY_KINDS, type EntityKind } from "@/lib/core/domain";
import { Card, Page, PageHeader, Section, TrustPill, Empty, fmtDate } from "@/components/ui";
import { Icon, ENTITY_ICON } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  const db = await appDb();
  const profile = workspaceProfile(db);
  const kinds = profile.def.entityKinds as readonly EntityKind[];
  const all = listEntities(db, CURRENT_WS, { includeSelf: true }).filter((e) => kinds.includes(e.kind));
  const groups = kinds.map((k) => ({ kind: k, items: all.filter((e) => e.kind === k) })).filter((g) => g.items.length);

  return (
    <Page>
      <PageHeader
        title={profile.key === "china_business" ? "Contacts" : "Suppliers"}
        description="Everyone you deal with. Identified from licenses, contracts and notices — never guessed from a nickname."
      />
      {!groups.length && <Card><Empty icon="users">Nobody yet. Forward a message or document.</Empty></Card>}
      {groups.map((g) => (
        <Section key={g.kind} title={<span className="inline-flex items-center gap-1.5"><Icon name={ENTITY_ICON[g.kind]} className="size-3.5" />{ENTITY_KINDS[g.kind].plural}</span>} right={`${g.items.length}`}>
          <Card className="divide-y divide-line">
            {g.items.map((e) => {
              const matters = listMatters(db, CURRENT_WS, { entityId: e.id, status: ["open", "waiting"] });
              const alerts = openAlerts(db, { entityId: e.id });
              return (
                <Link key={e.id} href={`/contacts/${e.id}`} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_200px_120px_110px] items-center gap-3 px-5 py-3.5 hover:bg-hover transition-colors">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium truncate">{entityLabel(e)}</div>
                    <div className="text-[12.5px] text-muted truncate">{[e.legal_name_zh, e.credit_code].filter(Boolean).join(" · ") || ENTITY_KINDS[e.kind].label}</div>
                  </div>
                  <div className="hidden sm:block text-[12.5px] text-muted truncate">{matters.map((m) => m.title).join(", ") || "—"}</div>
                  <div className="hidden sm:block text-[12.5px] text-muted">{alerts.length ? `${alerts.length} alert${alerts.length > 1 ? "s" : ""}` : ""} {e.last_activity_at ? `· ${fmtDate(e.last_activity_at)}` : ""}</div>
                  <div className="flex justify-end">{g.kind.startsWith("self") ? null : <TrustPill trust={trustLight(db, { entityId: e.id })} />}</div>
                </Link>
              );
            })}
          </Card>
        </Section>
      ))}
    </Page>
  );
}
