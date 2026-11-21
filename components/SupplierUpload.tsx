"use client";
// One document slot on the counterparty page: a big tap target that opens the camera / photo library / files,
// then sends at once. Without JavaScript the form still works with its own button.
import { useRef, useState } from "react";

export function SupplierUpload({ token, docZh, docEn, done }: { token: string; docZh: string; docEn: string; done: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form ref={form} method="post" action={`/api/c/${token}`} encType="multipart/form-data" className="flex items-center gap-3 px-4 py-3.5">
      <input type="hidden" name="action" value="upload" />
      <div className="flex-1 min-w-0">
        <div className="text-[18px] font-semibold leading-snug">{docZh}</div>
        <div className="text-[13px] text-muted">{docEn}</div>
      </div>
      {done ? (
        <span className="shrink-0 rounded-full bg-ok-soft text-ok px-3 py-1.5 text-[14px] font-semibold">✓ 已收到</span>
      ) : (
        <label className={`press shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 h-11 text-[15px] font-semibold ${busy ? "bg-line-2 text-muted" : "bg-ink text-white"}`}>
          {busy ? "上传中…" : "📷 上传"}
          <input
            type="file" name="file" accept="image/*,application/pdf" className="sr-only" disabled={busy}
            onChange={(e) => { if (e.target.files?.length) { setBusy(true); form.current?.requestSubmit(); } }}
          />
        </label>
      )}
      <noscript><button className="rounded-full border px-3 h-10">提交 Upload</button></noscript>
    </form>
  );
}
