// A cheap fingerprint of everything the UI shows, so open pages refresh the moment something changes
// (a WeChat forward, a filed document, a ticked deadline) without reloading on a timer.
import "server-only";
import crypto from "node:crypto";
import type { DB } from "@/lib/db";
import { originalFileName } from "@/lib/core/extract";

export type PulseEvent = { id: string; channel: string; kind: string; text: string; at: string };

export function pulse(db: DB, ws: string): { v: string; latest: PulseEvent | null } {
  const row = db.prepare(
    `SELECT
       (SELECT COUNT(*) || ':' || IFNULL(MAX(rowid), 0) || ':' || IFNULL(SUM(status = 'pending'), 0) FROM messages WHERE workspace_id = @ws) AS m,
       (SELECT COUNT(*) || ':' || IFNULL(MAX(rowid), 0) || ':' || IFNULL(MAX(matter_id), '') FROM documents WHERE workspace_id = @ws) AS d,
       (SELECT COUNT(*) || ':' || IFNULL(MAX(id), 0) || ':' || IFNULL(SUM(status = 'open'), 0) FROM alerts WHERE workspace_id = @ws) AS a,
       (SELECT COUNT(*) || ':' || IFNULL(MAX(id), 0) || ':' || IFNULL(SUM(status = 'open'), 0) FROM tasks WHERE workspace_id = @ws) AS t,
       (SELECT COUNT(*) || ':' || IFNULL(MAX(id), 0) || ':' || IFNULL(SUM(status = 'agreed'), 0) || ':' || IFNULL(SUM(status = 'rejected'), 0) FROM facts WHERE workspace_id = @ws) AS f,
       (SELECT COUNT(*) || ':' || IFNULL(MAX(updated_at), '') FROM matters WHERE workspace_id = @ws) AS mt,
       (SELECT COUNT(*) || ':' || IFNULL(MAX(last_activity_at), '') FROM entities WHERE workspace_id = @ws) AS e,
       (SELECT profile || own_names FROM workspaces WHERE id = @ws) AS w,
       (SELECT COUNT(*) FROM users WHERE wecom_external_userid IS NOT NULL) AS u,
       (SELECT COUNT(*) || ':' || IFNULL(MAX(updated_at), '') FROM outreach_campaigns WHERE workspace_id = @ws) AS oc,
       (SELECT COUNT(*) || ':' || IFNULL(MAX(updated_at), '') || ':' || IFNULL(GROUP_CONCAT(status), '') FROM outreach_recipients WHERE campaign_id IN (SELECT id FROM outreach_campaigns WHERE workspace_id = @ws)) AS orp`,
  ).get({ ws }) as Record<string, string | number>;
  const v = crypto.createHash("sha1").update(Object.values(row).join("|")).digest("hex").slice(0, 16);
  const last = db.prepare(
    `SELECT id, channel, kind, text_original, file_path, received_at AS at FROM messages
     WHERE workspace_id = ? AND direction = 'in' AND kind NOT IN ('menu_click', 'event') ORDER BY received_at DESC, rowid DESC LIMIT 1`,
  ).get(ws) as { id: string; channel: string; kind: string; text_original: string | null; file_path: string | null; at: string } | undefined;
  if (!last) return { v, latest: null };
  const text = last.text_original ?? (last.file_path && last.kind === "file" ? originalFileName(last.file_path) : "");
  return { v, latest: { id: last.id, channel: last.channel, kind: last.kind, text: text.slice(0, 90), at: last.at } };
}
