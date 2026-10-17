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
  collectionName?: "posts" | "projects" | "experience" | "services" | "case-studies",
  translationKey?: string,
): Promise<string | undefined> {
  // If viewing a collection entry, verify counterpart exists by translationKey
  if (collectionName && translationKey) {
    const entries = await getVisibleCollection(collectionName as CollectionKey);
    const targetEntry = entries.find((entry) => {
      const data = entry.data as { locale?: string; translationKey?: string };
      return data.locale === targetLocale && data.translationKey === translationKey;
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
    ? (cleanPath === "/" ? "/es/" : `/es${cleanPath}`)
    : cleanPath;
}
```

In `src/components/common/SEOHead.astro`, the tags are emitted conditionally:

```astro
<!-- Alternate Multilingual Hreflang Tags -->
{enUrl && <link rel="alternate" hreflang="en" href={enUrl} />}
{esUrl && <link rel="alternate" hreflang="es" href={esUrl} />}
{xDefaultUrl && <link rel="alternate" hreflang="x-default" href={xDefaultUrl} />}
```

---

## 4. Multilingual XML Sitemap (`@astrojs/sitemap`)

The build generates an RFC-compliant sitemap index (`dist/sitemap-index.xml`) with localized alternates in `dist/sitemap-0.xml`.

Configured in `astro.config.mjs`:
- Filters out non-content endpoints (`/search/`, `/404`, `/admin/`, `/case-studies/`).
- Emits `<xhtml:link rel="alternate" hreflang="en" .../>` and `hreflang="es"`.
- Dynamically injects `hreflang="x-default"` pointing to the default English canonical URL.
- Updates `<lastmod>` to the build timestamp.

---

## 5. Structured Data (JSON-LD) Knowledge Graph

All pages inject validated JSON-LD schema conforming to Schema.org standards:

### 5.1. `Person` & `ProfilePage`
On the homepage and resume, JSON-LD defines:
- `@type: ["Person", "ProfilePage"]`
- `@id: "https://arturonavax.dev/#person"`
- `name: "Arturo Nava"`
- `jobTitle: "Senior Software Engineer & Distributed Systems Architect"`
- `knowsAbout`: Distributed Systems, Astro, Cloudflare Workers, Go, Rust, TypeScript, Vector Search.
- `sameAs`: GitHub, LinkedIn, Twitter/X, and professional profiles.

### 5.2. `TechArticle` / `BlogPosting`
On blog posts:
- `@type: "TechArticle"`
- `headline`, `description`, `datePublished`, `dateModified`
- `author: { "@id": "https://arturonavax.dev/#person" }`
- `publisher: { "@id": "https://arturonavax.dev/#person" }`
- `mainEntityOfPage`: Canonical post URL.

### 5.3. `ItemList`
On taxonomy and catalogue pages (`/projects/`, `/services/`, `/experience/`), `ItemList` structured data outlines the items with explicit position indexes for rich search snippets.

---

## 6. Machine Readability for AI Agents (`llms.txt`)

To ensure AI search engines (Perplexity, ChatGPT Search, Claude, Google Gemini) index the portfolio with maximal context:
- `/llms.txt`: Structured plain-text summary of the engineer's core competencies, architecture, bio, and key project links.
- `/llms-full.txt`: Full-text machine-readable concatenation of all technical articles, services, and system specifications.
- `public/_headers` injects `Link: </llms.txt>; rel="describedby"` and `X-Llms-Txt: /llms.txt` on all public HTML responses.
- `public/robots.txt` explicitly allows AI crawlers while disallowing internal administrative endpoints.

---

## 7. Discreet Language Suggestion Banner

Rather than using invasive forced redirects (which break deep links and hurt SEO ranking), the site features a subtle, non-intrusive language suggestion banner:
- Compares the visitor's `navigator.language` with the current page locale.
- If a Spanish-speaking user lands on an English page, a discrete top banner offers: *"¿Prefieres leer en español? Ver versión en español"*.
- State is isolated per session in `sessionStorage` (`lang_suggestion_dismissed`), ensuring it never re-appears after dismissal.
