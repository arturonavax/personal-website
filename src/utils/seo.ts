// src/utils/seo.ts
/**
 * SEO & Schema.org Monobilingual Knowledge Graph Utilities (SPEC-004 REQ-SEO-01 / REQ-SEO-02)
 */

import type { Locale } from "../i18n/locales";

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
  };
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
