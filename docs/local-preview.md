# Local social-image preview

Build and preview route-specific cards without deploying or pulling private content:

```sh
pnpm preview:local --port 4332
```

Open `http://127.0.0.1:4332/` or `/es/`. Inspect the emitted `og:image` / `twitter:image` URL, or open `/og/index.png` and `/og/es/index.png` directly. The command builds existing local content first; missing content/assets must be prepared separately. It bypasses package `prebuild` and R2 pull hooks, adds no dependencies, and does not deploy. Content that explicitly references remote build dependencies is not made offline by this command.

The port defaults to 4332. Use `pnpm preview:local --help` for usage. Invalid arguments fail before the build. A busy port fails rather than switching ports and breaking the baked absolute image URLs. The server binds only to `127.0.0.1`, not the LAN. Stop it with Ctrl+C and re-run after source/content edits; this is a static build preview, not hot reload.

## Isolation and metadata

- Output is ignored `dist-local/`; the production `dist/` directory is not rewritten. Do not deploy this local artifact.
- Only social-image URLs use the selected local origin. Canonical, hreflang, structured data and sitemap generation keep the configured production identity in emitted HTML. Existing browser-side canonical synchronization is unchanged.
- Explicit external images retain their authored URL. Eligible public routes receive the same build-generated PNGs as production. Noindex and excluded routes retain the default fallback.
- Normal production builds keep their production image URLs and build-only rendering. This feature adds no client JavaScript, request-time image rendering, or production image fetch.
- Ordinary `pnpm dev:local` uses the current dev origin for the existing fallback image. Route-specific cards require the build-preview command above.

The wrapper owns `LOCAL_SOCIAL_PREVIEW_ORIGIN`; do not set it globally or in deployment environments. Configuration rejects non-loopback origins, paths, credentials, query strings and fragments. Production deployment configuration still targets `dist/`.

## Boundaries

This server does not run the Cloudflare Worker. It cannot prove Access authorization, Worker routing, quota behavior or persisted telemetry. Before serving, it removes admin and private-vault HTML copies only from the disposable local output, rather than serving them without the Worker guard. Public assets remain available. Do not use this preview to validate admin behavior.

External social crawlers cannot reach your loopback server. Local checks prove emitted metadata and image availability; crawler acceptance and production caches require separate authorized production verification. No ranking or universal performance claim follows from local preview.

## Checks

```sh
bun test tests/local-preview.test.ts tests/social-images.test.ts
```

For a manual smoke check, request both locale pages and their image URLs. Expect HTTP 200 and PNG bytes on the selected origin; inspect source HTML to confirm production canonical/hreflang identity. The local preview's private admin/vault paths must not return their private HTML.
