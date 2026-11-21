"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {profiles.map((p) => (
          <button key={p.key} disabled={pending} onClick={() => patch({ profile: p.key })}
            className={`text-left rounded-xl border p-4 transition-colors ${profile === p.key ? "border-ink bg-hover" : "border-line hover:bg-hover"}`}>
            <div className="flex items-center gap-2 text-[14px] font-medium">
              <span className={`size-3.5 rounded-full border ${profile === p.key ? "border-[4px] border-ink" : "border-faint"}`} />{p.label}
            </div>
            <div className="text-[12.5px] text-muted mt-1">{p.description}</div>
          </button>
        ))}
      </div>
      <div>
        <label className="text-[13px] font-medium">Your own company and people</label>
        <p className="text-[12.5px] text-muted mb-1.5">Never treated as a counterparty (e.g. the buyer on a proforma, the tenant on a lease), and used to file your own passport and permits. One per line.</p>
        <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={4} className="w-full rounded-xl border border-line px-3.5 py-2.5 text-[14px] font-mono" />
        <button disabled={pending} onClick={() => patch({ own_names: names.split("\n") })} className="mt-2 press rounded-full bg-ink text-white px-4 h-9 text-[13.5px]">{saved ? "Saved" : "Save names"}</button>
      </div>
    </div>
  );
}

export function DemoReset() {
  const router = useRouter();
  const go = async (body: unknown, msg: string) => { if (confirm(msg)) { await fetch("/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); router.refresh(); } };
  return (
    <div className="flex flex-wrap gap-2 text-[13px]">
      <button className="press rounded-full border border-line px-4 h-9 hover:bg-hover" onClick={() => go({ profile: "china_business" }, "Replace all data with the 'Doing business in China' demo?")}>Load business demo</button>
      <button className="press rounded-full border border-line px-4 h-9 hover:bg-hover" onClick={() => go({ profile: "sourcing" }, "Replace all data with the 'Sourcing buyer' demo?")}>Load sourcing demo</button>
      <button className="press rounded-full border border-bad/30 text-bad px-4 h-9 hover:bg-bad-soft" onClick={() => go({ empty: true }, "Delete ALL contacts, matters, documents and deadlines? This cannot be undone.")}>Delete all data</button>
    </div>
  );
}
