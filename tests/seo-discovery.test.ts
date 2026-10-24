import { describe, expect, it } from "bun:test";
import {
  serializeVerifiedSitemapItem,
  isIndexableSitemapPath,
} from "../scripts/lib/sitemap-metadata.mjs";
import { hiringPositioning } from "../src/lib/seo/hiring";

describe("verified discovery metadata", () => {
  it("uses emitted hreflang rather than guessing translated slugs", () => {
    const html = `<head><link rel="canonical" href="https://arturonavax.dev/blog/systems/" />
      <link rel="alternate" hreflang="en" href="https://arturonavax.dev/blog/systems/" />
      <link rel="alternate" hreflang="es" href="https://arturonavax.dev/es/blog/sistemas/" />
      <link rel="alternate" hreflang="x-default" href="https://arturonavax.dev/blog/systems/" />
      <meta property="article:modified_time" content="2026-10-20T00:00:00Z" /></head>`;
    const item = serializeVerifiedSitemapItem(
      {
        url: "https://arturonavax.dev/blog/systems/",
        links: [
          { lang: "es", url: "https://arturonavax.dev/es/blog/systems/" },
        ],
      },
      html,
    );
    expect(item?.links).toEqual([
      { lang: "en", url: "https://arturonavax.dev/blog/systems/" },
      { lang: "es", url: "https://arturonavax.dev/es/blog/sistemas/" },
      { lang: "x-default", url: "https://arturonavax.dev/blog/systems/" },
    ]);
    expect(item?.lastmod?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });
  it("does not fabricate missing alternates or fresh modification times", () => {
    const item = serializeVerifiedSitemapItem(
      {
        url: "https://arturonavax.dev/services/",
        lastmod: new Date(),
        links: [{ lang: "es", url: "https://arturonavax.dev/es/services/" }],
      },
      "<head></head>",
    );
    expect(item?.links).toEqual([]);
    expect(item?.lastmod).toBeUndefined();
  });
  it("keeps public search-related articles but excludes utility and noindex pages", () => {
    expect(isIndexableSitemapPath("/blog/search-engineering/")).toBe(true);
    for (const path of ["/admin/", "/es/search/", "/404/", "/api/telemetry/"])
      expect(isIndexableSitemapPath(path)).toBe(false);
    expect(
      serializeVerifiedSitemapItem(
        { url: "https://arturonavax.dev/" },
        '<head><meta name="robots" content="noindex, follow"></head>',
      ),
    ).toBeUndefined();
  });
  it("preserves content-derived dates and rejects invalid dates", () => {
    expect(
      serializeVerifiedSitemapItem(
        { url: "https://arturonavax.dev/" },
        "<head></head>",
        new Date("2026-10-01"),
      )?.lastmod?.toISOString(),
    ).toBe("2026-10-01T00:00:00.000Z");
    expect(
      serializeVerifiedSitemapItem(
        { url: "https://arturonavax.dev/" },
        '<head><meta property="article:modified_time" content="invalid"></head>',
        new Date("invalid"),
      )?.lastmod,
    ).toBeUndefined();
  });
  it("positions hiring intent without inventing a current director job title", () => {
    expect(hiringPositioning.en.title).toContain("Senior Software Engineer");
    expect(hiringPositioning.en.availability).toContain(
      "Director of Technology",
    );
    expect(hiringPositioning.es.availability).toContain(
      "dirección de tecnología",
    );
    expect(hiringPositioning.en.availability).toContain("opportunities");
  });
});
