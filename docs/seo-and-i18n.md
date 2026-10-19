# Technical SEO & Multilingual (i18n) Architecture

This portal is engineered to achieve **100/100 Technical SEO**, complete machine readability for AI search scrapers, and flawless multilingual indexing across search engines (Google, Bing, Yandex, DuckDuckGo).

---

## 1. Core SEO Guarantees & Invariants

- **Trailing Slash Normalization:** All canonical URLs, sitemaps, and internal links strictly enforce trailing slashes (`/`), matching Astro's directory output format and eliminating redirect loops or duplicate content penalties.
- **Reciprocal Hreflang Tags:** Multilingual alternate tags (`hreflang="en"`, `hreflang="es"`, `hreflang="x-default"`) are emitted conditionally **only when a validated translation counterpart exists**. Zero phantom 404 hreflangs.
- **Permanent Entity ID:** The primary `Person` entity retains a globally stable URI `@id: "https://arturonavax.dev/#person"` across all pages and locales, enabling Google Knowledge Graph consolidation.
- **Zero Layout Shifts:** Web fonts are preloaded locally in WOFF2 format (`Geist Sans` and `Geist Mono`), completely eliminating Font Awesome/Google Fonts network hops and layout shifts (CLS = 0.000).

---

## 2. Parameterized Multilingual Routing (`[...lang]`)

The site uses a dynamic route structure in `src/pages/[...lang]/` powered by Astro's Content Layer API:

```
src/pages/
├── 404.astro
├── llms-full.txt.ts
├── rss.xml.ts
├── search-index.json.ts
└── [...lang]/
    ├── index.astro                     # / (en) and /es/ (es)
    ├── blog/
    │   ├── index.astro                 # /blog/ and /es/blog/
    │   └── [slug].astro                # /blog/[slug]/ and /es/blog/[slug]/
    ├── projects/
    │   ├── index.astro                 # /projects/ and /es/projects/
    │   └── [slug].astro                # /projects/[slug]/ and /es/projects/[slug]/
    ├── services/
    │   ├── index.astro                 # /services/ and /es/services/
    │   └── [slug].astro                # /services/[slug]/ and /es/services/[slug]/
    ├── experience/
    │   ├── index.astro                 # /experience/ and /es/experience/
    │   └── [slug].astro                # /experience/[slug]/ and /es/experience/[slug]/
    ├── resume/
    │   └── index.astro                 # /resume/ and /es/resume/
    └── tools/
        ├── index.astro                 # /tools/ and /es/tools/
        └── resume-maker.astro          # /tools/resume-maker/ and /es/tools/resume-maker/
```

### Static Path Generation

For every page, `getStaticPaths` emits:

- `{ params: { lang: undefined }, props: { locale: "en" } }` -> Serves English at apex root `/`.
- `{ params: { lang: "es" }, props: { locale: "es" } }` -> Serves Spanish under `/es/`.

---

## 3. Reciprocal Hreflang & Counterpart Resolution

Search engines penalize sites that emit broken or asymmetric hreflang tags (e.g. page A points to page B as Spanish, but page B does not point back to page A as English, or page B returns 404).

In `src/i18n/utils.ts`, `getCounterpartUrl` guarantees reciprocity:

```typescript
export async function getCounterpartUrl(
  currentLocale: Locale,
  targetLocale: Locale,
  currentPathname: string,
  collectionName?:
    "posts" | "projects" | "experience" | "services" | "case-studies",
  translationKey?: string,
): Promise<string | undefined> {
  // If viewing a collection entry, verify counterpart exists by translationKey
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
      return targetLocale === "en"
        ? `/${routeSegment}/${slug}/`
        : `/es/${routeSegment}/${slug}/`;
    }

    // Return undefined if counterpart does not exist (prevents 404 hreflang)
    return undefined;
  }

  // Standard route toggle between / and /es/
  const withTrailing = ensureTrailingSlash(currentPathname);
  const cleanPath = withTrailing.replace(/^\/es(?:\/|$)/, "/") || "/";
  return targetLocale === "es"
    ? cleanPath === "/"
      ? "/es/"
      : `/es${cleanPath}`
    : cleanPath;
}
```

In `src/components/common/SEOHead.astro`, the tags are emitted conditionally:

```astro
<!-- Alternate Multilingual Hreflang Tags -->
{enUrl && <link rel="alternate" hreflang="en" href={enUrl} />}
{esUrl && <link rel="alternate" hreflang="es" href={esUrl} />}
{xDefaultUrl && (
  <link rel="alternate" hreflang="x-default" href={xDefaultUrl} />
)}
```

---

---

## 4. Multilingual XML Sitemap (`@astrojs/sitemap`)

The build generates an RFC-compliant sitemap index (`dist/sitemap-index.xml`) with localized alternates in `dist/sitemap-0.xml`.

Configured in `astro.config.mjs`:

- Filters out non-content endpoints (`/search`, `/404`, `/admin/`, `/case-studies/`).
- Emits `<xhtml:link rel="alternate" hreflang="en" .../>` and `hreflang="es"`.
- Dynamically injects `hreflang="x-default"` pointing to the default English canonical URL.
- **Deterministic `lastmod` Timestamps:** Lookups map each route path against content collection frontmatter (`updatedDate || updatedAt || pubDate || publishedAt || startDate`) or file mtime, ensuring search engines receive precise per-document modification dates rather than arbitrary build times.

---

## 5. Structured Data (JSON-LD) Unified `@graph` Knowledge Graph

Every public page emits a single root JSON-LD payload with `"@context": "https://schema.org"` and a unified `"@graph"` connecting authoritative entities with deterministic `@id` anchors:

