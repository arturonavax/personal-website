# ROLE & OBJECTIVE

Act as a Staff Technical SEO & Cloudflare Edge Architect (`@astro-edge-performance-architect`).
Resolve all 6 Google Search Console indexing exclusions ("Page with redirect", "Alternate page with proper canonical tag", "Blocked by robots.txt", "Duplicate, Google chose different canonical", "Discovered/Crawled - currently not indexed") to achieve 100% clean canonical indexing and zero crawl-budget waste.

---

## TASK 1: ELIMINATE ALL INTERNAL NON-TRAILING-SLASH LINKS (`trailingSlash: "always"`) [COMPLETED]

**Status**: ✅ Completed & Verified.

**Problem**: Google Search Console reports 33 "Pages with redirect" because several components emit internal links without a trailing slash (`/es`, `/projects/${slug}`, `/es/experience/${slug}`, `/resume`, `/es/resume`).
**Files modified**:

- `src/components/common/Header.astro`
- `src/components/ui/BackToHomeButton.astro`
- `src/data/searchIndex.ts`
- `src/components/ui/PageIndexNav.astro`
- `src/layouts/BaseLayout.astro`

**Instructions & Implementation**:

1. In `src/components/common/Header.astro`:
   - Changed `const homeUrl = locale === "es" ? "/es" : "/";` to `const homeUrl = locale === "es" ? "/es/" : "/";`.
   - Ensured the contact anchor uses `${homeUrl}#contact` (`/#contact` or `/es/#contact`).
2. In `src/components/ui/BackToHomeButton.astro`:
   - Changed `const homeHref = isEs ? "/es" : "/";` to `const homeHref = isEs ? "/es/" : "/";`.
3. In `src/data/searchIndex.ts`:
   - In `enProjects`, changed `url: \`/projects/\${slug}/\``.
   - In `esExperience`, changed `url: \`/es/experience/\${slug}/\``.
   - 100% of URLs in `enDocuments` and `esDocuments` end with `/`.
4. In `src/components/ui/PageIndexNav.astro` and `src/layouts/BaseLayout.astro`:
   - Fallback hrefs and route checks normalize paths with trailing slash (`/es/`, `/resume/`, `/es/resume/`).

---

## TASK 2: REPLACE CRAWLABLE `?company=` FILTER ANCHORS WITH CANONICAL ROLE LINKS OR CLIENT TRIGGERS [COMPLETED]

**Status**: ✅ Completed & Verified.

**Problem**: `ExperienceTimeline.astro`, `SimulationCard.astro`, `SystemTelemetryDemo.astro`, and `experience/[slug].astro` render `<a href="/experience/?company=...">`. Googlebot crawls puluhan of `?company=` and `?filters=` combinations, causing 29 "Alternate page with proper canonical tag" and multiple "Page with redirect" entries in GSC.
**Files modified**:

- `src/components/ui/ExperienceTimeline.astro`
- `src/components/ui/SimulationCard.astro`
- `src/components/ui/SystemTelemetryDemo.astro`
- `src/pages/[...lang]/experience/[slug].astro`

**Instructions & Implementation**:

1. In `src/components/ui/ExperienceTimeline.astro`:
   - Added `rel="nofollow"` and `data-company-filter={company.toLowerCase().trim()}` so clicking `@Company` triggers client-side filtering without exposing crawlable query-parameter traps.
2. In `SimulationCard.astro`, `SystemTelemetryDemo.astro`, and `src/pages/[...lang]/experience/[slug].astro`:
   - Added `rel="nofollow"` and `data-company-filter` attributes.

---

## TASK 3: UNLOCK `/case-studies/` FOR INDEXING & FIX `robots.txt` / `/search/` `noindex` DIRECTIVES [COMPLETED]

**Status**: ✅ Completed & Verified.

**Problem**:

