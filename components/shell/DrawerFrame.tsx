"use client";
// Slide-over frame for intercepted detail routes (/matters/[id], /contacts/[id], /documents/[id]).
// Opened by a soft navigation from a list, a Bento tile or ⌘K, it keeps the page behind it in place; closing goes back.
// "Open full page" is a plain anchor, so it bypasses the interception and loads the real page.
import { useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";

export function DrawerFrame({ children, fullHref }: { children: ReactNode; fullHref: string }) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [close]);
  return (
    <div className="no-print fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Details">
      <button aria-label="Close details" onClick={close} className="absolute inset-0 bg-ink/20 backdrop-blur-[2px] fade-in cursor-default" />
      <aside className="drawer-in absolute right-0 top-0 bottom-0 w-full sm:w-[min(800px,94vw)] bg-paper border-l border-line shadow-[-30px_0_60px_-40px_rgb(22_21_19/0.35)] overflow-y-auto overscroll-contain">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 h-14 px-4 sm:px-6 bg-paper/90 backdrop-blur border-b border-line">
          {/* plain anchor on purpose: a full document load skips the drawer interception */}
          <a href={fullHref} className="bracket">Open full page</a>
          <button onClick={close} aria-label="Close" className="press grid place-items-center size-10 rounded-full hover:bg-ink/5"><Icon name="x" className="size-5" /></button>
        </div>
        <div className="px-4 sm:px-8 pt-8 pb-24">{children}</div>
      </aside>
    </div>
  );
}
