# Current platform, content, and public functionality

Status: current-state contract, inspected at baseline `4187033` on 2026-10-23. Read the [specification index](README.md) for precedence and evidence levels.
This contract describes shipped behavior, including limitations. It does not assert fresh runtime certification, identical private content, or automatic search-engine indexing.

## PLAT-01 — Static platform and boundaries

The application MUST compile with Astro static output, directory-form HTML, compressed HTML, and `trailingSlash: "always"`. English MUST use unprefixed paths; Spanish MUST use `/es/`. A runtime Astro SSR adapter is not required by this baseline. `package.json` records Astro 7.3.4, Tailwind 4.3.3, TypeScript 5.9.3, and `pnpm@12.5.1`; dependency resolution MUST follow the committed lockfile, not historical version badges.

The Worker entrypoint MUST serve the static artifact and dynamic APIs separately. Storage, search, telemetry, and captcha factories MUST retain their TypeScript port contracts and explicit Cloudflare/fallback selection. Vendor replacement requires infrastructure and adapter validation; the current repository does not demonstrate a zero-change migration to every provider.

Given a hydrated checkout, when `pnpm build` runs, then Astro emits `dist/` and the post-build admin isolation script relocates administrative HTML. Given ordinary document navigation, shipped vanilla scripts, ClientRouter, Nano Stores, and the Matrix Worker remain intentional client JavaScript; “zero framework hydration islands” MUST NOT be described as “zero delivered JavaScript.”

Evidence: [Astro configuration](../../astro.config.mjs), [package scripts](../../package.json), [adapter factory](../../src/lib/adapters/factory.ts), [ports](../../src/lib/ports/), [adapter tests](../../tests/spec-003/spec-003.test.ts). Edge/security behavior is specified in [current-edge-operations](current-edge-operations.md); persistent interaction in [current-spa](current-spa.md).

## PLAT-02 — Content model and visibility

The five Content Layer collections MUST use `src/content.config.ts`, not independently duplicated route schemas. Shared fields are `locale: en|es`, optional `canonicalId` and `translationKey`, `draft` default false, and `visible` default true. `_`-prefixed files are excluded by the editorial glob loaders.

| Collection and input                    | Required collection fields beyond the shared base                                                             | Additional supported fields/defaults                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `posts`: `posts/**/*.{md,mdx}`          | `title` max 75, `description` max 160, `pubDate` coerced date, `translationKey`, nonempty `tags`              | Optional published/updated dates, image/alt, canonical URL, keywords, positive reading minutes; author defaults to site owner, priority 50, type `article`, category `systems` |
| `projects`: `projects/**/*.md`          | `title`, `description`, `role`, integer `order`, `translationKey`, `techStack`                                | Optional company, label/value metrics, repository/live URLs, thumbnail, keywords; featured false                                                                               |
| `experience`: `experience/**/*.md`      | `company`, `role`, `location`, `employmentType`, `startDate`, integer `order`, `skills`, `keyAchievements`    | Optional end date and company URL/domain/industry/description/keywords                                                                                                         |
| `services`: `services/**/*.{md,mdx}`    | `title`, `description`, `type` (service, product, or mentorship), `translationKey`, integer `order`           | Featured false; tags/deliverables empty; optional price, delivery time, CTA URL/text, image, keywords                                                                          |
| `resume`: flat `ArturoNava-Resume-*.md` | Nonempty title/name/role/location/summary, updated date, skills record, contact email/GitHub/LinkedIn/website | Canonical identity default; dates/email/URLs validated by schema                                                                                                               |

Post categories MUST accept `systems`, `architecture`, `performance`, `ai`, `research`, `leadership`, `opinion`, `notes`, `general`, and `personal`; types MUST accept essay/note/article/opinion. Schema acceptance and the smaller curated category-filter menu are distinct.

Given an editorial item with `draft: true` or `visible: false`, when public collection helpers load it, then it MUST be absent from generated details, lists, search, and RSS. Draft visibility is a build-time publication decision, not an authorization mechanism for already-deployed files. Resume rendering additionally uses the dedicated resolver below.

