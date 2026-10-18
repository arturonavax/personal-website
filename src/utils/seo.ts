// src/utils/seo.ts
/**
 * SEO & Schema.org Monobilingual Knowledge Graph Utilities (SPEC-004 REQ-SEO-01 / REQ-SEO-02)
 */

import type { Locale } from "../i18n/locales";
import { buildCoreGraphNodes } from "../lib/seo/schema-builder";

export interface PersonSchemaOptions {
  locale: Locale;
  canonicalUrl: string;
  headline: string;
  bio: string;
  sameAs?: string[] | undefined;
}

export function generatePersonSchema(
  options: PersonSchemaOptions,
): Record<string, unknown> {
  const coreNodes = buildCoreGraphNodes({
    locale: options.locale,
    canonicalUrl: options.canonicalUrl,
    title: `Arturo Nava - ${options.headline}`,
    description: options.bio,
    pageType: ["ProfilePage", "WebPage"],
    sameAs: options.sameAs,
  });

  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": "https://arturonavax.dev/#person", // Stable global identity anchor
    inLanguage: options.locale,
    name: "Arturo Nava",
    jobTitle: options.headline,
    description: options.bio,
    url: options.canonicalUrl,
    sameAs: options.sameAs || [
      "https://github.com/arturonavax",
      "https://linkedin.com/in/arturonava",
      "https://x.com/arturonavax",
    ],
    "@graph": coreNodes,
  };
}

export interface HreflangLink {
  hreflang: "en" | "es" | "x-default";
  href: string;
}

/**
 * Computes verified hreflang links for a page, emitting alternates ONLY for locales
 * that actually exist (preventing broken hreflang -> 404 references).
 */
export function resolveVerifiedHreflang(options: {
  locale: Locale;
  canonicalUrl: string;
  alternateEnUrl?: string | undefined;
  alternateEsUrl?: string | undefined;
  availableLocales?: readonly Locale[] | undefined;
  siteUrl?: string | undefined;
}): {
  enUrl: string | undefined;
  esUrl: string | undefined;
  xDefaultUrl: string;
  links: HreflangLink[];
} {
  const siteUrl = (options.siteUrl || "https://arturonavax.dev").replace(
    /\/+$/,
    "",
  );
  const toFullUrl = (pathOrUrl: string): string => {
    if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
      return sanitizeCanonicalUrl(pathOrUrl, siteUrl);
    }
    const withLeading = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    const withTrailing = withLeading.endsWith("/")
      ? withLeading
      : `${withLeading}/`;
    return `${siteUrl}${withTrailing}`;
  };

  const hasEn = options.availableLocales
    ? options.availableLocales.includes("en")
    : options.locale === "en" || Boolean(options.alternateEnUrl);
  const hasEs = options.availableLocales
    ? options.availableLocales.includes("es")
    : options.locale === "es" || Boolean(options.alternateEsUrl);

  const enUrl = !hasEn
    ? undefined
    : options.locale === "en"
      ? options.canonicalUrl
      : options.alternateEnUrl
        ? toFullUrl(options.alternateEnUrl)
        : undefined;

  const esUrl = !hasEs
    ? undefined
    : options.locale === "es"
      ? options.canonicalUrl
      : options.alternateEsUrl
        ? toFullUrl(options.alternateEsUrl)
        : undefined;

  const xDefaultUrl = enUrl ?? esUrl ?? `${siteUrl}/`;

  const links: HreflangLink[] = [];
  if (enUrl) links.push({ hreflang: "en", href: enUrl });
  if (esUrl) links.push({ hreflang: "es", href: esUrl });
  links.push({ hreflang: "x-default", href: xDefaultUrl });

  return { enUrl, esUrl, xDefaultUrl, links };
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "tag",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

/**
 * Sanitizes canonical URLs by stripping all tracking query parameters (SPEC-004 REQ-SEO-02).
 */
export function sanitizeCanonicalUrl(
  rawUrl: string,
  baseOrigin = "https://arturonavax.dev",
): string {
  try {
    const parsed = new URL(rawUrl, baseOrigin);
    // Strip tracking parameters
    const keysToDelete: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (
        TRACKING_PARAMS.has(key.toLowerCase()) ||
        key.toLowerCase().startsWith("utm_")
      ) {
        keysToDelete.push(key);
      }
    });
    for (const key of keysToDelete) {
      parsed.searchParams.delete(key);
    }
    // If search is now empty, clear it completely
    if (Array.from(parsed.searchParams.keys()).length === 0) {
      parsed.search = "";
    }
    // Standardize trailing slash on directory routes
    if (
      !parsed.pathname.endsWith("/") &&
      !/\.[a-zA-Z0-9]+$/i.test(parsed.pathname)
    ) {
      parsed.pathname = `${parsed.pathname}/`;
    }
    return parsed.toString();
  } catch {
    return rawUrl.split("?")[0] || rawUrl;
  }
}
