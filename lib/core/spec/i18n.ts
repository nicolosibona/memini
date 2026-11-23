// What the spec-check bot says, and the verification sheet's headings, in the five full languages (lib/core/lang.ts).
// The supplier always gets Chinese; the user gets their language. Numbers and units are never translated here:
// they come from the table.
import { uiLang, type FullLang, type Lang } from "../lang";
import type { Row, Status } from "./compare";
import { componentLabel, paramLabel } from "./params";

type Strings = {
  welcome: (lang: string) => string;
  you: string; supplier: string; values: (n: number) => string;
  kept: string; byHand: string; soFar: string; euWarnings: (n: number) => string;
  sheetPrompt: string; newCheckButton: string;
  movedToYours: string; movedToSupplier: string; itemGone: string; inactive: string;
  noTech: string; nothingYet: string; newCheck: string;
  mismatchLine: (label: string, req: string, sup: string, was: string | null) => string;
  mismatches: (n: number) => string; toConfirm: string; notStated: string; okCount: (n: number) => string;
  onlyYours: string; onlySupplier: string; euHeader: string;
  forwardSheet: string; tapCopy: string; copyLabel: string;
  thanks: string; ack: string; notTechnical: string;
  status: Record<Status, string>;
  sheet: { title: string; subtitle: string; tab: string; columns: [string, string, string, string, string, string]; choices: [string, string, string]; euHeader: string; notGiven: string };
};

const EN: Strings = {
  welcome: (lang) => `👋 I'm Memini, your electronics spec checker.\n\nForward me your messages with the supplier, your spec and their datasheets (PDF, photo or text). I translate every technical line between ${lang} and Chinese — numbers, units and limits verified — and check what they say against what you asked.\n\nWrite "excel" when you want the verification sheet for the supplier.\n/new starts a new check · language: Settings in the web app`,
  you: "You", supplier: "Supplier", values: (n) => `${n} values`,
  kept: "✓ numbers, units and limits kept", byHand: "⚠️ some numbers to check by hand", soFar: "So far",
  euWarnings: (n) => `${n} EU warning${n > 1 ? "s" : ""}`,
  sheetPrompt: "Write excel (or tap 📊) for the verification sheet:", newCheckButton: "🆕 New check",
  movedToYours: "↔️ Moved to your side.", movedToSupplier: "↔️ Moved to the supplier's side.",
  itemGone: "I can't find that item any more.", inactive: "That button is no longer active.",
  noTech: "I couldn't find any technical content in that. Forward a spec, a datasheet or a message with values.",
  nothingYet: "Nothing to check yet. Forward your messages with the supplier, your spec or their datasheet first.",
  newCheck: "🆕 New spec check. Forward your messages with the supplier, your spec and their datasheets.",
  mismatchLine: (label, req, sup, was) => `${label}: you ${req} → supplier ${sup}${was ? ` (was ${was})` : ""}`,
  mismatches: (n) => `🔴 ${n} MISMATCH${n > 1 ? "ES" : ""}`, toConfirm: "🟡 To confirm: ", notStated: "⚠️ Not stated: ", okCount: (n) => `✅ ${n} OK`,
  onlyYours: "Only your side so far: the sheet asks the supplier to fill in their values.",
  onlySupplier: "Only the supplier's side so far: add your requirements to compare.",
  euHeader: "🇪🇺 EU compliance — might not pass:",
  forwardSheet: "💬 Forward the sheet to the supplier. Tap 📋 for the Chinese message to send with it:",
  tapCopy: "Tap 📋 for the Chinese message:", copyLabel: "📋 Chinese only",
  thanks: "🙏 You're welcome. Forward more from the supplier any time, or write excel for the verification sheet.",
  ack: "👍 Forward more from the supplier any time, or write excel for the verification sheet.",
  notTechnical: "I didn't find any technical value in that, so I left your spec check as it is.\n\n• Forward the supplier's messages, datasheets or photos, or type your requirement with its value (\"ripple ≤ 100 mV\")\n• Save a date: \"I have a meeting with the supplier on Dec 15 at 3pm\"\n• Write \"excel\" for the verification sheet",
  status: { ok: "OK", mismatch: "Mismatch", missing: "Not stated", check: "To confirm", info: "Info" },
  sheet: { title: "Spec check", subtitle: "Please confirm each line in the last column", tab: "Check", columns: ["Parameter", "Our spec", "Supplier", "Result", "Note", "Confirm"], choices: ["OK", "Will change", "Cannot meet"], euHeader: "EU compliance — might not pass", notGiven: "Not stated" },
};

