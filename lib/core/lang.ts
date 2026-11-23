// The user's language: what the supplier's Chinese is translated into, and what the user writes is translated from.
// One per workspace (workspaces.reply_language), chosen on the web app (the chip on Today, or Settings).
//   full     the bot's own messages, parameter names, EU warnings and the verification sheet are in this language too
//   others   the AI translates into them; the bot's messages and the parameter names stay in English
import type { DB } from "@/lib/db";

export const LANGS = {
  en: { name: "English", native: "English", flag: "🇬🇧", full: true },
  it: { name: "Italian", native: "Italiano", flag: "🇮🇹", full: true },
  de: { name: "German", native: "Deutsch", flag: "🇩🇪", full: true },
  fr: { name: "French", native: "Français", flag: "🇫🇷", full: true },
  es: { name: "Spanish", native: "Español", flag: "🇪🇸", full: true },
  pt: { name: "Portuguese", native: "Português", flag: "🇵🇹", full: false },
  nl: { name: "Dutch", native: "Nederlands", flag: "🇳🇱", full: false },
  pl: { name: "Polish", native: "Polski", flag: "🇵🇱", full: false },
  sv: { name: "Swedish", native: "Svenska", flag: "🇸🇪", full: false },
  cs: { name: "Czech", native: "Čeština", flag: "🇨🇿", full: false },
  ro: { name: "Romanian", native: "Română", flag: "🇷🇴", full: false },
  tr: { name: "Turkish", native: "Türkçe", flag: "🇹🇷", full: false },
  ru: { name: "Russian", native: "Русский", flag: "🇷🇺", full: false },
  ja: { name: "Japanese", native: "日本語", flag: "🇯🇵", full: false },
  ko: { name: "Korean", native: "한국어", flag: "🇰🇷", full: false },
  vi: { name: "Vietnamese", native: "Tiếng Việt", flag: "🇻🇳", full: false },
} as const;

export type Lang = keyof typeof LANGS;
export type FullLang = "en" | "it" | "de" | "fr" | "es";
export const LANG_CODES = Object.keys(LANGS) as Lang[];
export const FULL_LANGS: FullLang[] = ["en", "it", "de", "fr", "es"];

export const isLang = (x: unknown): x is Lang => typeof x === "string" && x in LANGS;
/** The language the bot's own messages and the sheet use: the user's, or English when it isn't a full one. */
export const uiLang = (l: Lang): FullLang => (LANGS[l].full ? (l as FullLang) : "en");

export function workspaceLang(db: DB, ws: string): Lang {
  const v = (db.prepare(`SELECT reply_language AS l FROM workspaces WHERE id = ?`).get(ws) as { l: string | null } | undefined)?.l;
  return isLang(v) ? v : "en";
}

export function setWorkspaceLang(db: DB, ws: string, lang: Lang) {
  db.prepare(`UPDATE workspaces SET reply_language = ? WHERE id = ?`).run(lang, ws);
}

export const langLabel = (l: Lang) => `${LANGS[l].flag} ${LANGS[l].native}`;

/** For the web pickers. */
export const langOptions = () => LANG_CODES.map((c) => ({ code: c, label: langLabel(c), full: LANGS[c].full }));