Evidence: [schemas](../../src/content.config.ts), [visibility helper](../../src/utils/visibility.ts), [taxonomy tests](../../tests/spec-006/spec-006.test.ts), [visibility tests](../../tests/odd-tasks.test.ts).

## PLAT-03 — Route and content availability matrix

Unless stated otherwise, each public route below MUST have English and Spanish templates using the same implementation. Content-specific slugs MUST be derived from visible entries, stripping locale prefixes and extensions where the route implements that normalization; translations need not share a slug.

| Route family                                                         | Current behavior and source                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`, `/es/`                                                          | Home/about profile, curated content sections, career and contact; [home](../../src/pages/[...lang]/index.astro)                                                                                                        |
| `/projects/`, `/services/`, `/experience/` and localized equivalents | Locale-filtered catalog and generated detail pages; [page directory](../../src/pages/[...lang]/)                                                                                                                       |
| `/blog/`, `/es/blog/`                                                | Index routes generated only if at least one visible post exists globally; localized index can show its empty state. Details require a visible matching entry; [blog index](../../src/pages/[...lang]/blog/index.astro) |
| `/case-studies/`, `/es/case-studies/`                                | Interactive simulations from `src/data/simulations.ts`, not a sixth content collection or detail route family; [case studies](../../src/pages/[...lang]/case-studies/index.astro)                                      |
| `/links/`, `/es/links/`                                              | Curated identity/social/online-judge links from tracked data; [links](../../src/pages/[...lang]/links.astro)                                                                                                           |
| `/resume/`, `/es/resume/`                                            | Generated if either locale resume resolves; a missing specific locale returns the resolver's missing-resume content, not an invented translation; [resume page](../../src/pages/[...lang]/resume/index.astro)          |
| `/tools/`, `/tools/resume-maker/` and localized equivalents          | Tool catalog and editable resume workspace; [tools](../../src/pages/[...lang]/tools/)                                                                                                                                  |
| `/search/`, `/es/search/`                                            | Client search page, explicitly noindex; [search](../../src/pages/[...lang]/search.astro)                                                                                                                               |
| `/404.html` build artifact                                           | Shared custom not-found page, with Worker Static Assets 404-page handling; [404](../../src/pages/404.astro)                                                                                                            |
| `/admin/` and localized administrative paths                         | Protected operational surface, not public editorial content; [admin contract](current-telemetry-admin.md)                                                                                                              |

Given a new visible translated project, when content is rebuilt, then its locale catalog, detail route, search document, and metadata MUST reflect the entry. Given no visible posts, omitted blog paths MUST NOT be reported as a deployment failure solely because an older specification assumed a published blog.

## PLAT-04 — Catalogs, filters, and simulations

Projects and services MUST sort by ascending `order`; blog MUST sort by descending `pubDate`; experience MUST preserve its source-defined career ordering and company/skill filtering. Home MUST preserve curated featured selections and ordered fallbacks rather than displaying every entry.

Client pagination MUST operate on the already-rendered matched cards: 6 per page for blog/projects and 4 for services/case studies. Filters MUST update the paginator's matched set and reset pagination through the existing filter-change contract. Pagination is not a server-paginated SEO route hierarchy. Organization filtering in Projects MUST remain single-select with a deselect/reset path. Blog MUST expose category/tag filters; case studies MUST expose company filters. Experience links used as filter controls MUST retain their filter attributes and crawl restrictions.

Case-study simulations MUST keep their labeled sample/simulation behavior and controls from `SimulationCard`/`SystemTelemetryDemo`; they MUST NOT be described as the real `/admin` production telemetry stream. Company tooltips and links MUST connect to the associated career experience where supplied.

Given a filter matching fewer than one page of cards, when it changes, then counts and next/previous disabled states MUST reflect that subset rather than the original total. Given an empty catalog, the localized empty state MUST replace cards without a broken paginator.

Evidence: [pagination](../../src/components/ui/PaginationController.astro), [Projects filter](../../src/components/ui/ProjectsFilterBar.astro), [blog filter](../../src/components/ui/BlogFilterBar.astro), [simulations](../../src/data/simulations.ts), [simulation card](../../src/components/ui/SimulationCard.astro), [catalog regressions](../../tests/spec-006/spec-006.test.ts).

## PLAT-05 — Local search and optional edge search

The static `/search-index.json` MUST contain separate `en`/`es` document arrays for visible projects/posts/experience/services. Documents MUST preserve identity, entity ID, locale/badge, type, category, title, description, metadata, tags, keywords, canonical path, and priority. Search MUST reuse the cached index and avoid issuing one fetch per keystroke.

The page and universal modal MUST preserve locale-aware entity deduplication, query matching, category/type filters where supplied, result counts, and empty/no-result feedback. The page ranking favors current locale, entity priority, then lexical title/metadata/tag/keyword/description matches; it MUST NOT be replaced by random or alphabetic ordering. Current page weights are locale 5000, priority × 5, exact title 1000, exact metadata 500, exact tag 400, exact keyword 300, then per-word title 150/tag 100/keyword 80/metadata 60/description 20. The page and modal own their actual filtering implementations; a future unification requires parity tests.

`/api/search` is an additional edge semantic/lexical endpoint with Cloudflare AI/Vectorize and static-memory fallback. The public static index and its UI MUST remain useful without those optional bindings; do not imply the page necessarily sends every query to AI.

Given equivalent entities in both languages, when search renders matches, then it MUST prefer the current locale's eligible variant without showing duplicate translated entities. The page admits an other-language-only match only when its exact-match predicate accepts the query; it is not an unconditional cross-language fallback. Given index load failure, the UI MUST retain its error/empty feedback rather than fabricate results.

Evidence: [index construction](../../src/data/searchIndex.ts), [static endpoint](../../src/pages/search-index.json.ts), [page search](../../src/pages/[...lang]/search.astro), [universal search](../../src/components/ui/UniversalSearchModal.astro), [ranking tests](../../tests/spec-006/spec-006.test.ts), [edge search adapter](../../src/lib/adapters/cloudflare/vectorize-search.adapter.ts).

## PLAT-06 — Resume resolver and editable tools

The resume resolver MUST honor global resume visibility and frontmatter draft/visible flags, resolve locale-specific Markdown before compatibility CV/HTML paths, and expose parsed HTML, TOC items, pages, raw Markdown, JSON, TOML, and XML. Compatibility inputs exist in `src/data/resume.ts`; they are not all Content Layer loader inputs. Missing data MUST return the explicit missing-resume representation.

Resume Maker currently seeds its editor from raw `getCollection("resume")`, choosing the current locale or the first entry before falling back to resolved Markdown. Unlike the public resume resolver, that initial Content Layer selection does not apply the shared visibility helper; do not claim identical visibility enforcement on every tool input.

Resume Maker MUST provide editable Markdown with live preview, reset to the initial source, collapsible editor/preview panes, optional phone insertion/removal, reversible stripping of body links while preserving the contact header, recruiter attribution, copy/export controls, and clean print action. It MUST preserve the dedicated print lifecycle instead of printing hidden editor chrome. Its preview currently uses `marked.parse` and local DOM insertion; this is not an audited sanitizer or a server-side document storage service. Do not use it to render untrusted remote submissions without a separate security design.

Structured exports MUST retain the implemented subset, not promise full semantic round-trip equivalence: JSON uses Schema.org Person identity, profile/contact/skills; TOML contains profile/contact/skills; XML contains profile and website; Markdown copies the text. Valid outbound URLs MUST receive `utm_source=resume`, `utm_medium=document`, plus nonempty recruiter `utm_content`; invalid URLs MUST be left unchanged by the utility. The permanent owner `#person` ID MUST remain aligned with site JSON-LD.

