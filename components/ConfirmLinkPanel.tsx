"use client";
// Matter page: "Ask them to confirm" — pick the terms (and which value, when a document and the chat disagree),
// pick the documents still missing, get a link + a ready Chinese WeChat message to forward.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "./CopyButton";
import { Card, FIELD, btnCls, Pill } from "./ui";

type Choice = { key: string; zh: string; en: string; default_fact_id: number; options: { fact_id: number; value_en: string; value_zh: string; source: string; conflict: boolean }[] };
type LinkInfo = { token: string; url: string; status: string; created_at: string; expires_at: string; opened_at: string | null; open_count: number; upload_count: number; terms: number; message_zh: string };
type Data = { choices: Choice[]; missing: string[]; docOptions: { doc: string; label: string; zh: string }[]; links: LinkInfo[] };

const STATUS: Record<string, [string, "ok" | "warn" | "neutral" | "bad"]> = {
  open: ["Waiting", "neutral"], confirmed: ["Confirmed", "ok"], changes_requested: ["Change requested", "warn"], expired: ["Expired", "neutral"], revoked: ["Disabled", "neutral"],
};

export function ConfirmLinkPanel({ matterId, counterparty }: { matterId: string; counterparty: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, number | null>>({});
  const [docs, setDocs] = useState<string[]>([]);
  const [contact, setContact] = useState("");
  const [result, setResult] = useState<{ url: string; message_zh: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/matters/${matterId}/confirm-link`);
    if (!r.ok) return;
    const d = (await r.json()) as Data;
    setData(d);
    setPicked(Object.fromEntries(d.choices.map((c) => [c.key, c.default_fact_id])));
    setDocs(d.missing);
  }, [matterId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/matters/${matterId}/confirm-link`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ factIds: Object.values(picked).filter((v): v is number => v != null), docs, contactName: contact }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Failed");
      setResult(j); setOpen(false);
      await load(); router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const revoke = async (token: string) => {
    if (!confirm("Disable this link? The page will say it has expired.")) return;
    await fetch(`/api/matters/${matterId}/confirm-link?token=${token}`, { method: "DELETE" });
    await load();
  };

  if (!data) return null;
  const nothing = !data.choices.length && !data.docOptions.length;
  return (
    <Card className="p-5">
      <div className="text-[15px] font-medium tracking-[-0.01em] text-ink">Ask {counterparty ?? "them"} to confirm</div>
      <p className="text-[12.5px] text-muted mt-1.5 leading-relaxed">A page in Chinese they open from WeChat, no app and no sign-up. They confirm the terms in one tap, ask for changes, or upload what&apos;s missing. It all lands here.</p>

      {result && (
        <div className="mt-4 rounded-2xl bg-wechat-soft border border-wechat/20 p-4">
          <div className="text-[12px] text-wechat-dark font-medium mb-1.5">Forward this on WeChat</div>
          <div lang="zh-CN" className="text-[14px] leading-relaxed whitespace-pre-wrap break-all text-ink">{result.message_zh}</div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <CopyButton text={result.message_zh} label="Copy message" />
            <a href={result.url} target="_blank" rel="noreferrer" className="bracket">Preview page</a>
          </div>
        </div>
      )}

      {!open ? (
        <button disabled={nothing} onClick={() => { setOpen(true); setResult(null); }} className={`${btnCls("primary", "sm")} mt-4`}>{data.links.length ? "New link" : "Create link"}</button>
      ) : (
        <div className="mt-4 space-y-3">
          {data.choices.length > 0 && (
            <div className="rounded-2xl border border-line bg-ivory p-4">
              <div className="text-[12.5px] text-muted mb-2.5">Terms to confirm</div>
              <div className="space-y-2.5">
                {data.choices.map((c) => (
                  <div key={c.key} className="text-[13px]">
                    <label className="flex items-center gap-2.5">
                      <input type="checkbox" className="size-4 accent-ink shrink-0" checked={picked[c.key] != null} onChange={(e) => setPicked({ ...picked, [c.key]: e.target.checked ? c.default_fact_id : null })} />
                      <span className="font-medium text-ink">{c.en}</span> <span className="text-faint">{c.zh}</span>
                      {c.options.length === 1 && <span className="ml-auto tabular text-ink-2">{c.options[0].value_en}</span>}
                    </label>
                    {c.options.length > 1 && picked[c.key] != null && (
                      <div className="pl-6 mt-1.5 space-y-1.5">
                        <div className="text-[12px] text-warn">Document and chat disagree. Which value goes on the page?</div>
                        {c.options.map((o) => (
                          <label key={o.fact_id} className="flex items-center gap-2">
                            <input type="radio" className="accent-ink" name={`opt-${c.key}`} checked={picked[c.key] === o.fact_id} onChange={() => setPicked({ ...picked, [c.key]: o.fact_id })} />
                            <span className="tabular">{o.value_en}</span><span className="text-muted">({o.source})</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-line bg-ivory p-4">
            <div className="text-[12.5px] text-muted mb-2.5">Documents to upload</div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
              {data.docOptions.map((d) => (
                <label key={d.doc} className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-ink" checked={docs.includes(d.doc)} onChange={(e) => setDocs(e.target.checked ? [...docs, d.doc] : docs.filter((x) => x !== d.doc))} />
                  {d.label} <span className="text-faint">{d.zh}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="block text-[12.5px] text-muted">Greeting name (optional)
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="e.g. 王经理 or Lisa" className={`${FIELD} mt-1.5 block w-full`} />
          </label>
          {err && <div className="text-[12.5px] text-bad">{err}</div>}
          <div className="flex items-center gap-2">
            <button disabled={busy} onClick={create} className={btnCls("primary", "sm")}>{busy ? "Creating…" : "Create link"}</button>
            <button onClick={() => setOpen(false)} className={btnCls("secondary", "sm")}>Cancel</button>
          </div>
        </div>
      )}

      {data.links.length > 0 && (
        <div className="mt-5 border-t border-line pt-4 space-y-3">
          {data.links.slice(0, 4).map((l) => (
            <div key={l.token} className="text-[12.5px]">
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone={STATUS[l.status]?.[1] ?? "neutral"}>{STATUS[l.status]?.[0] ?? l.status}</Pill>
                <span className="text-muted mono">{new Date(l.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                <span className="text-muted">{l.open_count ? `opened ${l.open_count}×` : "not opened yet"}{l.upload_count ? ` · ${l.upload_count} file${l.upload_count > 1 ? "s" : ""}` : ""}</span>
              </div>
              {["open", "changes_requested"].includes(l.status) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                  <CopyButton text={l.message_zh} label="Copy message" className="bracket" />
                  <a href={l.url} target="_blank" rel="noreferrer" className="bracket">Open</a>
                  <button onClick={() => revoke(l.token)} className="bracket !text-muted">Disable</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
