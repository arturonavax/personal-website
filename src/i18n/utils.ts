import { getCollection, type CollectionKey } from "astro:content";
import { ui, defaultLang, type Locale, type UIKey } from "./ui";

export function getLocaleFromUrl(url: URL): Locale {
  const [, lang] = url.pathname.split("/");
  if (lang === "es") return "es";
  return defaultLang;
}

export function useTranslations(locale: Locale) {
  return function t(key: UIKey): string {
    return ui[locale][key] ?? ui[defaultLang][key];
  };
}

export async function getCounterpartUrl(
  currentLocale: Locale,
  targetLocale: Locale,
  currentPathname: string,
  collectionName?:
    "posts" | "projects" | "experience" | "services" | "case-studies",
  translationKey?: string,
): Promise<string> {
  if (currentLocale === targetLocale) {
    return currentPathname;
  }

  // If translationKey and collectionName are provided, match the entry
  if (collectionName && translationKey) {
    const entries = await getCollection(collectionName as CollectionKey);
    const targetEntry = entries.find((entry) => {
      const data = entry.data as { locale?: string; translationKey?: string };
      return (
        data.locale === targetLocale && data.translationKey === translationKey
      );
    });

    if (targetEntry) {
      const routeSegment = collectionName === "posts" ? "blog" : collectionName;
      const slug = targetEntry.id.replace(new RegExp(`^${targetLocale}/`), "");
      return targetLocale === "en"
        ? `/${routeSegment}/${slug}`
        : `/es/${routeSegment}/${slug}`;
    }
  }

  // Path mapping fallback
  const cleanPath = currentPathname.replace(/^\/es(\/|$)/, "/");

  if (targetLocale === "es") {
    return cleanPath === "/" ? "/es" : `/es${cleanPath.replace(/\/$/, "")}`;
  }

  return cleanPath === "" ? "/" : cleanPath.replace(/\/$/, "") || "/";
}

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}