const IT: Strings = {
  welcome: (lang) => `👋 Sono Memini, il tuo controllore di specifiche per l'elettronica.\n\nInoltrami i messaggi con il fornitore, la tua specifica e le loro schede tecniche (PDF, foto o testo). Traduco ogni riga tecnica tra ${lang.toLowerCase()} e cinese, verificando numeri, unità e limiti, e controllo quello che dicono rispetto a quello che hai chiesto.\n\nScrivi "excel" quando vuoi il foglio di verifica per il fornitore.\n/new avvia un nuovo controllo · lingua: Impostazioni nel sito`,
  you: "Tu", supplier: "Fornitore", values: (n) => `${n} valori`,
  kept: "✓ numeri, unità e limiti conservati", byHand: "⚠️ alcuni numeri da controllare a mano", soFar: "Finora",
  euWarnings: (n) => (n > 1 ? `${n} avvisi UE` : "1 avviso UE"),
  sheetPrompt: "Scrivi excel (o tocca 📊) per il foglio di verifica:", newCheckButton: "🆕 Nuovo controllo",
  movedToYours: "↔️ Spostato dalla tua parte.", movedToSupplier: "↔️ Spostato dalla parte del fornitore.",
  itemGone: "Non trovo più quell'elemento.", inactive: "Quel pulsante non è più attivo.",
  noTech: "Non ho trovato contenuto tecnico. Inoltra una specifica, una scheda tecnica o un messaggio con dei valori.",
  nothingYet: "Ancora niente da controllare. Inoltra prima i messaggi con il fornitore, la tua specifica o la loro scheda tecnica.",
  newCheck: "🆕 Nuovo controllo specifiche. Inoltra i messaggi con il fornitore, la tua specifica e le loro schede tecniche.",
  mismatchLine: (label, req, sup, was) => `${label}: tu ${req} → fornitore ${sup}${was ? ` (era ${was})` : ""}`,
  mismatches: (n) => (n > 1 ? `🔴 ${n} NON CONFORMI` : "🔴 1 NON CONFORME"), toConfirm: "🟡 Da confermare: ", notStated: "⚠️ Non indicati: ", okCount: (n) => `✅ ${n} OK`,
  onlyYours: "Per ora c'è solo la tua parte: il foglio chiede al fornitore di inserire i suoi valori.",
  onlySupplier: "Per ora c'è solo la parte del fornitore: aggiungi i tuoi requisiti per il confronto.",
  euHeader: "🇪🇺 Conformità UE — potrebbe non passare:",
  forwardSheet: "💬 Inoltra il foglio al fornitore. Tocca 📋 per il messaggio in cinese da mandare insieme:",
  tapCopy: "Tocca 📋 per il messaggio in cinese:", copyLabel: "📋 Solo cinese",
  thanks: "🙏 Prego! Inoltrami altro dal fornitore quando vuoi, o scrivi excel per il foglio di verifica.",
  ack: "👍 Inoltrami altro dal fornitore quando vuoi, o scrivi excel per il foglio di verifica.",
  notTechnical: "Non ho trovato valori tecnici, quindi ho lasciato il controllo com'era.\n\n• Inoltra messaggi, schede tecniche o foto del fornitore, oppure scrivi un requisito con il suo valore (\"ripple ≤ 100 mV\")\n• Salva una data: \"Ho una riunione con il fornitore il 15 dicembre alle 15\"\n• Scrivi \"excel\" per il foglio di verifica",
  status: { ok: "OK", mismatch: "Non conforme", missing: "Non indicato", check: "Da confermare", info: "Info" },
  sheet: { title: "Verifica specifiche", subtitle: "Conferma ogni riga nell'ultima colonna", tab: "Verifica", columns: ["Parametro", "Nostra specifica", "Fornitore", "Esito", "Nota", "Conferma"], choices: ["OK", "Da modificare", "Non realizzabile"], euHeader: "Conformità UE — potrebbe non passare", notGiven: "Non indicato" },
};

