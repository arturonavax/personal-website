# Verification and evidence

Use checks appropriate to the changed behavior. This guide documents available checks and their prerequisites; the commands below are not a report that they were run for every change.

## Quick path

1. Read the relevant [current contract](../openspec/specs/README.md) and its test anchors.
2. Identify local content, browser, resource, and authorization prerequisites.
3. Run the smallest meaningful check, then the applicable broader suite.
4. Record exact commands/results, skips, limitations, and environment. Keep local and production evidence separate.

## Evidence levels

| Level                  | What it establishes                                                | What it does not establish                                  |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| Source/readback        | A branch implements a flow or a documented contract matches code   | Execution, correctness under every input, or deployed state |
| Static assertion       | A test finds expected source/configuration text                    | Full browser or edge semantics                              |
| Unit/integration       | An assertion passes in its runner and fixture model                | Provider global behavior or every browser                   |
| Browser                | Observable behavior in the selected browser/device/content fixture | Universal FPS, hardware-independent timing, or field CWV    |
| Production persistence | An authorized deployed request has a correlated persisted effect   | Every region, traffic condition, or account policy          |

A missing test is a coverage gap, not evidence that the implementation is absent. A historical PASS is dated evidence, not a current certification. Dashboard charts may use fallback data, so visible values cannot alone establish ingestion.

## Check catalog

| Check              | Command                                         | Prerequisites / boundaries                                                                 |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Formatting         | `pnpm exec prettier --check <changed-files>`    | Check only the candidate; normalize intended files before review                           |
| Patch hygiene      | `git diff --check`                              | Does not inspect functionality                                                             |
| Astro/TypeScript   | `pnpm check`                                    | Installed toolchain; content may affect diagnostics                                        |
| Unit/integration   | `pnpm test`                                     | Bun; Playwright suites have a guard and do not become browser checks under Bun             |
| Architecture audit | `pnpm run audit`                                | Scans code/build/headers and content hydration; may need populated content/build artifacts |
| Static build/vault | Direct Astro build + isolation below            | Valid existing local content/assets; bypasses the package content-pull hook                |
| Browser            | `pnpm exec playwright test <suite> --workers=1` | Running local server, compatible installed browser, content for route-dependent cases      |

Use the pinned package manager and existing lockfile. Do not install or upgrade packages simply to turn a missing-environment check green. Test counts depend on discovery and inputs; report observed counts, not the old README's fixed count.

## Local-content build without the pull hook

`CONTENT_SOURCE=local` is not an offline guarantee. `scripts/r2-pull.mjs --auto` forces a freshness pull for any truthy `CI`, `CF_PAGES`, `CLOUDFLARE_BUILD`, or `GITHUB_ACTIONS`; missing content can also trigger remote transfer. The value `"false"` is still a truthy environment string. `pnpm build` invokes that automatic prebuild hook.

When R2 access is not authorized, use the installed Astro CLI directly with valid existing local content:

```sh
pnpm exec astro check
pnpm exec astro build
node scripts/isolate-admin-build.mjs
```

These commands bypass the package `prebuild` content-pull hook. They do not hydrate missing files or grant permission for any other network dependency referenced by project content. Do not infer that `pnpm dev-prod`, `pnpm deploy`, or Wrangler is equally no-pull: `wrangler.jsonc` also defines a custom build command that explicitly pulls R2. A no-pull Worker harness needs a separately reviewed local configuration without that custom build command; do not silently edit production configuration to obtain it.

## Local browser/Worker harness

The usual production-like entry point is:

```sh
# May pull content through package hooks and Wrangler custom build.
# Requires authorization for any remote content access.
pnpm run dev-prod
```

This runs Astro diagnostics, static build and admin-vault isolation before Wrangler serves on port 8788. Configured servers bind to `0.0.0.0`; test on a trusted network. `pnpm dev:local` on port 4321 is useful for presentation but is not a substitute for Worker routing/auth/telemetry behavior. Local D1/R2 state must be prepared separately as documented by the [edge contract](../openspec/specs/current-edge-operations.md); do not use a remote database reset to prepare tests.

