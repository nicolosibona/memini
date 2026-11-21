"use client";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AmbientField } from "../ambient/AmbientField";
import { Mist, Silk } from "../ambient/Stage";
import { TopNav, TabBar } from "./TopNav";
import { Dock, ChatPanel } from "./Dock";
import { CommandPalette } from "./CommandPalette";
import type { IndexItem, NavCounts } from "./data";

/** One living layer for the whole workspace: tall behind Today, a short band elsewhere. It scrolls away with the page,
 *  and it never sits over tables or forms (content cards are opaque). */
function Backdrop() {
  const path = usePathname();
  const home = path === "/";
  return (
    <div aria-hidden className={`absolute inset-x-0 top-0 pointer-events-none overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)] ${home ? "h-[780px]" : "h-[420px]"}`}>
      <Mist />
      <Silk />
      <AmbientField density={home ? 1 : 0.6} />
    </div>
  );
}

export function Shell({ counts, index, drawer, children }: { counts: NavCounts; index: IndexItem[]; drawer: ReactNode; children: ReactNode }) {
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <div className="rails no-print" aria-hidden />
      <Backdrop />
      <TopNav counts={counts} onSearch={() => setPalette(true)} />
      <main className="relative z-10">{children}</main>
      <Dock onSearch={() => setPalette(true)} />
      <TabBar counts={counts} />
      <ChatPanel business={counts.electronics ? "electronics" : counts.business} />
      {drawer}
      <CommandPalette open={palette} onClose={() => setPalette(false)} index={index} business={counts.business} />
    </div>
  );
}