const DE: Strings = {
  welcome: () => "👋 Ich bin Memini, Ihr Spezifikationsprüfer für Elektronik.\n\nLeiten Sie mir Ihre Nachrichten mit dem Lieferanten, Ihre Spezifikation und dessen Datenblätter weiter (PDF, Foto oder Text). Ich übersetze jede technische Zeile zwischen Deutsch und Chinesisch, mit geprüften Zahlen, Einheiten und Grenzwerten, und vergleiche die Angaben mit Ihren Anforderungen.\n\nSchreiben Sie \"excel\", wenn Sie das Prüfblatt für den Lieferanten möchten.\n/new startet eine neue Prüfung · Sprache: Einstellungen in der Web-App",
  you: "Sie", supplier: "Lieferant", values: (n) => `${n} Werte`,
  kept: "✓ Zahlen, Einheiten und Grenzwerte erhalten", byHand: "⚠️ einige Zahlen von Hand prüfen", soFar: "Bisher",
  euWarnings: (n) => (n > 1 ? `${n} EU-Hinweise` : "1 EU-Hinweis"),
  sheetPrompt: "Schreiben Sie excel (oder tippen Sie 📊) für das Prüfblatt:", newCheckButton: "🆕 Neue Prüfung",
  movedToYours: "↔️ Auf Ihre Seite verschoben.", movedToSupplier: "↔️ Auf die Seite des Lieferanten verschoben.",
  itemGone: "Dieses Element finde ich nicht mehr.", inactive: "Diese Schaltfläche ist nicht mehr aktiv.",
  noTech: "Ich habe keinen technischen Inhalt gefunden. Leiten Sie eine Spezifikation, ein Datenblatt oder eine Nachricht mit Werten weiter.",
  nothingYet: "Noch nichts zu prüfen. Leiten Sie zuerst Ihre Nachrichten mit dem Lieferanten, Ihre Spezifikation oder sein Datenblatt weiter.",
  newCheck: "🆕 Neue Spezifikationsprüfung. Leiten Sie Ihre Nachrichten mit dem Lieferanten, Ihre Spezifikation und dessen Datenblätter weiter.",
  mismatchLine: (label, req, sup, was) => `${label}: Sie ${req} → Lieferant ${sup}${was ? ` (vorher ${was})` : ""}`,
  mismatches: (n) => (n > 1 ? `🔴 ${n} ABWEICHUNGEN` : "🔴 1 ABWEICHUNG"), toConfirm: "🟡 Zu bestätigen: ", notStated: "⚠️ Nicht angegeben: ", okCount: (n) => `✅ ${n} OK`,
  onlyYours: "Bisher nur Ihre Seite: Das Blatt bittet den Lieferanten, seine Werte einzutragen.",
  onlySupplier: "Bisher nur die Seite des Lieferanten: Fügen Sie Ihre Anforderungen hinzu, um zu vergleichen.",
  euHeader: "🇪🇺 EU-Konformität — könnte durchfallen:",
  forwardSheet: "💬 Leiten Sie das Blatt an den Lieferanten weiter. Tippen Sie 📋 für die chinesische Nachricht dazu:",
  tapCopy: "Tippen Sie 📋 für die chinesische Nachricht:", copyLabel: "📋 Nur Chinesisch",
  thanks: "🙏 Gern geschehen. Leiten Sie jederzeit mehr vom Lieferanten weiter oder schreiben Sie excel für das Prüfblatt.",
  ack: "👍 Leiten Sie jederzeit mehr vom Lieferanten weiter oder schreiben Sie excel für das Prüfblatt.",
  notTechnical: "Ich habe darin keinen technischen Wert gefunden und Ihre Prüfung unverändert gelassen.\n\n• Leiten Sie Nachrichten, Datenblätter oder Fotos des Lieferanten weiter oder schreiben Sie eine Anforderung mit Wert (\"Restwelligkeit ≤ 100 mV\")\n• Schreiben Sie \"excel\" für das Prüfblatt",
  status: { ok: "OK", mismatch: "Abweichung", missing: "Nicht angegeben", check: "Zu bestätigen", info: "Info" },
  sheet: { title: "Spezifikationsprüfung", subtitle: "Bitte bestätigen Sie jede Zeile in der letzten Spalte", tab: "Prüfung", columns: ["Parameter", "Unsere Spezifikation", "Lieferant", "Ergebnis", "Hinweis", "Bestätigung"], choices: ["OK", "Wird geändert", "Nicht erfüllbar"], euHeader: "EU-Konformität — könnte durchfallen", notGiven: "Nicht angegeben" },
};

