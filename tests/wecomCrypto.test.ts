import { describe, expect, it } from "vitest";
import { decrypt, encrypt, signature, verifySignature, xmlField } from "@/lib/channels/wecomCrypto";

// Same shape as WeCom's official sample: 43-char EncodingAESKey, CorpID as receiveid.
const AES_KEY = "jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2C";
const TOKEN = "QDG6eK";
const CORP = "wx5823bf96d3bd56c7";

describe("wecom crypto", () => {
  it("round-trips a message and keeps the receive id", () => {
    const xml = "<xml><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[kf_msg_or_event]]></Event><Token><![CDATA[ENCApHxnGDNAVNY4AaSJKj4Tb5mwsEMzxhFmHVGcra996NR]]></Token></xml>";
    const enc = encrypt(AES_KEY, xml, CORP);
    const dec = decrypt(AES_KEY, enc);
    expect(dec).toEqual({ message: xml, receiveId: CORP });
    expect(xmlField(dec.message, "Event")).toBe("kf_msg_or_event");
  });

  it("is deterministic for a fixed random prefix and pads to 32-byte blocks", () => {
    const r = Buffer.alloc(16, 7);
    const a = encrypt(AES_KEY, "hello", CORP, r);
    expect(a).toBe(encrypt(AES_KEY, "hello", CORP, r));
    expect(Buffer.from(a, "base64").length % 32).toBe(0);
  });

  it("handles Chinese text and exact-block lengths", () => {
    for (const msg of ["深圳市ABC科技有限公司", "x".repeat(32 - 20 - CORP.length + 32)]) expect(decrypt(AES_KEY, encrypt(AES_KEY, msg, CORP)).message).toBe(msg);
  });

  it("signature is sha1 of the sorted parts", () => {
    // sha1("1409659813" + "263014780" + "QDG6eK" + "abc") with lexicographic sort
    const sig = signature(TOKEN, "1409659813", "263014780", "abc");
    expect(sig).toMatch(/^[0-9a-f]{40}$/);
    expect(verifySignature(TOKEN, "1409659813", "263014780", "abc", sig)).toBe(true);
    expect(verifySignature(TOKEN, "1409659813", "263014780", "abd", sig)).toBe(false);
  });

  it("reads plain and CDATA xml fields", () => {
    const x = "<xml><ToUserName><![CDATA[ww123]]></ToUserName><AgentID>1000002</AgentID><Encrypt><![CDATA[a+b/c==]]></Encrypt></xml>";
    expect(xmlField(x, "Encrypt")).toBe("a+b/c==");
    expect(xmlField(x, "AgentID")).toBe("1000002");
    expect(xmlField(x, "Missing")).toBeNull();
  });
});
