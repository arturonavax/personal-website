import { type CollectionKey } from "astro:content";
import { ui, defaultLang, type Locale, type UIKey } from "./ui";
import { getVisibleCollection } from "@/utils/visibility";

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

// src/i18n/utils.ts
export async function getCounterpartUrl(
  currentLocale: Locale,
  targetLocale: Locale,
  currentPathname: string,
  collectionName?:
    "posts" | "projects" | "experience" | "services" | "case-studies",
  translationKey?: string,
): Promise<string | undefined> {
  const ensureTrailingSlash = (path: string) =>
    path.endsWith("/") ? path : `${path}/`;

  if (currentLocale === targetLocale) {
    return ensureTrailingSlash(currentPathname);
  }

  // 1. Coincidencia por translationKey en colecciones
  if (collectionName && translationKey) {
    const entries = await getVisibleCollection(collectionName as CollectionKey);
    const targetEntry = entries.find((entry) => {
      const data = entry.data as { locale?: string; translationKey?: string };
      return (
        data.locale === targetLocale && data.translationKey === translationKey
      );
    });

    if (targetEntry) {
      const routeSegment = collectionName === "posts" ? "blog" : collectionName;
      const slug = targetEntry.id.replace(new RegExp(`^${targetLocale}/`), "");
      // Siempre terminar con slash
      return targetLocale === "en"
        ? `/${routeSegment}/${slug}/`
        : `/es/${routeSegment}/${slug}/`;
    }

    // Si es un contenido específico de colección y no existe traducción, retornar undefined para evitar 404
    return undefined;
  }

  // 2. Fallback de mapeo de rutas
  const withTrailing = ensureTrailingSlash(currentPathname);
  const cleanPath = withTrailing.replace(/^\/es(?:\/|$)/, "/") || "/";

  if (targetLocale === "es") {
    return cleanPath === "/" ? "/es/" : `/es${cleanPath}`;
  }

  return cleanPath;
}

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}
