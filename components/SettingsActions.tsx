"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";

export function ProfileForm({ profile, ownNames, profiles }: { profile: string; ownNames: string[]; profiles: { key: string; label: string; description: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [names, setNames] = useState(ownNames.join("\n"));
  const [saved, setSaved] = useState(false);
  const patch = (body: unknown) => start(async () => {
    const r = await fetch("/api/workspace", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? "Failed");
    setSaved(true); setTimeout(() => setSaved(false), 1500);
    router.refresh();
  });
  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-2">
        {profiles.map((p) => (
          <button key={p.key} disabled={pending} onClick={() => patch({ profile: p.key })}
            className={`text-left rounded-lg border p-3 transition-colors ${profile === p.key ? "border-ink bg-hover" : "border-line hover:bg-hover"}`}>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={`size-3.5 rounded-full border ${profile === p.key ? "border-[4px] border-ink" : "border-faint"}`} />{p.label}
            </div>
            <div className="text-xs text-muted mt-1">{p.description}</div>
          </button>
        ))}
      </div>
      <div>
        <label className="text-[13px] font-medium">Your own company and people</label>
        <p className="text-xs text-muted mb-1.5">Never treated as a counterparty (e.g. the buyer on a proforma, the tenant on a lease), and used to file your own passport and permits. One per line.</p>
        <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={4} className="w-full rounded-lg border border-line px-3 py-2 text-sm font-mono" />
        <button disabled={pending} onClick={() => patch({ own_names: names.split("\n") })} className="mt-2 rounded-md bg-ink text-white px-3 py-1.5 text-[13px]">{saved ? "Saved" : "Save names"}</button>
      </div>
    </div>
  );
}

export function WeChatConnect({ enabled }: { enabled: boolean }) {
  const [qr, setQr] = useState<{ url: string; code: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <button disabled={!enabled} onClick={async () => {
        setErr(null);
        const r = await fetch("/api/link/wechat", { method: "POST" });
        const j = await r.json();
        if (!r.ok) setErr(j.error); else setQr(j);
      }} className="rounded-md bg-[#07c160] text-white px-3 py-1.5 text-[13px] disabled:opacity-40">Connect WeChat</button>
      {err && <p className="text-bad mt-2 text-[13px]">{err}</p>}
      {qr && (
        <div className="mt-3 flex items-center gap-4">
          <QRCodeSVG value={qr.url} size={132} />
          <div className="text-[13px]">Scan with WeChat. If linking doesn&apos;t happen automatically, send this code in the chat: <b className="font-mono text-base">{qr.code}</b></div>
        </div>
      )}
    </div>
  );
}

export function DemoReset() {
  const router = useRouter();
  const go = async (body: unknown, msg: string) => { if (confirm(msg)) { await fetch("/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); router.refresh(); } };
  return (
    <div className="flex flex-wrap gap-2 text-[13px]">
      <button className="rounded-md border border-line px-3 py-1.5 hover:bg-hover" onClick={() => go({ profile: "china_business" }, "Replace all data with the 'Doing business in China' demo?")}>Load business demo</button>
      <button className="rounded-md border border-line px-3 py-1.5 hover:bg-hover" onClick={() => go({ profile: "sourcing" }, "Replace all data with the 'Sourcing buyer' demo?")}>Load sourcing demo</button>
      <button className="rounded-md border border-bad/30 text-bad px-3 py-1.5 hover:bg-bad-soft" onClick={() => go({ empty: true }, "Delete ALL contacts, matters, documents and deadlines? This cannot be undone.")}>Delete all data</button>
    </div>
  );
}