Given edited Markdown, when a format is copied, then the export MUST use the current editor contents rather than stale build payload. Given strip-links then restore, then the saved unstripped text MUST return. Given print, then the resume-only layout and restored post-print screen state MUST be preserved.

Evidence: [resolver/parser](../../src/data/resume.ts), [resume maker](../../src/pages/[...lang]/tools/resume-maker.astro), [export serializers](../../src/utils/resumeExporters.ts), [export bar](../../src/components/ui/ResumeExportBar.astro), [attribution bar](../../src/components/ui/ResumeAttributionBar.astro), [resume/print tests](../../tests/spec-006/spec-006.test.ts), [input-isolation tests](../../tests/spec-009/spec-009.test.ts). See [SPA contract](current-spa.md) for print geometry and keyboard isolation.

## PLAT-07 — Public contact, sponsorship, and identity data

Public contact MUST preserve the page contact section, modal form, copy/mailto affordances, and localized success/error feedback. Contact submission, captcha, honeypot, rate limits, webhook/email handling, and durable lead behavior belong to the [edge operations](current-edge-operations.md) and [telemetry/admin](current-telemetry-admin.md) contracts; hiding a client control is not backend protection.

Coffee/sponsorship MUST present configured external funding methods and available copy/QR/link interactions without claiming that the website itself processes payments. Tracked data files for sponsorships, social links, companies, online judges, tools, and simulations MUST remain separate from private editorial R2 inputs.

