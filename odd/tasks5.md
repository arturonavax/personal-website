# PROMPT DE EJECUCIÓN PARA TU AGENTE DE CÓDIGO (SEGURIDAD ZERO-TRUST + BYPASS DE ACTIVOS + `ev_init`)

Copia y entrega este prompt directamente a tu agente de código para aplicar las 4 capas de seguridad, optimizar `run_worker_first` y perfeccionar `ev_init` en `EdgeViewCounter.astro`:

````markdown
# ROLE & OBJECTIVE

Act as a Principal Application Security & Cloudflare Edge Performance Architect. Execute the following 5 tasks on the `personal-website` repository to guarantee airtight, fail-closed Zero-Trust authentication on `/admin`, `/:lang/admin`, `admin.arturonavax.dev`, and all admin/telemetry APIs, while bypassing Worker invocations on immutable static assets (`/_astro/*`, `/fonts/*`, etc.) and optimizing `ev_init` cookie lifecycle in `EdgeViewCounter.astro`.

---

## TASK 1: SELECTIVE `run_worker_first` GLOB ARRAY & `workers_dev: false` IN `wrangler.jsonc`

**File to modify**:

- `wrangler.jsonc`

**Instructions**:

1. Disable the public `*.workers.dev` preview endpoint in production by setting `"workers_dev": false` at the top level of `wrangler.jsonc` so all traffic must enter through the Cloudflare zone (`arturonavax.dev` / `admin.arturonavax.dev`) protected by WAF and Cloudflare Access.
2. Replace `"run_worker_first": true` inside `"assets"` with an explicit glob array that forces `cloudflare/worker.ts` to run first on all `/admin*`, `/*/admin*`, `/__admin_vault__/*`, `/api/*`, and HTML document routes, while bypassing the Worker strictly on immutable static asset paths:

```jsonc
  "workers_dev": false,
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": [
      "/admin*",
      "/*/admin*",
      "/__admin_vault__*",
      "/api/*",
      "/*",
      "!/_astro/*",
      "!/fonts/*",
      "!/remote-assets/*",
      "!/downloads/*",
      "!/favicon*",
      "!/apple-touch-icon*",
      "!/icon-*",
      "!/og-default.png",
      "!/site.webmanifest",
      "!/robots.txt",
      "!/sitemap*.xml",
      "!/llms.txt"
    ]
  }
```
````

---

## TASK 2: POST-BUILD ADMIN HTML VAULT ISOLATION (ZERO DIRECT STATIC EXPOSURE)

**Problem**: Because Astro builds `src/pages/[...lang]/admin/index.astro` into `dist/admin/index.html` and `dist/*/admin/index.html`, those files exist in the static output directory. Relocating them to an internal vault path during build guarantees that even if `run_worker_first` were ever misconfigured, Static Assets could never serve `/admin` directly.
**Files to create/modify**:

- `scripts/isolate-admin-build.mjs` (create)
- `package.json` (modify `build` script)

**Instructions**:

1. Create `scripts/isolate-admin-build.mjs` that runs immediately after `astro build`:

- Scans `dist/admin/index.html` and `dist/{en,es}/admin/index.html` (all locales in `src/i18n/locales.ts`).
- Moves each file into `dist/__admin_vault__/default/index.html` and `dist/__admin_vault__/{locale}/index.html`, then removes the empty `dist/admin` and `dist/{locale}/admin` directories.

2. Update `"build"` in `package.json` to run `node scripts/isolate-admin-build.mjs` right after `astro build`.

```javascript
// scripts/isolate-admin-build.mjs
import fs from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve(process.cwd(), "dist");
const vaultDir = path.join(distDir, "__admin_vault__");

async function moveIfExists(srcFile, destFile) {
  try {
    await fs.access(srcFile);
    await fs.mkdir(path.dirname(destFile), { recursive: true });
    await fs.rename(srcFile, destFile);
    await fs.rm(path.dirname(srcFile), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  await moveIfExists(
    path.join(distDir, "admin", "index.html"),
    path.join(vaultDir, "default", "index.html"),
  );
  for (const locale of ["en", "es"]) {
    await moveIfExists(
      path.join(distDir, locale, "admin", "index.html"),
      path.join(vaultDir, locale, "index.html"),
    );
  }
}

run().catch((err) => {
  console.error("[isolate-admin-build] Fatal error:", err);
  process.exit(1);
});
```

---

## TASK 3: FAIL-CLOSED ZERO-TRUST AUTHENTICATION & CANONICAL GUARD IN `cloudflare/worker.ts`

**Files to modify**:

- `cloudflare/worker.ts`
- `worker-configuration.d.ts`

**Instructions**:

1. **Canonical Path Normalization**: At the very top of `fetch(request, env, ctx)` in `cloudflare/worker.ts`, normalize the URL path before any route matching:

- Decode percent-encoded characters safely (`decodeURIComponent`), collapse multiple slashes (`/\/+/g` -> `'/'`), strip trailing `.html`, and evaluate a lowercase copy (`normalizedLowerPath`) so `/ADMIN`, `/Es//Admin`, or `/%61dmin/index.html` cannot bypass route guards.

2. **Block Direct External Access to `/__admin_vault__***`:

- If `normalizedLowerPath.startsWith('/__admin_vault__')`, immediately return `new Response('Not Found', { status: 404 })` so external clients can never address the internal vault path directly.

3. **Identify All Protected Admin & API Surfaces**:

