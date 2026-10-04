export const LOCALES = {
  en: { code: "en", label: "English", pathPrefix: "" },
  es: { code: "es", label: "Español", pathPrefix: "es" },
} as const;

export type SupportedLocale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return locale in LOCALES;
}

export function getLocalePaths() {
  return [{ params: { lang: undefined } }, { params: { lang: "es" } }];
}