Given a missing external provider/session/secret, the UI and operational documentation MUST identify the unavailable integration rather than certify delivery or payment. Changes to site identity MUST update tracked literals and schema anchors as well as content; setting an invented `SITE_URL` environment variable alone does not rebrand hardcoded routes.

Evidence: [contact section](../../src/components/ui/ContactSection.astro), [form](../../src/components/ui/ContactFormModal.astro), [sponsorship modal](../../src/components/ui/CoffeeSponsorshipModal.astro), [tracked data](../../src/data/).

## PLAT-08 — Content synchronization and publication inputs

Private editorial files and remote assets MUST remain outside Git. R2 synchronization maps `content/`→`src/content`, `assets/`→`public/remote-assets`, and `downloads/`→`public/downloads`. The build-time content bucket is selected by `R2_BUCKET_NAME` and is distinct from the deployed Worker's storage/WAL binding. Restoring Git alone does not restore editorial content or PDF files.

`runR2Pull --auto` MUST check local content unless `CONTENT_SOURCE=r2` or a detected CI environment requests remote freshness. The transport selector MUST use S3 credentials when explicitly selected or available, then `cf` availability, then Wrangler fallback, honoring `R2_DRIVER`. CLI selection is availability-based; it does not guarantee an authenticated session or retry every failed operation through all transports.

The v2 manifest MUST contain version 2, deterministic sorted key/hash root, entries/files with hash/size/content type/immutable-key metadata, and a content-addressed bundle key. Normal unchanged pulls SHOULD avoid list operations and individual downloads through ETag/root-hash fast paths. Default concurrency is 6; bundle download is attempted above 5 stale files. Bad/unavailable bundles MUST fall back to individual downloads, and downloaded files MUST be checked against SHA-256. Mapping and archive extraction MUST retain traversal rejection.

Optional `OBSIDIAN_VAULT_PATH` staging MUST remain local-only: `content:stage` and `dev-prod` copy changed supported mapped files from a configured vault without remote operations, skip draft/hidden files (including YAML trailing comments), and preserve local-only files. An unset vault path MUST retain the offline `dev-prod` behavior. Staging MUST reject symlinks and unsafe mapped destinations. Previously staged copies absent or unpublished in the vault MUST be retired only when their local hash matches the ignored ownership journal, with a local backup before retirement; conflicts MUST fail closed and remote-only files MUST remain. This does not delete remote objects or replace schema validation. Publication remains an explicit separate push, with editorial review before it.