const FR: Strings = {
  welcome: () => "👋 Je suis Memini, votre vérificateur de spécifications électroniques.\n\nTransférez-moi vos messages avec le fournisseur, votre cahier des charges et ses fiches techniques (PDF, photo ou texte). Je traduis chaque ligne technique entre le français et le chinois, en vérifiant chiffres, unités et limites, et je compare ses réponses à vos exigences.\n\nÉcrivez \"excel\" quand vous voulez la fiche de vérification pour le fournisseur.\n/new lance une nouvelle vérification · langue : Paramètres de l'application web",
  you: "Vous", supplier: "Fournisseur", values: (n) => `${n} valeurs`,
  kept: "✓ chiffres, unités et limites conservés", byHand: "⚠️ quelques chiffres à vérifier à la main", soFar: "Pour l'instant",
  euWarnings: (n) => (n > 1 ? `${n} alertes UE` : "1 alerte UE"),
  sheetPrompt: "Écrivez excel (ou touchez 📊) pour la fiche de vérification :", newCheckButton: "🆕 Nouvelle vérification",
  movedToYours: "↔️ Déplacé de votre côté.", movedToSupplier: "↔️ Déplacé du côté du fournisseur.",
  itemGone: "Je ne trouve plus cet élément.", inactive: "Ce bouton n'est plus actif.",
  noTech: "Je n'ai trouvé aucun contenu technique. Transférez une spécification, une fiche technique ou un message avec des valeurs.",
  nothingYet: "Rien à vérifier pour l'instant. Transférez d'abord vos messages avec le fournisseur, votre cahier des charges ou sa fiche technique.",
  newCheck: "🆕 Nouvelle vérification. Transférez vos messages avec le fournisseur, votre cahier des charges et ses fiches techniques.",
  mismatchLine: (label, req, sup, was) => `${label} : vous ${req} → fournisseur ${sup}${was ? ` (avant ${was})` : ""}`,
  mismatches: (n) => (n > 1 ? `🔴 ${n} NON-CONFORMITÉS` : "🔴 1 NON-CONFORMITÉ"), toConfirm: "🟡 À confirmer : ", notStated: "⚠️ Non indiqué : ", okCount: (n) => `✅ ${n} OK`,
  onlyYours: "Seulement votre côté pour l'instant : la fiche demande au fournisseur d'indiquer ses valeurs.",
  onlySupplier: "Seulement le côté du fournisseur pour l'instant : ajoutez vos exigences pour comparer.",
  euHeader: "🇪🇺 Conformité UE — risque de non-conformité :",
  forwardSheet: "💬 Transférez la fiche au fournisseur. Touchez 📋 pour le message en chinois à joindre :",
  tapCopy: "Touchez 📋 pour le message en chinois :", copyLabel: "📋 Chinois seul",
  thanks: "🙏 Avec plaisir. Transférez d'autres messages du fournisseur quand vous voulez, ou écrivez excel pour la fiche de vérification.",
  ack: "👍 Transférez d'autres messages du fournisseur quand vous voulez, ou écrivez excel pour la fiche de vérification.",
  notTechnical: "Je n'y ai trouvé aucune valeur technique, votre vérification n'a donc pas changé.\n\n• Transférez des messages, fiches techniques ou photos du fournisseur, ou écrivez une exigence avec sa valeur (\"ondulation ≤ 100 mV\")\n• Écrivez \"excel\" pour la fiche de vérification",
  status: { ok: "OK", mismatch: "Non conforme", missing: "Non indiqué", check: "À confirmer", info: "Info" },
  sheet: { title: "Vérification des spécifications", subtitle: "Merci de confirmer chaque ligne dans la dernière colonne", tab: "Vérification", columns: ["Paramètre", "Notre spécification", "Fournisseur", "Résultat", "Remarque", "Confirmation"], choices: ["OK", "Sera modifié", "Impossible"], euHeader: "Conformité UE — risque de non-conformité", notGiven: "Non indiqué" },
};

