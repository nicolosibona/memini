import Link from "next/link";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { listEntities, entityLabel } from "@/lib/core/entities";
import { listMatters } from "@/lib/core/matters";
import { trustLight, openAlerts } from "@/lib/core/audit";
import { ENTITY_KINDS, type EntityKind } from "@/lib/core/domain";
import { Card, Page, TrustPill, Empty, fmtDate } from "@/components/ui";
import { Icon, ENTITY_ICON } from "@/components/Icon";
import { HubHeader } from "@/components/shell/Hub";
import { hubCounts } from "@/components/shell/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Memory" };

export default async function ContactsPage() {
  const db = await appDb();
  const profile = workspaceProfile(db);
  const business = profile.key === "china_business";
  const kinds = profile.def.entityKinds as readonly EntityKind[];
  const all = listEntities(db, CURRENT_WS, { includeSelf: true }).filter((e) => kinds.includes(e.kind));
  const groups = kinds.map((k) => ({ kind: k, items: all.filter((e) => e.kind === k) })).filter((g) => g.items.length);

  return (
    <Page>
      <HubHeader
        hub="memory" tab="contacts" counts={hubCounts(db)}
        lead={business ? "Everyone you deal with." : "Every supplier you deal with."}
        rest="Never guessed."
        note="Identified from licenses, contracts and notices, never from a nickname."
      />
      {!groups.length && <Card><Empty icon="users">Nobody yet. Forward a message or document.</Empty></Card>}
      <div className="space-y-6">
        {groups.map((g) => (
          <Card key={g.kind}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 className="text-[15px] font-medium inline-flex items-center gap-2"><Icon name={ENTITY_ICON[g.kind]} className="size-4 text-faint" />{ENTITY_KINDS[g.kind].plural}</h2>
              <span className="text-[12.5px] text-faint tabular">{g.items.length}</span>
            </div>
            <div className="divide-y divide-line">
              {g.items.map((e) => {
                const matters = listMatters(db, CURRENT_WS, { entityId: e.id, status: ["open", "waiting"] });
                const alerts = openAlerts(db, { entityId: e.id });
                return (
                  <Link key={e.id} href={`/contacts/${e.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_220px_130px_110px] items-center gap-x-4 gap-y-1 px-6 py-4 hover:bg-hover transition-colors last:rounded-b-3xl">
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-medium truncate">{entityLabel(e)}</div>
                      <div className="text-[12.5px] text-muted truncate">{[e.legal_name_zh, e.credit_code].filter(Boolean).join(" · ") || ENTITY_KINDS[e.kind].label}</div>
                    </div>
                    <div className="hidden md:block text-[12.5px] text-muted truncate">{matters.map((m) => m.title).join(", ") || "No open matters"}</div>
                    <div className="hidden md:block text-[12.5px] text-muted tabular">{alerts.length ? <span className="text-bad">{alerts.length} alert{alerts.length > 1 ? "s" : ""}</span> : null}{alerts.length && e.last_activity_at ? " · " : ""}{e.last_activity_at ? fmtDate(e.last_activity_at) : ""}</div>
                    <div className="flex justify-end">{g.kind.startsWith("self") ? null : <TrustPill trust={trustLight(db, { entityId: e.id })} />}</div>
                  </Link>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </Page>
  );
}
