# Route-specific social previews

Public document routes receive localized 2400×1260 PNG previews at build time. Cloudflare serves the files as static assets; there is no image-generation Worker, external API, or request-time rendering.

## Resolution and generation

1. An explicit `ogImage` wins. Article cover images are forwarded when present.
2. In a production build, eligible routes use `/og/<route>/index.png` (`/og/index.png` for the homepage). Locale and nested route segments are preserved.
3. The `route-social-images` Astro integration reads the actual emitted document head, including its final localized title and description, and renders one card at a time with the existing Resvg dependency.
4. Development, noindex documents, search, admin, APIs, private vaults, and non-document paths use the existing `/og-default.png` fallback. Unpublished content produces no document and therefore no card.

`src/pages/og/[...slug].png.ts` previously returned no static paths. The unused endpoint has been removed; one build integration now covers existing and future emitted public pages without maintaining a second content catalog.

## Local typography

`src/assets/fonts/Geist-OG.json` contains 729 Unicode glyph outlines and advance widths derived once from the tracked `public/fonts/Geist-Variable.woff2` at weight 400. The offline extraction used the installed Astro font decoder; production builds do **not** import that transitive package or need a font-conversion tool. The source filename, family, weight and font metrics are embedded in the asset. Keep [the official SIL Open Font License](../src/assets/fonts/OFL.txt) with this derived resource.

The principal asset and route renderer share `scripts/lib/social-style.mjs`: the burgundy gradient, faint Matrix with glyph-only blur behind measured text zones, gold technical frame/corners, availability badge, identity hierarchy and contact footer. The tracked principal source PNG is not modified. The build writes `dist/og-default.png` using the same renderer as route cards, so the deployed fallback follows the current brand and availability flag instead of stale source-asset text.

The renderer uses local outline paths because the installed native renderer does not load WOFF2 directly. It does not depend on host fonts, fetch a font CDN, or ship this build-only glyph map to browser clients. Titles and descriptions shrink within bounded readable sizes, wrap by measured glyph advances, and ellipsize only after the smallest permitted size still overflows. Unicode is NFC-normalized and split by grapheme rather than UTF-16 units, so combining accents and joined emoji are not split across lines. Width and height budgets keep text away from the frame, neighboring content and footer; unsupported characters use the font's question-mark glyph. English and Spanish accented letters and punctuation are covered by tests.

If the tracked font changes, regenerate and verify the outline resource rather than silently switching to system fonts. Regeneration is an offline maintenance operation, not a production build dependency.

## Verification

- `bun test tests/social-images.test.ts`: route/path safety, metadata extraction, explicit-image preservation, exclusions, wrapping, visible glyph paths, PNG dimensions, determinism and content changes.
- Direct `astro build`, without the package content-pull hook: verify every generated image reference resolves to actual PNG bytes and that protected/noindex routes produce no generated cards.
- Open representative English and Spanish images and inspect long titles, contrast and crop-safe margins. Image URLs being present in metadata alone is not proof of image generation or acceptance by social crawlers.

The default fallback remains available. Rebuilding does not publish files or invalidate remote social-platform caches; deployment and production crawler verification remain separate operations.

## Output and optimization policy

Generated route PNGs are build artifacts under ignored `dist/og/`, never source files to commit. `/public/og/` is also ignored as defense against accidentally copying generated cards there. The existing tracked `public/og-default.png` remains a development/source fallback; production output is generated using the shared renderer. Code, the local font outline source and its license are versioned, not generated route PNGs.

Rendering uses the principal generator's shared Sharp PNG options: lossless compression level 9, effort 10, adaptive filtering, no palette quantization, 96dpi, and removal of the redundant alpha channel for opaque RGB output. No optimizer CLI is required. Route cards and the production fallback rasterize the 1200×630 logical composition at 2× resolution. File sizes vary with text; tests enforce a conservative representative-card budget rather than claiming identical byte sizes to the principal asset.

## Branding, availability and employment history

Route cards use real Geist Bold (700) for identity/titles and Geist Mono Semibold (600) for technical details, not synthetic stroke weights. Their outline resources derive offline from the tracked variable fonts with `node scripts/extract-og-fonts.mjs`; see `src/assets/fonts/README.md`. No system font lookup, font download or client payload is added. The opportunity panel is deliberately larger and spans engineering roles, technology leadership and independent projects in both locales.

Set `availability.openToWork` in `src/config/availability.mjs` to `false`, then rebuild. About hiring text/status/pulse and generated cards (including the shipped fallback) share this flag. Closed cards show neutral professional positioning without an availability claim. Contact and service features remain available. This is a build-time setting, not an admin/runtime service.

Experience metadata uses the content schema's existing `endDate`: omitted means current; present means former. English and Spanish titles/descriptions state the distinction, and the OG integration consumes those emitted values without another content lookup.

For local acceptance use `pnpm run dev-prod` and open `http://localhost:8788/og/index.png`, `/og/es/index.png`, `/og/experience/<slug>/index.png` or `/og-default.png` directly. Production metadata keeps its canonical image origin. No `dist-local` directory or image-origin override is used.

## Build size diagnostics

Every generated route PNG and `/og-default.png` prints its final encoded file size in decimal kB and exact bytes, followed by ✓ or ✗. The conservative site budget is **≤300 kB (300,000 bytes)**, centralized in `src/lib/seo/social-image-size.ts`. This is a performance target, **not a universal platform maximum**. Oversized cards produce warnings and a summary count; they do not fail the build or change image quality/content.

A check means only that the final file meets this size budget. Actual previews also depend on public crawler access, correct metadata, supported formats/dimensions, fetch latency and platform caching. Platform-specific acceptance is not certified by a local build.