const ES: Strings = {
  welcome: () => "👋 Soy Memini, tu verificador de especificaciones electrónicas.\n\nReenvíame tus mensajes con el proveedor, tu especificación y sus hojas de datos (PDF, foto o texto). Traduzco cada línea técnica entre español y chino, verificando números, unidades y límites, y comparo lo que dicen con lo que pediste.\n\nEscribe \"excel\" cuando quieras la hoja de verificación para el proveedor.\n/new inicia una nueva verificación · idioma: Ajustes en la web",
  you: "Tú", supplier: "Proveedor", values: (n) => `${n} valores`,
  kept: "✓ números, unidades y límites conservados", byHand: "⚠️ algunos números para revisar a mano", soFar: "Hasta ahora",
  euWarnings: (n) => (n > 1 ? `${n} avisos UE` : "1 aviso UE"),
  sheetPrompt: "Escribe excel (o toca 📊) para la hoja de verificación:", newCheckButton: "🆕 Nueva verificación",
  movedToYours: "↔️ Movido a tu lado.", movedToSupplier: "↔️ Movido al lado del proveedor.",
  itemGone: "Ya no encuentro ese elemento.", inactive: "Ese botón ya no está activo.",
  noTech: "No encontré contenido técnico. Reenvía una especificación, una hoja de datos o un mensaje con valores.",
  nothingYet: "Todavía no hay nada que verificar. Reenvía primero tus mensajes con el proveedor, tu especificación o su hoja de datos.",
  newCheck: "🆕 Nueva verificación. Reenvía tus mensajes con el proveedor, tu especificación y sus hojas de datos.",
  mismatchLine: (label, req, sup, was) => `${label}: tú ${req} → proveedor ${sup}${was ? ` (antes ${was})` : ""}`,
  mismatches: (n) => (n > 1 ? `🔴 ${n} NO CONFORMIDADES` : "🔴 1 NO CONFORMIDAD"), toConfirm: "🟡 Por confirmar: ", notStated: "⚠️ No indicado: ", okCount: (n) => `✅ ${n} OK`,
  onlyYours: "Por ahora solo tu lado: la hoja pide al proveedor que complete sus valores.",
  onlySupplier: "Por ahora solo el lado del proveedor: añade tus requisitos para comparar.",
  euHeader: "🇪🇺 Conformidad UE — podría no cumplir:",
  forwardSheet: "💬 Reenvía la hoja al proveedor. Toca 📋 para el mensaje en chino que va con ella:",
  tapCopy: "Toca 📋 para el mensaje en chino:", copyLabel: "📋 Solo chino",
  thanks: "🙏 De nada. Reenvíame más del proveedor cuando quieras, o escribe excel para la hoja de verificación.",
  ack: "👍 Reenvíame más del proveedor cuando quieras, o escribe excel para la hoja de verificación.",
  notTechnical: "No encontré ningún valor técnico, así que dejé tu verificación como estaba.\n\n• Reenvía mensajes, hojas de datos o fotos del proveedor, o escribe un requisito con su valor (\"rizado ≤ 100 mV\")\n• Escribe \"excel\" para la hoja de verificación",
  status: { ok: "OK", mismatch: "No conforme", missing: "No indicado", check: "Por confirmar", info: "Info" },
  sheet: { title: "Verificación de especificaciones", subtitle: "Confirme cada línea en la última columna", tab: "Verificación", columns: ["Parámetro", "Nuestra especificación", "Proveedor", "Resultado", "Nota", "Confirmación"], choices: ["OK", "Se modificará", "No se puede cumplir"], euHeader: "Conformidad UE — podría no cumplir", notGiven: "No indicado" },
};

const STRINGS: Record<FullLang, Strings> = { en: EN, it: IT, de: DE, fr: FR, es: ES };
export const S = (l: FullLang): Strings => STRINGS[l];

/** A row's name in the user's language: "Condensatore di uscita – tensione nominale". */
export function rowLabel(r: Pick<Row, "key" | "component" | "label_en">, lang: Lang): string {
  const ul = uiLang(lang);
  if (r.key === "other" || ul === "en") return r.label_en;
  const name = paramLabel(r.key, ul);
  if (!r.component) return name;
  return `${componentLabel(r.component, ul)} – ${ul === "de" ? name : name.charAt(0).toLowerCase() + name.slice(1)}`;
}
