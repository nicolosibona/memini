"use client";
// Keeps every open page in step with the memory: polls a fingerprint and refreshes the page data when it changes.
// A forward arriving from WeChat also shows a small toast, so you see it land while you work.
import { isPublicPath } from "@/lib/publicPaths";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "./Icon";

type Event = { id: string; channel: string; kind: string; text: string; at: string };
const KIND: Record<string, string> = { text: "Message", voice: "Voice note", image: "Photo", file: "Document", merged: "Chat history" };

export function LiveUpdates({ initial }: { initial: string }) {
  const router = useRouter();
  const path = usePathname();
  const version = useRef(initial);
  const lastId = useRef<string | null>(null);
  const [toast, setToast] = useState<Event | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/api/pulse", { cache: "no-store" });
          const j = (await r.json()) as { v: string; latest: Event | null };
          if (lastId.current === null) lastId.current = j.latest?.id ?? "";
          if (j.v !== version.current) {
            version.current = j.v;
            router.refresh();
            window.dispatchEvent(new CustomEvent("memini:pulse", { detail: j }));
            if (j.latest && j.latest.id !== lastId.current && j.latest.channel === "wecom") setToast(j.latest);
          }
          lastId.current = j.latest?.id ?? lastId.current;
        } catch { /* offline for a moment: try again next tick */ }
      }
      if (!stop) timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 1500);
    const onFocus = () => { clearTimeout(timer); void tick(); };
    window.addEventListener("focus", onFocus);
    return () => { stop = true; clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [router]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast || isPublicPath(path)) return null;
  return (
    <div className="no-print fixed bottom-24 right-4 left-4 sm:right-6 sm:left-auto z-50 toast-in" role="status">
      <Link href="/" onClick={() => setToast(null)} className="flex items-center gap-3 rounded-3xl border border-line bg-card px-4 py-3 shadow-float sm:w-[360px]">
        <span className="grid place-items-center size-9 rounded-full bg-wechat-soft text-wechat-dark shrink-0"><Icon name="wechat" className="size-[18px]" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-muted">{KIND[toast.kind] ?? "New item"} from WeChat</span>
          <span className="block text-[14px] text-ink truncate">{toast.text || "Received"}</span>
        </span>
        <button onClick={(e) => { e.preventDefault(); setToast(null); }} aria-label="Dismiss" className="grid place-items-center size-8 rounded-full text-faint hover:text-ink hover:bg-hover"><Icon name="x" className="size-4" /></button>
      </Link>
    </div>
  );
}