- `isAdminHost`: `url.hostname.toLowerCase() === 'admin.arturonavax.dev'`
- `isAdminPage`: `isAdminHost || /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/.test(normalizedLowerPath)`
- `isProtectedApi`:
- Any route matching `/^\/api\/admin(?:\/|$)/`
- Any telemetry read/management endpoint except the public beacon `POST /api/telemetry/collect`, the public counter `GET /api/telemetry/views`, and the public lead submission `POST /api/contact`.
- Any non-GET/POST mutation or deployment registry endpoint (`/api/deployments*`, `/api/quota*`, `/api/leads*`).

4. **Cryptographic Fail-Closed Verification (`verifyAdminAccess(request, env)`)**:

- **Fail-Closed Rule**: If neither Cloudflare Access (`env.CF_ACCESS_TEAM_DOMAIN` + `env.CF_ACCESS_AUD`) nor `env.ADMIN_ACCESS_TOKEN` is configured in `env`, ALWAYS return `{ authorized: false, status: 403, reason: 'Admin authentication not configured' }`. Never allow unauthenticated fallback access.
- **Method A — Cloudflare Access JWT (`Cf-Access-Jwt-Assertion` header or `CF_Authorization` cookie)**:
- Parse JWT header, payload, and signature.
- Verify `payload.aud` includes `env.CF_ACCESS_AUD`, `payload.iss === https://${env.CF_ACCESS_TEAM_DOMAIN}`, `payload.exp > Math.floor(Date.now() / 1000)`, and (if `env.ADMIN_ALLOWED_EMAIL` is set) `payload.email === env.ADMIN_ALLOWED_EMAIL`.
- Fetch public JWKS from `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs` (cached in `caches.default` for 3600s), import the matching RSA public key (`kid`) via `crypto.subtle.importKey('jwk', ...)`, and verify the signature with `crypto.subtle.verify('RSASSA-PKCS1-v1_5', ...)`.

- **Method B — Constant-Time Bearer / Header Token (`Authorization: Bearer <token>` or `X-Admin-Token`)**:
- If `env.ADMIN_ACCESS_TOKEN` is configured (minimum length 32 chars), compare SHA-256 digests of the provided token and `env.ADMIN_ACCESS_TOKEN` using `crypto.subtle.timingSafeEqual` (or byte-by-byte XOR constant-time comparison).

- If `verifyAdminAccess` fails on any `isAdminPage` or `isProtectedApi` request:
- Return `401 Unauthorized` / `403 Forbidden` with headers `Cache-Control: private, no-store, no-cache, must-revalidate` and `X-Robots-Tag: noindex, nofollow, noarchive`.

5. **Internal Vault Rewrite for Authorized Admin Page Requests**:

- Once `verifyAdminAccess` succeeds on `isAdminPage`, extract the locale (`en` or `es`, or `default`) and fetch the HTML shell internally from `env.ASSETS.fetch(new Request(new URL(`/**admin_vault**/${localeKey}/index.html`, request.url)))` (with fallback to `env.ASSETS.fetch(request)` in local dev/test environments where `dist/__admin_vault__` has not been moved yet).
- Attach `Cache-Control: private, no-store, no-cache, must-revalidate`, `X-Frame-Options: DENY`, and `X-Robots-Tag: noindex, nofollow, noarchive` to the response.

---

## TASK 4: IMMEDIATE `ev_init` COOKIE EXPIRATION & `bfcache` SUPPORT IN `EdgeViewCounter.astro`

**File to modify**:

- `src/components/ui/EdgeViewCounter.astro`

**Instructions**:

1. In `src/components/ui/EdgeViewCounter.astro`, when `astro:page-load` runs on the initial document load and detects `ev_init=1` in `document.cookie`:

- Immediately expire the cookie so it never lingers across future reloads:
  `document.cookie = 'ev_init=; Max-Age=0; Path=/; SameSite=Lax';`
- Skip firing the duplicate client `POST /api/telemetry/collect` beacon for that initial SSR-logged load, and only fetch the current counter display if needed.

2. On all subsequent client-side `ClientRouter` navigations (`isInitialLoad === false`) AND on `window.addEventListener('pageshow', (event) => { if (event.persisted) { ... } })` (`bfcache` restoration), send the beacon to `/api/telemetry/collect` so pre-fetched and back/forward navigations are never ignored.

---

## TASK 5: SECURITY & PERFORMANCE REGRESSION TESTS

**Files to modify**:

- `tests/spec-012/seo-aeo-and-db-compaction.test.ts`
- `tests/spec-011/edge-telemetry-dedupe.test.ts`

**Instructions**:
Add unit and integration assertions verifying:

1. `wrangler.jsonc` sets `"workers_dev": false` and configures `assets.run_worker_first` as an array containing `"/admin*"`, `"/*/admin*"`, `"/api/*"`, `"!/_astro/*"`, and `"!/fonts/*"`.
2. Unauthenticated requests to `/admin`, `/es/admin`, `/en/admin`, `/ADMIN`, `/es//admin`, `/%61dmin`, `https://admin.arturonavax.dev/`, and `/__admin_vault__/default/index.html` all return `401`, `403`, or `404` and **never** invoke `env.ASSETS.fetch` for the admin HTML shell.
3. Unauthenticated requests to protected admin APIs (`/api/admin/*`, `/api/telemetry/summary`, etc.) return `401` or `403` with `Cache-Control: private, no-store`.
4. Authenticated requests (with a valid `Authorization: Bearer <ADMIN_ACCESS_TOKEN>` or verified Access JWT) to `/admin` and `/es/admin` succeed (`200 OK`) and serve the isolated admin shell with `Cache-Control: private, no-store`.
5. `EdgeViewCounter.astro` clears `ev_init` immediately (`Max-Age=0`) upon initial consumption and listens to `pageshow` (`event.persisted`).

**Validation Commands**:

```bash
pnpm run typecheck
pnpm test
pnpm run build
npx tsx scripts/audit-codebase.ts

```