Explicit `content:backup` MUST create a local-only compressed snapshot of existing mapped editorial content, remote assets and downloads, with a manifest of paths, sizes and SHA-256 hashes. It MUST exclude unmapped and hidden/underscore-name files, reject nested mapped symlinks before collecting files and reject empty input, and MUST NOT overwrite an existing archive or access any remote service. The ignored `.cache/backups/` output uses private file/directory permissions; an existing directory not mode 0700 MUST fail closed without changing its permissions or contents. This is not a remote bucket inventory, automatic vault/journal backup or publication; see [backup instructions](../../docs/content-sync.md#optional-local-backup) and [isolated command tests](../../tests/content-backup.test.ts).

Push MUST preserve remote-only objects unless `--prune` is explicitly requested. Dry-run MUST report the local plan without remote state queries or writes; it is not proof of the actual remote diff. Push also manages old bundles while preserving current/previous compatibility keys, and may notify IndexNow; publication requires separate owner authorization.

Given a changed manifest, when pull succeeds, then mapped local files and manifest cache MUST reflect verified transferred content. Given no usable remote manifest, pull MUST fail with the content-push prerequisite rather than silently produce an empty website. `--prune` is destructive on its respective local/remote side and MUST NOT be part of ordinary onboarding.

Evidence: [pull](../../scripts/r2-pull.mjs), [push](../../scripts/r2-push.mjs), [sync helpers](../../scripts/lib/r2-content.mjs), [local staging](../../scripts/lib/obsidian-content.mjs), [staging tests](../../tests/obsidian-content.test.ts), [content tests](../../tests/spec-012/seo-aeo-and-db-compaction.test.ts), [content guide](../../docs/content-sync.md).

## PLAT-09 — Build integrity and PDF publication

The hydration check MUST require at least one recognized file for each of five collections and both locales, supporting locale subdirectories and flat locale-suffixed filenames. It checks file presence/extensions (`md`, `mdx`, `json`), not schema validity or public visibility. `ALLOW_EMPTY_CONTENT=true|1` is an intentional bypass, not a production quality certificate. Astro's schema/build validation remains necessary.

Current limitation: pull's304/root-hash/all-files-up-to-date early returns do not all execute the final hydration check; documentation MUST NOT claim an unconditional gate on every exit. A clean build and explicit content inspection are required evidence when validating a new environment.

CV PDF optimization MUST take `.cv/ArturoNava-CV-*.pdf` or supplied inputs, use qpdf stream compression and linearization without rasterization/font substitution, write matching names under `public/downloads`, and retain the original if optimization is larger. `cv:publish` MUST be identified as optimization followed by the full content push, not an isolated local PDF-only operation. Size/time/percentage improvements are input-dependent observations, not fixed guarantees.

Given qpdf is unavailable, optimization MUST fail with an actionable installation message. Given a larger compressed result, then the original input copy MUST be the published candidate.

Evidence: [hydration helper](../../scripts/lib/r2-content.mjs), [PDF optimizer](../../scripts/optimize-pdf.mjs), [package hooks](../../package.json).

## PLAT-10 — Canonical URLs and language alternates

Canonical document URLs MUST omit query/hash, preserve the locale's own URL, and use trailing slashes except extension-bearing resources. Counterpart lookup for collection details MUST match visible entries by `translationKey`; absent translations MUST omit that alternate instead of inventing a 404. Verified `en`/`es` alternates and `x-default` MUST agree with available counterparts; route-level explicit availability differs from collection-entry lookup.

Given a Spanish detail with an English counterpart, when metadata renders, then its canonical MUST remain Spanish and alternates MUST connect both actual pages. Given an untranslated detail, then no fabricated cross-locale detail alternate may be emitted. Technical names marked `translate="no"` MUST retain their translation shielding.

Root-only language preference detection/suggestion and persistent language state MUST preserve deep links and search/referrer entry semantics as defined in [current-spa](current-spa.md), rather than forcing every document to a preferred locale.

Evidence: [SEO head](../../src/components/common/SEOHead.astro), [counterpart resolver](../../src/i18n/utils.ts), [verified alternates](../../src/utils/seo.ts), [SEO tests](../../tests/spec-012/seo-aeo-and-db-compaction.test.ts).

## PLAT-11 — Structured data, sitemap, and crawl policy

Public metadata MUST use the unified graph builder with stable owner `https://arturonavax.dev/#person`, website, webpage, breadcrumb, and applicable vertical entities: article/blog posting, software project/application, professional service, profile/resume, and collection listings. Locale descriptions and entity URLs MUST match rendered content rather than combine translations into duplicate identity nodes.

The sitemap MUST omit admin, search, and 404 while including generated case-studies routes. Lastmod MUST use the implementation's updated-date, publication/start-date, then file-mtime lookup for mapped content. Unknown or invalid dates MUST be omitted instead of replaced with build time. Sitemap alternates MUST match the verified links in actual emitted HTML, including different localized slugs and eligible `x-default`; validate the generated output.

`robots.txt` MUST retain admin/API/query-pattern restrictions and the sitemap-index location. Search pages MUST remain crawlable without a query so their noindex directive can be observed. Worker robots headers MUST distinguish protected/search/query surfaces from public HTML; robots exclusions are not access controls.

Given an indexable public page, then its canonical, graph URL and sitemap location MUST be consistent. Given a search or filtered query URL, then it MUST NOT be documented as a separate indexable content page merely because the template exists.

Evidence: [graph builder](../../src/lib/seo/schema-builder.ts), [sitemap configuration](../../astro.config.mjs), [robots](../../public/robots.txt), [Worker response handling](../../cloudflare/worker.ts), [SEO/AEO tests](../../tests/spec-012/seo-aeo-and-db-compaction.test.ts).

## PLAT-12 — Feeds, machine-readable endpoints, and social assets

`/rss.xml` MUST combine visible posts across locales, mark Spanish titles, and use project fallback items with stable order-derived dates if no posts exist. `/search-index.json` MUST be prerendered. `/llms.txt` is a tracked summary; `/llms-full.txt` MUST reflect its current English visible projects/posts/services/experience summary catalog plus resolved English resume, not promise full bilingual Markdown bodies.

The Worker MUST support the implemented GET Markdown negotiation for eligible content routes through `Accept: text/markdown` or `.md` suffix. It extracts available static HTML content, emits canonical/author/locale/section/summary/full-context links, and caches the representation separately. Its fallback can generate a summary even when asset extraction fails; it is not an exact raw-source API or proof that every requested slug exists. Do not describe an automatic302 to the full catalog as the current implementation.

The route-social-images build integration generates localized 1200×630 PNG cards from actual emitted public HTML. Explicit authored images win; development and excluded/noindex routes retain `/og-default.png`. A renderer dependency or metadata URL alone does not prove emission. Favicons, manifest, and local font assets MUST remain discoverable through SEOHead.

Given no visible posts, then RSS MUST still expose the project fallback when visible projects exist. Given a normal page without OG override, then its production social image MUST resolve an emitted route card; development and excluded/noindex routes retain the default fallback.

Evidence: [RSS](../../src/pages/rss.xml.ts), [full text catalog](../../src/pages/llms-full.txt.ts), [static search index](../../src/pages/search-index.json.ts), [OG build integration](../../src/integrations/social-images.ts), [Markdown negotiation](../../cloudflare/worker.ts), [SEO head](../../src/components/common/SEOHead.astro).

## PLAT-13 — Fonts, assets, and measurable quality

The design MUST retain self-hosted Geist Sans/Mono WOFF2, preload behavior, font-display settings, and metric-adjusted local fallbacks. Resume print MUST preserve its static-font and page geometry rules described in [current-spa](current-spa.md). Images MUST retain meaningful alternatives, stable geometry where provided, and the existing Astro/native asset handling instead of adding third-party font/icon CDNs.

Performance, accessibility, SEO, no-layout-shift, and smooth-navigation requirements MUST be validated against the actual built pages and device/browser conditions. A framework choice, static audit, old Lighthouse score, or unrun test MUST NOT be represented as guaranteed100/100, zero INP, zero CLS, fixed TTFB, or universal 60–120 FPS. Preserve justified client functionality while measuring its cost.

Evidence: [global typography and print styles](../../src/styles/global.css), [head/preloads](../../src/components/common/SEOHead.astro), [static audit](../../scripts/audit-codebase.ts), [browser audit](../../tests/audit.spec.ts).

## Verification and known external inputs

These references identify existing checks; this documentation update did not rerun runtime suites. Some Bun tests are source-structure assertions rather than end-to-end proof. Browser suites require a running local server, browser executable and suitable visible content/fixtures; skipped content-dependent cases are not passes.

| Contract group | Existing verification entry points                                   | Additional evidence needed                                                     |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| PLAT01–04      | `tests/spec-003/`, `tests/spec-006/`, `tests/odd-tasks.test.ts`      | Hydrated production build, route/empty-state inspection                        |
| PLAT05–07      | `tests/spec-006/spec-006.test.ts`, `tests/spec-009/spec-009.test.ts` | Search parity, exports/print across browsers, external integration receipts    |
| PLAT08–09      | `tests/spec-012/seo-aeo-and-db-compaction.test.ts`                   | Owner-supplied R2 content/assets/PDFs, scoped authorized sync, resulting build |
| PLAT10–13      | `tests/spec-012/`, `tests/audit.spec.ts`                             | Generated head/sitemap/feed review and current field/lab measurements          |

External editorial content, image/PDF assets, deployment credentials, search indexing state, and account-side service configuration are not recoverable from these public specifications. Keep those inputs in owner-controlled backups, never inline their secret values into docs.

## Discovery upgrade — Search, article series and social cards

The subsequent implementation recorded in `odd/tasks/discovery-content-upgrade.md` adds optional post `series: { id, title, part }` frontmatter. Published parts are grouped by locale and stable series ID, ordered by positive authored part number, and linked with subtle previous/next navigation at both ends of the article. Draft/hidden parts never leak into links; standalone posts are unchanged. Duplicate published part numbers within a locale/series fail validation. See `tests/post-series.test.ts` and `docs/content-sync.md`.

Blog counterpart availability follows visible translation identity rather than slug equality. Authored update dates and cover images reach article metadata. Sitemap serialization uses the actual emitted canonical/hreflang metadata and omits unknown modification dates rather than substituting build time. Public Search discovery articles remain eligible; utility Search and protected routes remain excluded.

`SEOHead` preserves explicit images, otherwise production builds reference route-specific localized 2400×1260 PNGs generated from emitted public HTML by `src/integrations/social-images.ts`. Local Geist-derived glyph outlines avoid host-font variation or request-time rendering. Development and noindex/private routes retain the default fallback. The unused zero-path OG endpoint is replaced by the build integration. See `docs/social-images.md` and `tests/social-images.test.ts`; actual build/image existence is required evidence, not metadata URLs alone.

Home metadata and visible availability describe senior software engineering, technology leadership opportunities and independent projects without claiming an unverified current director appointment. The dated audit records scope and remaining account/field evidence; no ranking or universal performance certification follows from these changes.

## Social-card branding and availability refinement

Generated route cards and the shipped production fallback MUST share the local Geist/Geist Mono weight hierarchy, 2400×1260 raster dimensions, bounded text fitting and the single `src/config/availability.mjs` build-time flag. About availability text/status/pulse MUST follow that same flag; closed state must not advertise work availability. Existing contact/services remain usable. Experience title/description metadata MUST distinguish current versus former roles from existing `endDate` semantics in both locales. Generated PNGs remain ignored, and local acceptance uses the ordinary Worker asset route rather than alternate build origins/output. See `docs/social-images.md`, `tests/hiring-availability.test.ts`, `tests/experience-metadata.test.ts`, and `tests/social-images.test.ts`.

The social-image build hook MUST report the final encoded byte size for each generated route image and the fallback, using ✓ for ≤300,000 bytes and ✗ with a warning above that local performance budget. The summary MUST include all generated PNGs. Size diagnostics do not change output bytes or fail a successful build, and MUST NOT claim universal platform acceptance (`tests/social-image-size.test.ts`, `tests/social-images.test.ts`).
