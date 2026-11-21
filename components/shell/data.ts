import "server-only";
// Server reads for the app shell and the hub headers: counts for the nav pills and a light index for ⌘K.
// Everything comes from the existing engine (lib/**); nothing here writes.
import type { DB } from "@/lib/db";
import { today } from "@/lib/db";
import { CURRENT_WS, workspaceProfile } from "@/lib/server";
import { openAlerts } from "@/lib/core/audit";
import { comparableGroups, listMatters } from "@/lib/core/matters";
import { listEntities, entityLabel } from "@/lib/core/entities";
import { ENTITY_KINDS, MATTER_KINDS, type EntityKind } from "@/lib/core/domain";
import { wecomConfigured } from "@/lib/channels/wecom";
import { listPendingItems } from "@/lib/core/ingest";
import { resolveEntity, type Clue } from "@/lib/core/entities";
import { documentClues, originalFileName } from "@/lib/core/extract";
import type { InboxItem } from "@/components/InboxList";

export type NavCounts = {
  inbox: number; overdue: number; alerts: number; quotes: number; profileLabel: string; business: boolean; electronics: boolean; wechat: "off" | "ready" | "linked";
};
export type IndexItem = { kind: "contact" | "matter" | "document"; label: string; sub: string; href: string };

const n = (db: DB, sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;

export function navCounts(db: DB): NavCounts {
  const profile = workspaceProfile(db);
  return {
    inbox: n(db, `SELECT COUNT(*) AS n FROM messages WHERE workspace_id = ? AND status = 'pending' AND intent = 'content'`, CURRENT_WS),
    overdue: n(db, `SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND status = 'open' AND due_at < ?`, CURRENT_WS, today()),
    alerts: openAlerts(db, { workspaceId: CURRENT_WS }).filter((a) => a.severity === "red").length,
    quotes: comparableGroups(db, CURRENT_WS).filter((g) => g.matters.length > 1).length,
    profileLabel: profile.def.label,
    business: profile.key === "china_business",
    electronics: profile.key === "electronics",
    wechat: wecomConfigured() ? (n(db, `SELECT COUNT(*) AS n FROM users WHERE wecom_external_userid IS NOT NULL`) ? "linked" : "ready") : "off",
  };
}

export function searchIndex(db: DB): IndexItem[] {
  const profile = workspaceProfile(db);
  const contacts: IndexItem[] = listEntities(db, CURRENT_WS, { includeSelf: true }).map((e) => ({
    kind: "contact", label: entityLabel(e), sub: [ENTITY_KINDS[e.kind]?.label, e.legal_name_zh].filter(Boolean).join(" · "), href: `/contacts/${e.id}`,
  }));
  const matters: IndexItem[] = listMatters(db, CURRENT_WS, { profile: profile.key }).map((m) => ({
    kind: "matter", label: m.title, sub: `${MATTER_KINDS[m.kind]?.label ?? m.kind} · ${m.status}`, href: `/matters/${m.id}`,
  }));
  const documents: IndexItem[] = (db.prepare(`SELECT id, title, doc_type, file_path, matter_id FROM documents WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200`).all(CURRENT_WS) as { id: string; title: string; doc_type: string; file_path: string | null; matter_id: string | null }[])
    .map((d) => ({ kind: "document" as const, label: d.title, sub: d.doc_type.replace(/_/g, " "), href: d.file_path ? `/documents/${d.id}` : d.matter_id ? `/matters/${d.matter_id}` : "/documents" }));
  return [...matters, ...contacts, ...documents].slice(0, 500);
}

/** Small numbers for the tab bars of the Work and Memory hubs. */
export function hubCounts(db: DB) {
  const profile = workspaceProfile(db);
  return {
    business: profile.key === "china_business",
    matters: listMatters(db, CURRENT_WS, { profile: profile.key, status: ["open", "waiting"] }).length,
    quotes: comparableGroups(db, CURRENT_WS).filter((g) => g.matters.length > 1).length,
    campaigns: n(db, `SELECT COUNT(*) AS n FROM outreach_campaigns WHERE workspace_id = ?`, CURRENT_WS),
    contacts: n(db, `SELECT COUNT(*) AS n FROM entities WHERE workspace_id = ? AND kind NOT LIKE 'self%'`, CURRENT_WS),
    documents: n(db, `SELECT COUNT(*) AS n FROM documents WHERE workspace_id = ?`, CURRENT_WS),
    deadlines: n(db, `SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND status = 'open'`, CURRENT_WS),
  };
}

/** Everything the "To file" picker needs: what is waiting, who it could be from, and which kinds a new contact can be. */
export function inboxData(db: DB) {
  const profile = workspaceProfile(db);
  const items: InboxItem[] = listPendingItems(db, CURRENT_WS).map((m) => {
    const x = m.extracted_json ? JSON.parse(m.extracted_json) : {};
    const clues: Clue[] = x.type === "document" ? documentClues(x.data) : [];
    if (m.original_author) clues.push({ kind: "wechat_nickname", value: m.original_author, strong: false });
    const r = resolveEntity(db, { workspaceId: CURRENT_WS, clues });
    return {
      id: m.id, kind: m.kind, received_at: m.received_at,
      title: x.type === "document" ? x.data.title : m.file_path ? originalFileName(m.file_path) : (m.text_original ?? "").slice(0, 160),
      summary: x.type === "document" ? x.data.summary : x.type === "text" ? x.data.translation : null,
      document_id: x.type === "document" ? x.document_id : null, author: m.original_author,
      suggestion: r.candidates[0]?.reason ? r.candidates[0].id : null, newName: r.newName, newKind: r.newKind, conflict: r.conflict,
    };
  });
  const contacts = listEntities(db, CURRENT_WS, { includeSelf: true }).map((e) => ({ id: e.id, label: entityLabel(e), kind: ENTITY_KINDS[e.kind].label }));
  const kinds = (profile.def.entityKinds as readonly EntityKind[]).filter((k) => !k.startsWith("self")).map((k) => ({ key: k, label: ENTITY_KINDS[k].label }));
  return { items, contacts, kinds };
}
