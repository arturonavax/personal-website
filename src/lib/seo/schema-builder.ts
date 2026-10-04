import type { Locale } from "../../i18n/locales";

export interface SchemaPersonOptions {
  locale: Locale;
  canonicalUrl: string;
  jobTitle: string;
  description: string;
  sameAs?: string[];
}

export interface SchemaArticleOptions {
  locale: Locale;
  canonicalUrl: string;
  headline: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  authorName?: string;
  tags?: string[];
  imageUrl?: string;
}

export function buildPersonJsonLd(
  options: SchemaPersonOptions,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": "https://arturonavax.dev/#person",
    inLanguage: options.locale,
    name: "Arturo Nava",
    jobTitle: options.jobTitle,
    description: options.description,
    url: options.canonicalUrl,
    sameAs: options.sameAs || [
      "https://github.com/arturonavax",
      "https://linkedin.com/in/arturonava",
      "https://x.com/arturonavax",
    ],
  };
}

export function buildArticleJsonLd(
  options: SchemaArticleOptions,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    inLanguage: options.locale,
    headline: options.headline,
    description: options.description,
    url: options.canonicalUrl,
    datePublished: options.publishedAt,
    dateModified: options.updatedAt || options.publishedAt,
    author: {
      "@type": "Person",
      "@id": "https://arturonavax.dev/#person",
      name: options.authorName || "Arturo Nava",
      url: "https://arturonavax.dev/",
    },
    publisher: {
      "@type": "Person",
      "@id": "https://arturonavax.dev/#person",
      name: "Arturo Nava",
    },
    keywords: options.tags?.join(", "),
    image: options.imageUrl,
  };
}
