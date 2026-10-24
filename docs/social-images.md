# Route-specific social previews

Public document routes receive localized 1200×630 PNG previews at build time. Cloudflare serves the files as static assets; there is no image-generation Worker, external API, or request-time rendering.

## Resolution and generation

1. An explicit `ogImage` wins. Article cover images are forwarded when present.
2. In a production build, eligible routes use `/og/<route>/index.png` (`/og/index.png` for the homepage). Locale and nested route segments are preserved.
3. The `route-social-images` Astro integration reads the actual emitted document head, including its final localized title and description, and renders one card at a time with the existing Resvg dependency.
4. Development, noindex documents, search, admin, APIs, private vaults, and non-document paths use the existing `/og-default.png` fallback. Unpublished content produces no document and therefore no card.

`src/pages/og/[...slug].png.ts` previously returned no static paths. The unused endpoint has been removed; one build integration now covers existing and future emitted public pages without maintaining a second content catalog.

## Local typography

`src/assets/fonts/Geist-OG.json` contains 729 Unicode glyph outlines and advance widths derived once from the tracked `public/fonts/Geist-Variable.woff2` at weight 400. The offline extraction used the installed Astro font decoder; production builds do **not** import that transitive package or need a font-conversion tool. The source filename, family, weight and font metrics are embedded in the asset. Keep [the official SIL Open Font License](../src/assets/fonts/OFL.txt) with this derived resource.

The principal asset and route renderer share `scripts/lib/social-style.mjs`: the burgundy gradient, faint Matrix with glyph-only blur behind measured text zones, gold technical frame/corners, availability badge, identity hierarchy and contact footer. The tracked principal PNG is not regenerated or replaced by the site build. Route cards retain portable local Geist metrics rather than relying on the reference script's host-font fallback.

The renderer uses local outline paths because the installed native renderer does not load WOFF2 directly. It does not depend on host fonts, fetch a font CDN, or ship this build-only glyph map to browser clients. Titles and descriptions shrink within bounded readable sizes, wrap by measured glyph advances, and ellipsize only after the smallest permitted size still overflows. Unicode is NFC-normalized and split by grapheme rather than UTF-16 units, so combining accents and joined emoji are not split across lines. Width and height budgets keep text away from the frame, neighboring content and footer; unsupported characters use the font's question-mark glyph. English and Spanish accented letters and punctuation are covered by tests.

If the tracked font changes, regenerate and verify the outline resource rather than silently switching to system fonts. Regeneration is an offline maintenance operation, not a production build dependency.

## Verification

- `bun test tests/social-images.test.ts`: route/path safety, metadata extraction, explicit-image preservation, exclusions, wrapping, visible glyph paths, PNG dimensions, determinism and content changes.
- Direct `astro build`, without the package content-pull hook: verify every generated image reference resolves to actual PNG bytes and that protected/noindex routes produce no generated cards.
- Open representative English and Spanish images and inspect long titles, contrast and crop-safe margins. Image URLs being present in metadata alone is not proof of image generation or acceptance by social crawlers.

The default fallback remains available. Rebuilding does not publish files or invalidate remote social-platform caches; deployment and production crawler verification remain separate operations.

## Output and optimization policy

Generated route PNGs are build artifacts under ignored `dist/og/`, never source files to commit. `/public/og/` is also ignored as defense against accidentally copying generated cards there. The existing tracked `public/og-default.png` remains the intentional fallback. Code, the local font outline source and its license are versioned, not generated route PNGs.

Rendering uses the principal generator's shared Sharp PNG options: lossless compression level 9, effort 10, adaptive filtering, no palette quantization, 96dpi, and removal of the redundant alpha channel for opaque RGB output. No optimizer CLI is required. Source configuration contains an old unused supersampling setting; neither generator is certified as supersampled. File sizes vary with text; tests enforce a conservative representative-card budget rather than claiming identical byte sizes to the principal asset.
