import type { Locale } from "@/i18n/ui";

export const BASE_ORIGIN = "https://arturonavax.dev";

export interface AttributionParams {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
}

export interface PlatformPlacement {
  id: string;
  label: string;
  medium: string;
  campaign: string;
}

export interface PlatformConfig {
  id: string;
  name: string;
  source: string;
  placements: PlatformPlacement[];
}

export function detectLocale(pathOrUrl: string): Locale {
  try {
    const pathname = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl).pathname
      : pathOrUrl;
    return pathname === "/es" || pathname.startsWith("/es/") ? "es" : "en";
  } catch {
    return "en";
  }
}

export function generateRandomId(prefix: string = "ref"): string {
  const cleanPrefix = prefix.trim() || "ref";
  const hash = Math.random().toString(36).substring(2, 8);
  return `${cleanPrefix}-${hash}`;
}

export function buildAttributionUrl(
  targetPathOrUrl: string,
  params: AttributionParams = {},
  baseOrigin: string = BASE_ORIGIN,
): string {
  const raw = (targetPathOrUrl || "").trim() || "/";
  let url: URL;

  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      url = new URL(raw);
    } else {
      const normalizedPath = raw.startsWith("/") ? raw : `/${raw}`;
      url = new URL(normalizedPath, baseOrigin);
    }
  } catch {
    url = new URL("/", baseOrigin);
  }

  // Normalización estricta: asegurar '/' al final del pathname antes de los parámetros
  if (!url.pathname.endsWith("/")) {
    if (!/\.[a-zA-Z0-9]+$/i.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    }
  }

  const setOrDelete = (key: string, val?: string) => {
    const trimmed = (val || "").trim();
    if (trimmed) url.searchParams.set(key, trimmed);
    else url.searchParams.delete(key);
  };

  setOrDelete("utm_source", params.source);
  setOrDelete("utm_medium", params.medium);
  setOrDelete("utm_campaign", params.campaign);
  setOrDelete("utm_content", params.content);
  setOrDelete("utm_term", params.term);

  return url.toString();
}

/**
 * Deriva los parámetros UTM para enlaces del CV.
 * Por defecto asigna 'pdf', pero permite especificar 'html' u otro medio.
 */
export function getCvAttributionParams(
  targetPathOrUrl: string,
  explicitLocale?: Locale,
  contentId?: string,
  medium: string = "pdf",
): AttributionParams {
  const locale = explicitLocale || detectLocale(targetPathOrUrl);
  const raw = targetPathOrUrl.toLowerCase();

  let campaign = "resume-header";
  if (raw.includes("/projects")) {
    campaign = "resume-project";
  } else if (raw.includes("/experience")) {
    campaign = "resume-experience";
  } else if (raw.includes("/blog")) {
    campaign = "resume-article";
  } else if (raw.includes("/services")) {
    campaign = "resume-service";
  }

  return {
    source: locale === "es" ? "cv-es" : "cv-en",
    medium,
    campaign,
    content: contentId || "",
  };
}

/**
 * Etiqueta enlaces de CV asegurando slashes estrictos y el medio indicado (por defecto 'pdf').
 */
export function tagCvLink(
  pathOrUrl: string,
  explicitLocale?: Locale,
  contentId?: string,
  medium: string = "pdf",
): string {
  const params = getCvAttributionParams(
    pathOrUrl,
    explicitLocale,
    contentId,
    medium,
  );
  return buildAttributionUrl(pathOrUrl, params);
}
