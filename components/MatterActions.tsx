"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function MatterActions({ id, status, subject, kind }: { id: string; status: string; subject: string | null; kind: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(subject ?? "");
  const save = (body: unknown) => start(async () => {
    const r = await fetch(`/api/matters/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? "Failed");
    setEditing(false);
    router.refresh();
  });
  return (
    <div className="flex items-center gap-2 text-xs">
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); save({ subject: value }); }} className="flex gap-1">
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "purchase" ? "Product, e.g. 65W USB-C charger" : "What it's about"} className="rounded-md border border-line px-2 py-1 w-56" />
          <button disabled={pending} className="rounded-md bg-ink text-white px-2 py-1">Save</button>
        </form>
      ) : (
        <button onClick={() => setEditing(true)} title={kind === "purchase" ? "Purchases with the same product are compared together" : undefined} className="rounded-md border border-line px-2 py-1 hover:bg-hover">
          {kind === "purchase" ? "Set product" : "Edit subject"}
        </button>
      )}
      <select disabled={pending} value={status} onChange={(e) => save({ status: e.target.value })} className="rounded-md border border-line bg-card px-1.5 py-1">
        <option value="open">Open</option>
        <option value="waiting">Waiting</option>
        <option value="done">Done</option>
        <option value="archived">Archived</option>
      </select>
    </div>
  );
}