1. `/case-studies/` and `/es/case-studies/` are linked in `Header.astro`, but blocked in `public/robots.txt` (`Disallow: /case-studies`) and excluded from `@astrojs/sitemap` in `astro.config.mjs`.
2. `/search/` and `/es/search/` have `<meta name="robots" content="noindex, nofollow">`, but `cloudflare/worker.ts` overwrites them with `X-Robots-Tag: index, follow`, while `public/robots.txt` blocks `/search` under `User-agent: *` (preventing crawlers from seeing the `noindex` directive and raising "Blocked by robots.txt" in GSC).

**Files modified**:

- `astro.config.mjs`
- `public/robots.txt`
- `public/_headers`
- `cloudflare/worker.ts`
- `src/components/ui/UniversalSearchModal.astro`
- `src/pages/[...lang]/case-studies/index.astro`

**Instructions & Implementation**:

1. **`astro.config.mjs`**: Removed `!page.includes("/case-studies/")` from `sitemap({ filter })`.
2. **`public/robots.txt`**:
   - Removed `Disallow: /case-studies`, `Disallow: /es/case-studies`, `Disallow: /search`, `Disallow: /es/search`.
   - Added query-parameter disallows across all agents (`Disallow: /search?`, `/search/?`, `/es/search?`, `/es/search/?`, `/*?q=`, `/*?company=`, `/*?filters=`, `/*?skill=`, `/*?tag=`).
3. **`cloudflare/worker.ts` & `public/_headers`**:
   - In `cloudflare/worker.ts`: set `headers.set("X-Robots-Tag", "noindex, nofollow")` for search routes and queries with filter parameters.
   - In `public/_headers`: added explicit `X-Robots-Tag: noindex, nofollow` rules for `/search*` and `/es/search*`, and removed blanket index directive from `/*.html`.
4. **`src/pages/[...lang]/case-studies/index.astro`**:
   - Always returns static paths for `lang: undefined` and `lang: "es"` so SSG compiles `/case-studies/index.html` and `/es/case-studies/index.html` and `@astrojs/sitemap` discovers both with reciprocal hreflangs.
5. **`src/components/ui/UniversalSearchModal.astro`**: Added `rel="nofollow"` to `#view-search-page-link`.

---

## TASK 4: ENFORCE 301 TRAILING-SLASH CANONICAL REDIRECTS IN `cloudflare/worker.ts` & EXPLICIT `canonicalUrl` PROPS [COMPLETED]

**Status**: ✅ Completed & Verified.

**Files modified**:

- `src/lib/ports/edge-delivery.port.ts`
- `src/lib/adapters/cloudflare/edge-routing-policy.adapter.ts`
- `cloudflare/worker.ts`
- `src/layouts/ArticleLayout.astro`
- `src/pages/[...lang]/services/[slug].astro`
- `src/pages/[...lang]/projects/[slug].astro`
- `src/pages/[...lang]/blog/[slug].astro`
- `src/pages/[...lang]/case-studies/index.astro`

**Instructions & Implementation**:

1. In `src/lib/adapters/cloudflare/edge-routing-policy.adapter.ts` (`resolveCanonicalRedirect`):
   - For any `GET` / `HEAD` request to a public HTML document route where `url.pathname !== "/"` and `!url.pathname.endsWith("/")`, immediately returns 301 redirect to trailing-slash URL.
2. Passed explicit `canonicalUrl` and `availableLocales` in `services/[slug].astro`, `projects/[slug].astro`, `blog/[slug].astro`, and `case-studies/index.astro`.

---

## TASK 5: UPDATE AUTOMATED SEO & ROUTING TESTS [COMPLETED]

**Status**: ✅ Completed & Verified.

**Files modified**:

- `tests/spec-011/edge-telemetry-dedupe.test.ts`
- `tests/spec-012/seo-aeo-and-db-compaction.test.ts`
- `tests/odd-tasks.test.ts`
- `scripts/audit-codebase.ts`

**Verification Results**:

- `pnpm run typecheck`: 0 errors, 0 warnings.
- `pnpm test`: 327 pass, 0 fail (100% pass rate).
- `pnpm run build`: 65 pages built cleanly.
- `pnpm run audit`: All architectural static gates certified successfully.
