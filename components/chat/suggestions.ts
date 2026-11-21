// Pure helpers shared by the chat surfaces (no server imports, so client components can use them).
// `scope` is the workspace profile: true = doing business in China, false = sourcing, "electronics" = spec check.
export type SuggestionScope = boolean | "electronics";

export const suggestionsFor = (scope: SuggestionScope) =>
  scope === "electronics"
    ? ["Check the supplier's datasheet against my spec", "Translate this chat. Keep every unit exact.", "Ask for 5% off at 10k pcs, in Chinese", "Send the supplier a bilingual verification sheet"]
    : scope
      ? ["What's due this month?", "Any problems with my lease before I pay?", "Is Seller 1 or Seller 2 the better deal?", "What did Lisa promise me?"]
      : ["Is Seller 1 or Seller 2 the better deal?", "Any open issues with ABC before I pay?", "What did Lisa promise me?", "Draft a follow-up in Chinese to Seller 1"];
