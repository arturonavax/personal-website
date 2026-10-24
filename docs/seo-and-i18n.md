# SEO, multilingual routing, and machine-readable content

This guide describes the current implementation, not a promise of search rankings or a 100/100 audit score. Normative behavior and scenarios are in [PLAT10–13](../openspec/specs/current-platform.md#plat-10--canonical-urls-and-language-alternates).

## URL and locale rules

- English uses `/`; Spanish uses `/es/`. Both come from shared `[...lang]` templates and the `en`/`es` registry.
- Directory-form HTML uses trailing-slash document URLs. `SEOHead.astro` strips query/hash from canonical URLs while preserving extension-bearing resources.
- Collection details resolve counterparts by a visible matching `translationKey`, allowing translated slugs to differ. Missing translations omit the alternate; they do not fabricate a translated detail route.
- Each locale keeps its own canonical. `resolveVerifiedHreflang` emits eligible `en`, `es` and `x-default` links using explicit availability/counterpart evidence.
- Root language detection/suggestion must not redirect every deep link. The exact preference and banner lifecycle is specified in [current-spa](../openspec/specs/current-spa.md).
- Technical names and icons retain `translate="no"`/`notranslate` where implemented.

## Route availability is content-dependent

Projects, services, experience, case-studies, links, search and tools share locale templates. Detail pages require visible collection entries. Blog index paths are omitted entirely if no visible posts exist globally; a locale can show an empty blog when only the other locale has posts. Resume paths depend on the dedicated resolver and can display a missing-locale representation.

`draft: true` and `visible: false` are publication exclusions. They affect generated lists/details, feed and search inputs; they do not revoke access to files already deployed by an older build.

## Metadata and structured data

`src/components/common/SEOHead.astro` owns title/description fallback, canonical normalization, hreflang, Open Graph/Twitter metadata, local font preloads, favicon/manifest discovery and RSS autodiscovery.

`src/lib/seo/schema-builder.ts` normalizes page data into a connected graph:

| Entity           | Identity/relationship                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Person           | Stable `https://arturonavax.dev/#person` owner identity                                                               |
| WebSite          | `#website`, publisher and search relationships                                                                        |
| WebPage          | Canonical page `#webpage`, website/person/breadcrumb links                                                            |
| BreadcrumbList   | Canonical page `#breadcrumb` hierarchy                                                                                |
| Vertical content | TechArticle/BlogPosting, software source/application, professional service, profile/resume, collection-specific nodes |

When rebranding, update all tracked identity literals and structured-data helpers, not only visible headings. The shared owner ID in resume exports must agree with website metadata.

## Sitemap and crawl policy

`@astrojs/sitemap` emits `sitemap-index.xml` and its sitemap files. Current filters exclude admin, search and 404; **case-studies is included**, contrary to older guides.

Mapped content lastmod prefers updated frontmatter dates, then published/start dates, then file mtime. Unknown or invalid dates are omitted instead of being replaced with build time. The serializer reads actual emitted HTML and copies its verified hreflang links, so translated slugs can differ without inventing alternates. Canonical mismatches and noindex documents are excluded; validate generated output before publication.

`public/robots.txt` permits public search-engine and AI crawling while excluding admin/API and query-filter patterns. Search paths without queries remain crawlable so explicit noindex can be observed. Worker robots headers also mark protected, search and query-string responses nonindexable. Neither robots nor noindex replaces authentication.

Permanent edge canonical redirects normalize document paths and supported vanity hosts. Account-side DNS/routes must exist for a host to reach the Worker; source routing code alone does not prove that every vanity domain is active. A redirect consolidates canonical signals but cannot guarantee complete PageRank transfer.

## Feeds and machine-readable endpoints

| Endpoint                                         | Actual current behavior                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `/rss.xml`                                       | Visible bilingual posts with a Spanish title marker; if none, visible project fallback with stable order-derived dates |
| `/search-index.json`                             | Prerendered EN/ES arrays for projects/posts/experience/services                                                        |
| `/llms.txt`                                      | Tracked concise site/profile summary                                                                                   |
| `/llms-full.txt`                                 | English visible catalog summaries and resolved English resume; not all bilingual raw source bodies                     |
| Eligible content GET with Markdown accept/suffix | Worker-generated Markdown representation of available static HTML plus metadata/context links; separately cached       |
| `/og-default.png`                                | Current default social image                                                                                           |
| `/og/[...slug].png` source                       | Generator exists but `getStaticPaths()` currently returns `[]`; no per-entry cards are produced by it                  |

Markdown negotiation accepts `Accept: text/markdown` or eligible `.md` paths. It is a generated representation, not the original editorial Markdown API. If HTML extraction fails it can still return a fallback summary, so a Markdown 200 is not proof that a requested HTML slug exists. The current code returns generated Markdown rather than an unconditional 302 to the full catalog.

Public HTML responses expose machine-readable context links and indexing directives through Worker response handling. CDN/asset-bypass routes and protected/query routes have separate behavior; do not assume every response has the same headers.

`r2-push.mjs` can notify IndexNow after publication. Key configuration, verification files, HTTP response and accepted URLs need their own proof; a script call does not certify indexing, Google submission or worldwide propagation.

## Verification checklist

1. Hydrate the intended visible content and build the site without an accidental empty-content bypass.
2. Inspect generated canonical/hreflang/robots/JSON-LD for both locales and a missing-translation case.
3. Compare sitemap locations against actual generated public routes; inspect lastmod fallbacks and noindex exclusions.
4. Check RSS both with posts and with project fallback; inspect search-index locale groups and URLs.
5. Check actual social-image URLs; do not request disabled per-entry OG paths.
6. Exercise Markdown negotiation and its missing-asset behavior separately from ordinary HTML status.
7. Run the relevant `tests/spec-012/` and browser audit suites in a suitable local environment; source assertions alone do not verify Google indexing or field performance.

This documentation update did not rerun those runtime suites or inspect Search Console. Current field measurements, indexing state, authenticated account settings and private content remain separate evidence.