- **Person (`https://arturonavax.dev/#person`):** Primary identity anchor with `worksFor` (LATAM Airlines), `alumniOf`, `knowsAbout`, and `sameAs`.
- **WebSite (`https://arturonavax.dev/#website`):** Publisher linked to `#person`, with multilingual support and `SearchAction`.
- **WebPage (`${canonicalUrl}#webpage`):** Page entity linked via `isPartOf: { "@id": "#website" }`, `about: { "@id": "#person" }`, and `breadcrumb: { "@id": "#breadcrumb" }`.
- **BreadcrumbList (`${canonicalUrl}#breadcrumb`):** Deterministic hierarchy path.

### Vertical Entity Schemas

- **Blog (`TechArticle` + `BlogPosting`):** Includes `author: { "@id": "#person" }`, `datePublished`, `dateModified`, `wordCount`, `timeRequired` (ISO 8601), and `speakable` CSS selectors (`["h1", "article > p:first-of-type"]`).
- **Projects (`SoftwareSourceCode` / `SoftwareApplication`):** With `programmingLanguage`, `runtimePlatform`, `codeRepository`, and `author`.
- **Services (`Service` + `ProfessionalService`):** With `provider: { "@id": "#person" }`, `areaServed: "Worldwide"`, and `availableChannel`.
- **Resume (`ProfilePage`):** Linked to `mainEntity: { "@id": "#person" }`, `hasOccupation`, and `educationalCredentialAwarded`.
- **Experience (`TechArticle`):** Milestones linked to `#person` and employer organizations.

---

## 6. Edge AEO (Answer Engine Optimization) & AI Agents

To maximize exposition across Google AI Overviews, ChatGPT Search, Perplexity, and Claude:

- `/llms.txt`: Clean, markdown-optimized profile and career summary with LATAM Airlines and key highlights (zero citation artifacts).
- `/llms-full.txt`: Full-text machine-readable catalog of all 5 collections (`posts`, `projects`, `experience`, `services`, `resume`).
- **Edge HTTP AEO Headers:** All public 200 HTML responses emit:
  `X-Robots-Tag: index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1`
  `Link: <https://arturonavax.dev/llms.txt>; rel="llms-txt", <https://arturonavax.dev/llms-full.txt>; rel="alternate"; type="text/plain"`
- **AI Content Negotiation:** Incoming `GET` requests with `Accept: text/markdown` or `.md` URL extension (e.g. `/blog/my-post.md`) serve lightweight markdown summaries or 302 redirects to `/llms-full.txt#<slug>`, cached in `caches.default` for 24 hours.
- **Automated `IndexNow` Push:** Content updates dispatched via `scripts/r2-push.mjs` immediately notify Bing, Yandex, and AI search engines through a single batch `POST https://api.indexnow.org/indexnow` payload with key verification via `/indexnow-key.txt` and `/.well-known/indexnow-key.txt`.
- **Full-Featured RSS Feed:** `/rss.xml` with `<atom:link rel="self">`, tags/categories, and `<link rel="alternate" type="application/rss+xml">` autodiscovery across all pages.
- **Build-Time Content Integrity Gate:** `verifyContentHydration()` validates that all required collections have valid `.md`/`.mdx`/`.json` content per locale before build, preventing empty Soft-404 site generation.

## 7. Discreet Language Suggestion Banner

Rather than using invasive forced redirects (which break deep links and hurt SEO ranking), the site features a subtle, non-intrusive language suggestion banner:

- Compares the visitor's `navigator.language` with the current page locale.
- If a Spanish-speaking user lands on an English page, a discrete top banner offers: _"¿Prefieres leer en español? Ver versión en español"_.
- State is isolated per session in `sessionStorage` (`lang_suggestion_dismissed`), ensuring it never re-appears after dismissal.

---

## 8. Google Search Console & Canonical Hardening (ODD Task 7)

To resolve all GSC indexation exclusions and eliminate crawl-budget waste:

1. **Strict Trailing Slash Normalization (`trailingSlash: "always"`):**
   - All internal links in UI components (`Header.astro`, `BackToHomeButton.astro`, `PageIndexNav.astro`) and search index (`src/data/searchIndex.ts`) enforce trailing slashes (e.g. `/es/`, `/projects/fyld/`, `/resume/`).
   - The Cloudflare Edge routing policy (`resolveCanonicalRedirect`) automatically executes a `301 Moved Permanently` redirect for any non-trailing-slash public HTML document request (`GET`/`HEAD`) to its canonical counterpart with trailing slash.
   - All content detail layouts (`ArticleLayout.astro`, `BaseLayout.astro`) receive explicit canonical URLs.

2. **Crawl Budget & Query Parameter Shielding:**
   - Client-side company and category filter triggers on `/experience/` use `rel="nofollow"` and `data-company-filter` attributes to prevent search engine crawlers from entering combinatorial parameter traps (`?company=...`, `?filters=...`).
   - `public/robots.txt` disallows all query parameter permutations across all search engines (`/*?q=`, `/*?company=`, `/*?filters=`, `/*?skill=`, `/*?tag=`).
   - The edge Worker dynamically applies `X-Robots-Tag: noindex, nofollow` to any URL requested with search or filter parameters.

3. **Case Studies & Search Route Directives:**
   - `/case-studies/` and `/es/case-studies/` are unlocked in `public/robots.txt` and automatically included in `@astrojs/sitemap` with full multilingual `xhtml:link` alternates.
   - `/search/` and `/es/search/` are allowed in `robots.txt` so crawlers can read their explicit `noindex, nofollow` headers (`X-Robots-Tag` and `<meta name="robots">`) without raising "Blocked by robots.txt" in GSC.
