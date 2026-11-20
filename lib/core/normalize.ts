// Deterministic normalization (blueprint §5.3). Pure functions, unit-tested.

// ── Unified social credit code (统一社会信用代码), GB 32100-2015 ──
const CODE_CHARS = "0123456789ABCDEFGHJKLMNPQRTUWXY"; // 31 chars: no I, O, Z, S, V
const CODE_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

export function normalizeCreditCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[\s\-‐–—_.·]/g, "");
  return s.length ? s : null;
}

/** Expected 18th character for the first 17, or null if they contain invalid characters. */
export function creditCodeCheckChar(first17: string): string | null {
  if (first17.length !== 17) return null;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const v = CODE_CHARS.indexOf(first17[i]);
    if (v < 0) return null;
    sum += v * CODE_WEIGHTS[i];
  }
  const c = (31 - (sum % 31)) % 31;
  return CODE_CHARS[c];
}

export type CreditCodeCheck = { normalized: string | null; valid: boolean; reason?: "length" | "charset" | "check_digit" };

export function checkCreditCode(raw: string | null | undefined): CreditCodeCheck {
  const n = normalizeCreditCode(raw);
  if (!n) return { normalized: null, valid: false, reason: "length" };
  if (n.length !== 18) return { normalized: n, valid: false, reason: "length" };
  if ([...n].some((ch) => !CODE_CHARS.includes(ch))) return { normalized: n, valid: false, reason: "charset" };
  const expected = creditCodeCheckChar(n.slice(0, 17));
  return expected === n[17] ? { normalized: n, valid: true } : { normalized: n, valid: false, reason: "check_digit" };
}

// ── Company names ──
const ZH_SUFFIXES = ["股份有限公司", "有限责任公司", "有限公司", "集团公司", "公司", "厂", "商行", "经营部"];
const EN_SUFFIXES = [
  "company limited", "co., ltd.", "co.,ltd.", "co. ltd.", "co ltd", "co.,ltd", "co., ltd", "limited", "ltd.", "ltd",
  "inc.", "inc", "corporation", "corp.", "corp", "llc", "company", "co.", "co",
];

/**
 * Canonical key for comparing company names:
 * 深圳市ABC科技有限公司 → 深圳abc科技 ; "Shenzhen ABC Tech Co., Ltd." → shenzhenabctech
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.normalize("NFKC").toLowerCase().trim();
  // brackets around a city, e.g. 鑫达贸易（深圳）有限公司
  s = s.replace(/[（(]([^）)]*)[）)]/g, "$1");
  for (let changed = true; changed; ) {
    changed = false;
    for (const suf of [...ZH_SUFFIXES, ...EN_SUFFIXES]) {
      const t = s.replace(/[\s,.]+$/, "");
      const isEn = /^[a-z]/.test(suf);
      // English suffixes only as whole words ("Disco" must not lose "co")
      if (t.endsWith(suf) && t.length > suf.length && (!isEn || /[\s,.]/.test(t[t.length - suf.length - 1]))) {
        s = t.slice(0, -suf.length);
        changed = true;
      }
    }
  }
  s = s.replace(/^(.{2,3}?)[市省]/, "$1"); // 深圳市 → 深圳, 浙江省 → 浙江
  s = s.replace(/[\s\p{P}\p{S}]/gu, "");
  return s;
}

/** Loose similarity for "partly matches" (§5.6): containment or high bigram overlap. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const grams = (s: string) => new Set(Array.from({ length: Math.max(s.length - 1, 1) }, (_, i) => s.slice(i, i + 2)));
  const gx = grams(x), gy = grams(y);
  let inter = 0;
  for (const g of gx) if (gy.has(g)) inter++;
  return (2 * inter) / (gx.size + gy.size);
}

/** Beneficiary looks like a private person: 2–4 Chinese characters, no company word (§7.1 PERSONAL_ACCOUNT). */
export function looksLikePerson(name: string | null | undefined): boolean {
  if (!name) return false;
  const s = name.replace(/\s/g, "");
  if (/^[一-鿿]{2,4}$/.test(s) && !/公司|厂|行|部|社/.test(s)) return true;
  // Pinyin personal names on a bank slip, e.g. "ZHANG WEI" — two or three short words, no company word
  return /^[A-Za-z]+( [A-Za-z]+){1,2}$/.test(name.trim()) && !/co|ltd|limited|trading|tech|company|inc/i.test(name);
}

export function isChinese(text: string): boolean {
  const han = (text.match(/[一-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return han > 0 && han * 2 >= latin;
}
