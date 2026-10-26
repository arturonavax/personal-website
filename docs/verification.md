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

A missing test is a coverage gap, not evidence that the implementation is absent. A historical PASS is dated evidence, not a current certification. `/api/telemetry` does not synthesize visits: an empty result is observed zero data, while missing/failed D1 and quota-protected reads return 503 unavailable/degraded. Cached UI data, estimated quota panels and a queued collector response still cannot establish production persistence. The [integration record](../odd/tasks/integrated-feature-test.md) keeps the unauthenticated Worker-admin 401 browser failure distinct from its passing isolated Astro admin UI check; the owner subsequently accepted the local integration without further agent tests.

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

## Package workflow boundaries

`package.json` groups local development (`dev`, `dev:local`, `dev:r2`, `dev:worker`, `dev-prod`), build and explicit deployment (`prebuild`, `build`, `preview`, `predeploy`, `deploy`), checks, content/CV publication, asset maintenance and local D1 setup. The build/deploy hook commands are unchanged: `pnpm build` and `pnpm deploy` may hydrate remote content, and `deploy` is a remote mutation. `dev-prod` alone selects the offline local build path. Do not use a remote command to validate a script inventory.

The duplicate `typecheck` alias, repository-wide `format`/`format:check` shortcuts, unpinned `audit:mobile` wrapper, Cloudflare JSD shortcut and remote D1 schema/reset aliases have been retired. Run the already documented `pnpm check` for diagnostics and `pnpm exec prettier --write <changed-files>` or `--check <changed-files>` only on intended files. A mobile performance audit needs its own pinned runner and environment; remote account settings or D1 migrations/resets need separate, exact authorization rather than a convenience alias. These removals do not delete the underlying maintenance scripts or grant authority to execute them.

## Local-content build without the pull hook

`CONTENT_SOURCE=local` is not an offline guarantee. `scripts/r2-pull.mjs --auto` forces a freshness pull for any truthy `CI`, `CF_PAGES`, `CLOUDFLARE_BUILD`, or `GITHUB_ACTIONS`; missing content can also trigger remote transfer. The value `"false"` is still a truthy environment string. `pnpm build` invokes that automatic prebuild hook.

When R2 access is not authorized, use the installed Astro CLI directly with valid existing local content:

```sh
pnpm exec astro check
pnpm exec astro build
node scripts/isolate-admin-build.mjs
```

These commands bypass the package `prebuild` content-pull hook. They do not hydrate missing files or grant permission for any other network dependency referenced by project content. `pnpm dev-prod` explicitly selects the no-pull local custom-build branch and local bindings. Deployment and ordinary Wrangler invocations retain the hydration branch; they are not offline commands.

## Local browser/Worker harness

The usual production-like entry point is:

```sh
# Uses existing local content; no R2 pull. Missing content must be hydrated separately.
pnpm run dev-prod
```

This runs Astro diagnostics, then Wrangler owns one static build and admin-vault isolation before serving on port 8788. `SITE_LOCAL_BUILD=1` is command-scoped, and `--env local --local` selects explicitly local D1/R2 bindings. AI, Vectorize and email delivery are not emulated in this environment; production configuration is unchanged. `dev-prod` binds to `0.0.0.0` for LAN testing on port 8788; use a trusted network. `pnpm dev:local` on port 4321 is useful for presentation but is not a substitute for Worker routing/auth/telemetry behavior. Local D1/R2 state must be prepared separately as documented by the [edge contract](../openspec/specs/current-edge-operations.md); do not use a remote database reset to prepare tests.

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

## Inspecting social cards locally

Use `pnpm run dev-prod`, then open `http://localhost:8788/og/index.png`, `/og/es/index.png` or `/og/experience/<slug>/index.png`. This requests existing static PNGs directly; emitted production OG URLs intentionally retain the canonical production origin. No alternate output directory, preview-origin override or extra preview server is needed. Build output and generated PNGs stay ignored.

The NOSENTRY/Cap’n Proto `incoming RPC message exceeds size limit` warning is a local runtime IPC error, not an OG image-size validation message. Do not hide it or increase arbitrary limits. Record startup/request/shutdown timing and correlated failed responses before attributing a cause; a related upstream report is [workerd#7401](https://github.com/cloudflare/workerd/issues/7401), not proof of identical cause in this application.

The installed Wrangler 4.151.3 / workerd 1.20261019.1 reproduced that warning with a minimal Worker plus the full binding configuration. Minimal configs with locally supported assets, traces and storage started cleanly. The dedicated `local` environment omits remote-only AI/Vectorize initialization rather than suppressing the diagnostic. Their individual causal responsibility was not proven; no runtime limit or production observability setting was changed. Verify API fallbacks locally, and test actual AI/search/email services separately only with explicit remote authorization.
