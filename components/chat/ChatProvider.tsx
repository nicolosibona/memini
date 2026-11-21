"use client";
// One conversation for the whole workspace. Home shows it inline (a calm split with Today beside it);
// every other page opens it as a slide-over from the dock. Same NDJSON stream (/api/chat) as before.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { OutgoingReply } from "@/lib/core/reply";
import { Icon } from "../Icon";

export type Turn =
  | { role: "user"; text: string; files?: string[] }
  | { role: "bot"; replies: OutgoingReply[]; ms?: number }
  | { role: "error"; text: string };

const STORE = "memini-home-chat-v1";
export const MAX_MB = 20;
const load = (): Turn[] => { try { return JSON.parse(localStorage.getItem(STORE) ?? "[]"); } catch { return []; } };
const save = (t: Turn[]) => { try { localStorage.setItem(STORE, JSON.stringify(t.slice(-60))); } catch { /* private mode */ } };

type Chat = {
  turns: Turn[]; busy: boolean; text: string; setText: (s: string) => void;
  files: File[]; addFiles: (l: File[]) => void; removeFile: (i: number) => void; hint: string | null;
  send: (q?: string) => Promise<void>; tap: (id: string, label: string) => Promise<void>; newChat: () => void;
  focusTick: number; requestFocus: () => void; minimized: boolean; setMinimized: (b: boolean) => void; panel: boolean; setPanel: (b: boolean) => void;
};
const Ctx = createContext<Chat | null>(null);
export const useChat = () => { const c = useContext(Ctx); if (!c) throw new Error("useChat outside ChatProvider"); return c; };

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

export function ChatProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [panel, setPanel] = useState(false);
  const [over, setOver] = useState(false);
  const loaded = useRef(false);
  const onHome = path === "/";
  const requestFocus = useCallback(() => setFocusTick((n) => n + 1), []);

  useEffect(() => { setTurns(load()); loaded.current = true; }, []);
  useEffect(() => { if (loaded.current) save(turns); }, [turns]);
  useEffect(() => { if (onHome) setPanel(false); }, [onHome]);

  const addFiles = useCallback((list: File[]) => {
    const big = list.filter((f) => f.size > MAX_MB * 1048576);
    setHint(big.length ? `${big.map((f) => f.name).join(", ")}: larger than ${MAX_MB} MB` : null);
    setFiles((f) => [...f, ...list.filter((x) => x.size <= MAX_MB * 1048576)]);
  }, []);

  // a file dragged anywhere over the window: the light gathers, and a drop lands in the composer
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const set = (on: boolean) => { setOver(on); emit("memini:drag", { on }); };
    const enter = (e: DragEvent) => { if (has(e)) { depth++; set(true); } };
    const overH = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (has(e) && --depth <= 0) { depth = 0; set(false); } };
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault(); depth = 0; set(false);
      addFiles(Array.from(e.dataTransfer?.files ?? []));
      if (onHome) requestFocus(); else setPanel(true);
    };
    window.addEventListener("dragenter", enter); window.addEventListener("dragover", overH);
    window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", overH); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  }, [addFiles, onHome, requestFocus]);

  const post = useCallback(async (body: FormData | { text?: string; menuId?: string }) => {
    setBusy(true);
    try {
      const r = body instanceof FormData
        ? await fetch("/api/chat", { method: "POST", body })
        : await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(j.error ?? r.statusText);
      }
      // NDJSON stream: each reply appears as soon as it's ready (the translation first), in one bot turn
      let started = false;
      const addReply = (reply: OutgoingReply) => setTurns((t) => {
        if (!started) { started = true; return [...t, { role: "bot", replies: [reply] }]; }
        const last = t[t.length - 1];
        return last?.role === "bot" ? [...t.slice(0, -1), { ...last, replies: [...last.replies, reply] }] : [...t, { role: "bot", replies: [reply] }];
      });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: "reply"; reply: OutgoingReply } | { type: "done"; ms: number } | { type: "error"; error: string };
          if (ev.type === "reply") addReply(ev.reply);
          else if (ev.type === "error") throw new Error(ev.error);
          else setTurns((t) => {
            const last = t[t.length - 1];
            return last?.role === "bot" && started ? [...t.slice(0, -1), { ...last, ms: ev.ms }] : [...t, { role: "bot", replies: [], ms: ev.ms }];
          });
        }
        if (done) break;
      }
      router.refresh();
    } catch (e) {
      setTurns((t) => [...t, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally { setBusy(false); }
  }, [router]);

  const open = useCallback(() => { if (onHome) setMinimized(false); else setPanel(true); }, [onHome]);

  const send = useCallback(async (q?: string) => {
    const msg = (q ?? text).trim();
    if (busy || (!msg && !files.length)) return;
    const sent = files;
    open();
    setTurns((t) => [...t, { role: "user", text: msg, files: sent.map((f) => f.name) }]);
    setText(""); setFiles([]); setHint(null);
    if (sent.length) {
      const form = new FormData();
      sent.forEach((f) => form.append("files", f));
      if (msg) form.set("text", msg);
      await post(form);
    } else await post({ text: msg });
  }, [busy, files, open, post, text]);

  const tap = useCallback(async (id: string, label: string) => {
    setTurns((t) => [...t, { role: "user", text: label }]);
    await post({ menuId: id, text: label });
  }, [post]);

  const newChat = useCallback(() => { setTurns([]); setText(""); setFiles([]); setHint(null); setMinimized(false); }, []);
  const value = useMemo<Chat>(() => ({
    turns, busy, text, setText, files, addFiles, removeFile: (i) => setFiles((f) => f.filter((_, j) => j !== i)), hint,
    send, tap, newChat, focusTick, requestFocus, minimized, setMinimized, panel, setPanel,
  }), [turns, busy, text, files, addFiles, hint, send, tap, newChat, focusTick, requestFocus, minimized, panel]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {over && (
        <div className="no-print pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-paper/70 backdrop-blur-[3px] fade-in">
          <div className="rounded-[32px] border border-dashed border-ink/30 bg-card/90 px-12 py-9 text-center shadow-float">
            <Icon name="upload" className="size-7 text-brand mx-auto" />
            <div className="mt-3 text-[17px] font-medium tracking-[-0.01em]">Drop to give it to Memini</div>
            <div className="text-[13px] text-muted mt-1">Licenses, contracts, invoices, photos · up to {MAX_MB} MB each</div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
