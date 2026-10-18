# ROLE & OBJECTIVE

Act as a Principal Technical SEO, AEO (Answer Engine Optimization), and Edge Architecture Engineer. Execute the following 6 tasks on the `personal-website` repository to achieve 100/100 Technical SEO, Rich Results eligibility across all vertical routes, zero Soft-404 risk, and instant indexing across Google, Bing, and AI Search Engines (ChatGPT Search, Perplexity, Claude, Google AI Overviews).

---

## TASK SEO-1: BUILD-TIME CONTENT INTEGRITY GATE (ZERO SOFT-404 PROTECTION)

**Problem**: `src/content/{posts,projects,experience,services,resume}` only contain `.gitkeep` in Git and rely on `scripts/r2-pull.mjs`[cite: 1]. An empty or partial R2 pull results in Astro building empty 200 OK index pages (Soft 404 penalty).
**Files to modify**:

- `scripts/r2-pull.mjs`[cite: 1]
- `scripts/audit-codebase.ts`[cite: 1]
- `package.json`[cite: 1]

**Instructions**:

1. In `scripts/r2-pull.mjs` and `scripts/audit-codebase.ts`, add a strict post-pull verification step (`verifyContentHydration()`) that inspects `src/content/posts`, `src/content/projects`, `src/content/experience`, `src/content/services`, and `src/content/resume`[cite: 1].
2. Assert that every required collection directory contains at least 1 valid `.md` or `.mdx` or `.json` file per supported locale (`en`, `es` from `src/i18n/locales.ts`)[cite: 1].
3. If any required collection is empty (unless `ALLOW_EMPTY_CONTENT=true` is explicitly set for local CI unit tests), throw a fatal error (`process.exit(1)`) before `astro build` runs so Cloudflare never deploys an empty Soft-404 site.

---

## TASK SEO-2: UNIFIED `@graph` KNOWLEDGE GRAPH & VERTICAL JSON-LD SCHEMAS

**Problem**: Structured data in `src/lib/seo/schema-builder.ts` and `src/data/schemaOrg.ts` must form a single connected `@graph` with persistent `@id` URIs and vertical-specific schemas for multipurpose authority[cite: 1].
**Files to modify**:

- `src/data/schemaOrg.ts`[cite: 1]
- `src/lib/seo/schema-builder.ts`[cite: 1]
- `src/components/common/SEOHead.astro`[cite: 1]
- `src/pages/[...lang]/blog/[slug].astro`[cite: 1]
- `src/pages/[...lang]/projects/[slug].astro`[cite: 1]
- `src/pages/[...lang]/services/[slug].astro`[cite: 1]
- `src/pages/[...lang]/resume/index.astro`[cite: 1]
- `src/pages/[...lang]/experience/[slug].astro`[cite: 1]

**Instructions**:

1. Refactor `src/lib/seo/schema-builder.ts` to always output a single root JSON-LD payload with `"@context": "https://schema.org"` and `"@graph": [...]`[cite: 1].
2. Link all entities using deterministic `@id` references:
   - Person: `https://arturonavax.dev/#person` (include `sameAs`, `knowsAbout`, `jobTitle`, `alumniOf`, `worksFor`)[cite: 1].
   - WebSite: `https://arturonavax.dev/#website` (with `publisher: { "@id": "https://arturonavax.dev/#person" }`, `inLanguage`, and `SearchAction` pointing to `/search?q={search_term_string}`)[cite: 1].
   - WebPage / ProfilePage / CollectionPage: `${canonicalUrl}#webpage` linked to `isPartOf: { "@id": "https://arturonavax.dev/#website" }` and `breadcrumb: { "@id": "${canonicalUrl}#breadcrumb" }`.
3. Inject vertical-specific nodes into `@graph`:
   - `src/pages/[...lang]/blog/[slug].astro`: `TechArticle` + `BlogPosting` with `author: { "@id": "https://arturonavax.dev/#person" }`, `datePublished`, `dateModified`, `wordCount`, `timeRequired` (ISO 8601 duration), `proficiencyLevel: "Expert"`, and `speakable` CSS selectors (`["h1", "article > p:first-of-type"]`)[cite: 1].
   - `src/pages/[...lang]/projects/[slug].astro`: `SoftwareSourceCode` / `SoftwareApplication` with `programmingLanguage`, `codeRepository`, `runtimePlatform`, and `author`[cite: 1].
   - `src/pages/[...lang]/services/[slug].astro`: `Service` + `ProfessionalService` with `provider: { "@id": "https://arturonavax.dev/#person" }`, `areaServed: "Worldwide"`, and `availableChannel`[cite: 1].
   - `src/pages/[...lang]/resume/index.astro`: `ProfilePage` with `mainEntity: { "@id": "https://arturonavax.dev/#person" }`, `hasOccupation`, and `educationalCredentialAwarded`[cite: 1].

---

## TASK SEO-3: DETERMINISTIC SITEMAP `lastmod`, ROUTE FILTERING & VERIFIED `hreflang`

**Problem**: `astro.config.mjs` sitemap generation lacks per-document `lastmod` timestamps from content collections and `src/components/common/SEOHead.astro` must verify translation existence before emitting `hreflang` tags[cite: 1].
**Files to modify**:

- `astro.config.mjs`[cite: 1]
- `src/utils/seo.ts`[cite: 1]
- `src/components/common/SEOHead.astro`[cite: 1]
- `public/robots.txt`[cite: 1]

**Instructions**:

1. In `astro.config.mjs`, configure `@astrojs/sitemap` with:
   - `filter: (page) => !page.includes('/admin') && !page.includes('/search') && !page.includes('/404')`[cite: 1].
   - `serialize(item)`: lookup the route in a precomputed build map derived from `src/content/**` frontmatter (`updatedDate || pubDate`) or `content/_manifest.v2.json` to attach the exact ISO `lastmod` date to every blog post, project, experience, and service URL[cite: 1].
2. In `src/utils/seo.ts` and `src/components/common/SEOHead.astro`, accept an optional `availableLocales?: Locale[]` prop[cite: 1]. For dynamic `[slug].astro` pages, pass only the locales where that specific slug exists so `<link rel="alternate" hreflang="...">` never points to a 404 route[cite: 1]. Ensure `hreflang="x-default"` always resolves to the default locale canonical URL[cite: 1].
3. In `public/robots.txt`, explicitly disallow `/admin`, `/api/`, and `/search?` while allowing all AI and search crawlers (`Googlebot`, `Bingbot`, `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `PerplexityBot`, `Applebot-Extended`) and referencing `Sitemap: https://arturonavax.dev/sitemap-index.xml`[cite: 1].

---

## TASK SEO-4: EDGE AEO (ANSWER ENGINE OPTIMIZATION), MARKDOWN NEGOTIATION & HTTP HEADERS

**Problem**: AI agents and search engines benefit from HTTP-level discovery headers (`X-Robots-Tag`, `Link` rel="llms-txt") and clean Markdown representation at the Edge[cite: 1].
**Files to modify**:

- `cloudflare/worker.ts`[cite: 1]
- `public/_headers`[cite: 1]
- `src/pages/llms-full.txt.ts`[cite: 1]
- `public/llms.txt`[cite: 1]

**Instructions**:

1. In `public/_headers` and `cloudflare/worker.ts`, attach the following headers to all public indexable HTML responses (`200 OK`, excluding `/admin`):
   - `X-Robots-Tag: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1` (enables full-bleed cards in Google Discover and maximum snippet extraction)[cite: 1].
   - `Link: <https://arturonavax.dev/llms.txt>; rel="llms-txt", <https://arturonavax.dev/llms-full.txt>; rel="alternate"; type="text/plain"`[cite: 1].
   - For `/[...lang]/admin/*` and `/api/*`, enforce `X-Robots-Tag: noindex, nofollow, noarchive`[cite: 1].
2. In `cloudflare/worker.ts`, implement lightweight **AI Content Negotiation**: if an incoming `GET` request to an article or project route includes `Accept: text/markdown` or ends with `.md` (e.g., `/en/blog/my-post.md`), serve the clean Markdown summary or redirect (`302`) to `/llms-full.txt` anchored to that section, cached in `caches.default` for 24 hours[cite: 1].
3. In `src/pages/llms-full.txt.ts`, ensure all collections (`posts`, `projects`, `experience`, `services`, `resume`) are rendered in structured, token-efficient Markdown with canonical URLs, publication dates, key metrics, and tech stacks so RAG systems can cite `arturonavax.dev` with high precision[cite: 1].

---

## TASK SEO-5: AUTOMATED `IndexNow` PUSH ON CONTENT SYNC & DEPLOYMENT

**Problem**: New or updated content pushed to R2 via `scripts/r2-push.mjs` waits passively for crawler visits[cite: 1].
**Files to modify**:

- `scripts/r2-push.mjs`[cite: 1]
- `public/.well-known/` (or `public/[indexnow-key].txt`)[cite: 1]

**Instructions**:

1. Add support for an `INDEXNOW_KEY` environment variable in `.env.example` and `scripts/r2-push.mjs`[cite: 1].
2. During `scripts/r2-push.mjs`, whenever delta files are uploaded or `--notify-indexnow` is passed, map the modified content paths (`src/content/posts/...`, `src/content/projects/...`) to their public canonical URLs across locales and send a single batch `POST https://api.indexnow.org/indexnow` payload[cite: 1].

---

## TASK SEO-6: LOCALIZED & FULL-CONTENT RSS FEEDS + AUTODISCOVERY

**Problem**: `src/pages/rss.xml.ts` needs full-text/summary optimization, language metadata, and `<link rel="alternate" type="application/rss+xml">` autodiscovery in `SEOHead.astro`[cite: 1].
**Files to modify**:

- `src/pages/rss.xml.ts`[cite: 1]
- `src/components/common/SEOHead.astro`[cite: 1]

**Instructions**:

1. Enhance `src/pages/rss.xml.ts` to include `<atom:link href="https://arturonavax.dev/rss.xml" rel="self" type="application/rss+xml" />`, categories/tags from post frontmatter, author metadata, and clean sanitized descriptions[cite: 1].
2. Verify that `src/components/common/SEOHead.astro` injects `<link rel="alternate" type="application/rss+xml" title="Arturo Nava — Engineering & AI RSS Feed" href="/rss.xml" />` in `<head>` across all pages[cite: 1].

---

## VERIFICATION REQUIREMENTS

Extend `tests/audit.spec.ts` and `scripts/audit-codebase.ts` to assert:

1. Every public page contains a single valid `<script type="application/ld+json">` with `"@graph"` containing connected `@id` nodes (`#person`, `#website`, `#webpage`, `#breadcrumb`)[cite: 1].
2. Every public page has `<link rel="canonical">`, symmetric `<link rel="alternate" hreflang="...">` + `x-default`, `og:image` (1200x630), `twitter:card="summary_large_image"`, and RSS autodiscovery[cite: 1].
3. `public/_headers` and `cloudflare/worker.ts` emit `X-Robots-Tag: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1` on public routes and `noindex, nofollow` on `/admin`[cite: 1].
4. Run `pnpm run typecheck && pnpm test && pnpm run build` with zero errors[cite: 1].
