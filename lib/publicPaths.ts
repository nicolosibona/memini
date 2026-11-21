// Pages opened by people outside the app (counterparties, a phone subscribing to the calendar): no app chrome, no toasts.
export const PUBLIC_PREFIXES = ["/s/", "/rfq/", "/c/", "/cal/"];
export const isPublicPath = (path: string) => PUBLIC_PREFIXES.some((p) => path.startsWith(p));
