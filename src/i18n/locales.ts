export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export interface LocaleConfig {
  code: Locale;
  isoCode: string;
  label: string;
  dir: "ltr" | "rtl";
  flag: string;
}

export const LOCALES_REGISTRY: Record<Locale, LocaleConfig> = {
  en: {
    code: "en",
    isoCode: "en-US",
    label: "English",
    dir: "ltr",
    flag: "🇺🇸",
  },
  es: {
    code: "es",
    isoCode: "es-CO",
    label: "Español",
    dir: "ltr",
    flag: "🇨🇴",
  },
};

export const FALLBACK_CHAIN: Record<Locale, Locale[]> = {
  en: ["en"],
  es: ["es", "en"],
};