Browser suites commonly accept `PLAYWRIGHT_BASE_URL` (default localhost:8788) and `CHROMIUM_EXECUTABLE_PATH` for an existing compatible browser. Inspect each selected suite before relying on an override; no shared Playwright configuration is assumed.

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8788 pnpm exec playwright test \
  tests/spa-continuity.spec.ts tests/timeline-telemetry.spec.ts \
  tests/matrix-zoom.spec.ts tests/geometric-corners.spec.ts --workers=1
```

### Browser coverage to select

| Behavior                                               | Suite                               |
| ------------------------------------------------------ | ----------------------------------- |
| Persistent owner, theme and navigation lifecycle       | `tests/spa-continuity.spec.ts`      |
| Cached job navigation and committed telemetry requests | `tests/timeline-telemetry.spec.ts`  |
| Zoom/DPR/viewport stability                            | `tests/matrix-zoom.spec.ts`         |
| Software rendering stress                              | `tests/matrix-software.spec.ts`     |
| Posts/projects surfaces                                | `tests/blog-surfaces.spec.ts`       |
| Timeline containment                                   | `tests/experience-surfaces.spec.ts` |
| Radius/accent/hover/overflow behavior                  | `tests/geometric-corners.spec.ts`   |
| Broader audit scenarios                                | `tests/audit.spec.ts`               |

Published-route cases depend on visible localized content. Tests may skip when posts are hidden or absent. Record the skip; never make production content visible just to inflate coverage. If temporary dummy fixtures are needed, keep them clearly synthetic and local, avoid public/LAN exposure where possible, and remove them afterward without deleting human content.

## Performance observations

Measure both cold/warm navigation, both themes, reduced motion, mobile/desktop geometry, and relevant zoom levels. For Matrix changes, check the persistent object identities and render clock as well as visual continuity; a screenshot alone cannot prove uninterrupted animation. Stress software rendering separately from hardware-accelerated Chromium.

Lighthouse scores, LCP/INP/CLS targets, CPU times and FPS are measurement results in a stated environment, not consequences guaranteed by SSG or OffscreenCanvas. Do not describe a handful of local runs as universal or field certification.

## Production and sensitive operations

Production checks require explicit destination/operation/session authorization. Prefer safe read-only verification; do not deploy, upload/prune R2, reset D1, purge caches, or change Access/WAF/DNS merely because a guide lists those capabilities.

For visit persistence, correlate a committed route with backend records while distinguishing SSR, SPA, cached job arrows, bfcache, prefetch, dedupe, and mock/fallback data. Check Access with an authorized owner session separately from unauthenticated denial. Do not put cookies, bearer tokens, private content, or raw visitor data in public test reports.

## Documentation-only changes

A meaningful RED/GREEN cycle does not exist for passive descriptive prose. Instead, read back every modified document, resolve relative links/source/test references, compare contracts against source, inspect changed configuration structurally, and check formatting/diff hygiene. Agent instructions and active workflow configuration deserve an independent contract check because downstream work consumes them.

Record the baseline and remaining gaps. Fixing an inaccurate description does not authorize changing the runtime behavior it describes.

## Isolated local social-image preview

`pnpm preview:local --port 4332` builds existing local content directly through Astro into ignored `dist-local/`, without package pull hooks, and serves only on loopback with a strict port. OG/Twitter image URLs use that local origin; production output and default SEO generation remain unchanged. Private admin/vault HTML is removed before serving. This is a static public-site preview, not proof of Worker routing, Access, quotas or telemetry persistence. See [local preview](local-preview.md). Preference-scroll regressions use actual visible-coordinate clicks; see [the scroll guide](preference-scroll.md).
