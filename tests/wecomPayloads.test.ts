// How replies become WeChat (微信客服) messages: menus keep their question right above the choices.
import { describe, expect, it } from "vitest";

process.env.LLM_PROVIDER = "mock";
const { toWecomPayloads } = await import("@/lib/channels/wecom");

type Menu = { msgtype: "msgmenu"; msgmenu: { head_content: string; list: { click: { id: string; content: string } }[]; tail_content: string } };
const buttons = [{ id: "ent:a", label: "🏭 Seller 1 (likely)" }, { id: "ent:skip", label: "🚫 Don't save, just translate" }];

describe("WeChat payloads", () => {
  it("a short menu is one message: text and choices", () => {
    const [m] = toWecomPayloads({ kind: "menu", text: "Who is this from?", prompt: "Who is this from?", buttons }) as Menu[];
    expect(m.msgtype).toBe("msgmenu");
    expect(m.msgmenu.head_content).toBe("Who is this from?");
    expect(m.msgmenu.list.map((x) => x.click.id)).toEqual(["ent:a", "ent:skip"]);
    expect(m.msgmenu.tail_content).toBe("");
  });

  it("menu labels stay within 128 bytes, whole characters, no variation selectors", () => {
    const [m] = toWecomPayloads({ kind: "menu", text: "Who?", buttons: [{ id: "ent:x", label: `🏛️ ${"上海市静安区税务局".repeat(10)}` }] }) as Menu[];
    const c = m.msgmenu.list[0].click.content;
    expect(Buffer.byteLength(c)).toBeLessThanOrEqual(128);
    expect(c).not.toMatch(/\uFE0F/);
    expect(c.startsWith("🏛 上海市")).toBe(true);
  });

  it("a long reply: the text first, then the question alone above the choices (not repeated in the text)", () => {
    const prompt = "I received 1 message, but I can't find the company name.\nWho is this from?";
    const text = `🇬🇧 ${"A long translation. ".repeat(80)}\n\n${prompt}`;
    const out = toWecomPayloads({ kind: "menu", text, prompt, buttons }) as (Menu | { msgtype: "text"; text: { content: string } })[];
    const last = out[out.length - 1] as Menu;
    expect(last.msgtype).toBe("msgmenu");
    expect(last.msgmenu.head_content).toBe(prompt);
    const body = out.slice(0, -1).map((p) => (p as { text: { content: string } }).text.content).join("");
    expect(body).not.toContain("Who is this from?");
  });
});
