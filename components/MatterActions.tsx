"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { btnCls } from "./ui";

const FIELD_PILL = "rounded-full border border-line bg-card px-3.5 h-9 text-[13px] text-ink placeholder:text-faint focus-visible:border-ink/40";

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
    <div className="flex flex-wrap items-center gap-2">
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); save({ subject: value }); }} className="flex gap-1.5">
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "purchase" ? "Product, e.g. 65W USB-C charger" : "What it's about"} className={`${FIELD_PILL} w-56 max-w-full`} />
          <button disabled={pending} className={btnCls("primary", "sm")}>Save</button>
        </form>
      ) : (
        <button onClick={() => setEditing(true)} title={kind === "purchase" ? "Purchases with the same product are compared together" : undefined} className={btnCls("secondary", "sm")}>
          {kind === "purchase" ? "Set product" : "Edit subject"}
        </button>
      )}
      <select disabled={pending} value={status} onChange={(e) => save({ status: e.target.value })} aria-label="Status" className={FIELD_PILL}>
        <option value="open">Open</option>
        <option value="waiting">Waiting</option>
        <option value="done">Done</option>
        <option value="archived">Archived</option>
      </select>
    </div>
  );
}
