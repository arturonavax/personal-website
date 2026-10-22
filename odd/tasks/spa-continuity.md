# SPA continuity

Source specifications: `odd/tasks12.md`, `odd/tasks13.md`.
Branch: `feat/spa-continuity-tasks12-13`; delivery: single local work unit, no remote operations.
Runner: Bun unit tests, Astro check/build, architecture audit, Playwright Chromium.

## Specs

S1. "Continua todo el desarrollo para solucionar todas las tareas de @odd/tasks13.md @odd/tasks12.md"
S2. "el cual es punto es tener la mejor website multiproposito SPA de maximo rendimiento, maximo SEO, maximos core web vitals, pero sin saltos, flashes, recargas ni cortes"
S3. "usa todos los SKILL.md que necesites y MCPs. Haz todo de forma autonoma"
S4. "Sigue exactamente igual, no funciona como un SPA, el fondo matrix se recarga al navegar y los toast"

S5. "Ya los toast no se recargan al navegar, pero el fondo matrix si se reinicia y no deberia."

## Tasks

T1 | S1-S2 | inline | Verified existing implementation and repaired SPA navigation and typecheck | commit: 743d17a, 7dc94fc
T2 | S1-S3 | inline | Verified build, audit and browser continuity; qualified unmeasured performance claims | commit: 7dc94fc, 2ec858d
T3 | S4 | inline | Historical production asset/routing mismatch; not revalidated this session; needs explicitly scoped remote investigation | commit: fcf9622, evidence commit pending

T4 | S1-S2, S5 | inline | Verified locally: isolated Matrix layer, active old-snapshot suppression, live Worker/2D rendering and history | commit: e9527e0; Risk: none for scoped Matrix CSS

T5 | S1-S2 | inline | Verified locally: one desktop transition/mobile fetch, persistent document/canvas/theme and banner | commit: e9527e0; Risk: none (language links only, no listener ordering changes)

## Log

L1. /astro Continua todo el desarrollo para solucionar todas las tareas de @odd/tasks13.md @odd/tasks12.md , el cual es punto es tener la mejor website multiproposito SPA de maximo rendimiento, maximo SEO, maximos core web vitals, pero sin saltos, flashes, recargas ni cortes, usa todos los SKILL.md que necesites y MCPs. Haz todo de forma autonoma
L2. Initial status: main has 13 modified source files and untracked odd/tasks13.md from earlier work. `pnpm test`: 340 pass, 0 fail. `pnpm check`: one TypeScript error at BaseLayout.astro:805 (`pageshow` handler argument incompatible).
L3. Browser RED: `/` -> `/projects/` failed with `Element.moveBefore` invalid hierarchy, title changed but URL stayed `/`. Root cause: nested `transition:persist` on the floating-actions wrapper and PageIndexNav child. Removed the wrapper persistence required literally by tasks13; preserved both child islands and pre-swap collision state instead. Browser GREEN: six SPA routes maintain document identity, five maintain canvas identity and theme, zero page errors with settled transitions.
L4. Checks: `pnpm test` 340/0, `pnpm check` 0 diagnostics, `pnpm build` 65 pages, `bun scripts/audit-codebase.ts` PASS, Playwright SPA regression 1/1. `pnpm audit` reports 21 dependency vulnerabilities (4 low, 11 moderate, 6 high); unrelated dependency upgrades not attempted. Lighthouse field/lab scores not measured; cannot certify 100/100. Independent verifier unavailable (subagent failed once); native risk assessment unavailable (package-local binary missing).
L5. Slice boundary: fd88f80 contains the pre-existing 1953-line user specification only, kept separate from behavior; 743d17a contains Matrix, theme, banner and CSS; 7dc94fc contains shared shell navigation and its browser regression. No push or PR authorized at that point.
L6. Sigue exactamente igual, no funciona como un SPA, el fondo matrix se recarga al navegar y los toast
L7. Public Chromium RED: real header click `/` -> `/projects/` created a new document and a new Matrix worker `init`, with no `astro:before-preparation`; the live homepage does not load the `ClientRouter` script at all. Local preview GREEN: same click retained the document, one worker init and banner state. Public asset hashes differed from local build. User explicitly selected "Sí, publicar y desplegar" for this branch and production domain. Preserve unrelated pre-existing formatting changes in this file and tests/spa-continuity.spec.ts.
L8. Authorized branch push succeeded to origin/feat/spa-continuity-tasks12-13. Predeploy: 340/0 tests, 0 Astro diagnostics, zero pnpm audit findings; Wrangler --dry-run --strict --keep-vars succeeded for existing production Worker with 207 static files. First production deploy version b93a7ee2-ad9e-4844-b368-8a5d7df5d22f returned success, but public browser RED persisted: Worker served cached old HTML without ClientRouter (CF-Cache-Status: HIT) even with distinct query strings.
L9. Initial cache hypothesis: `cloudflare/worker.ts` cached public HTML in `caches.default` using stable URL keys; removed redundant HTML Cache API read/write and pinned the behavior with focused RED 0/1, GREEN 1/1. Versioned assets and API caches remain unchanged. Commit fcf9622 pushed; 341/0 tests, 0 Astro diagnostics, zero audit findings, static audit PASS, Wrangler --dry-run PASS. Second deploy version 5b422459-2b02-46c8-97c4-92ec8fc5b2f5 active, but public HTML still old; targeted purge of 62 public HTML URLs accepted, yet even CF-Cache-Status: MISS on `/projects/` returned old HTML. The Cache API hypothesis is insufficient; T3 remains open.
L10. User explicitly authorized full-zone Cloudflare cache purge despite temporary cache-hit/performance impact; dry-run validated the exact purge request. Full-zone purge accepted, but `/`, `/projects/` and `/es/` still lack ClientRouter in public HTML. Live browser proof remains RED. This is not complete: the active Worker version and uploaded assets disagree with the public HTML being served. Stop further deployment/purge loops; resolve Cloudflare asset/routing authority before another mutation.

L11. User request (verbatim):

```text
$astro Continua todo el desarrollo para solucionar todas las tareas de odd/tasks13.md  odd/tasks12.md  , el cual
 es punto es tener la mejor website multiproposito SPA de maximo rendimiento, maximo SEO, maximos core web vitals,
 pero sin saltos, flashes, recargas ni cortes, usa todos los SKILL.md que necesites y MCPs. Haz todo de forma
 autonoma. Ya los toast no se recargan al navegar, pero el fondo matrix si se reinicia y no deberia.
```

L12. Resumed with read-only mapping worker; implementation remains inline (one scoped behavior, no writer trigger). Existing test formatting preserved. Local production preview real header navigation records exactly one Worker init, no resize/theme resets, but computed Matrix view-transition-name is none: Matrix snapshot isolation rules are inactive. T3 remote production state remains historical/unverified; this request does not authorize remote credentials, deployments or purges.

L13. Matrix RED: all four Worker/2D × atomic/fallback browser variants fail computed layer name (none). Scoped CSS correction assigns matrix-background and hides old Matrix snapshots; all four pass, with actual transition.ready sampling, evolving canvas bitmap and one Worker init. Existing route/theme test also passes across eight routes.
L14. Expanded real language-click regression exposes a pre-existing race: /es/ -> / starts two View Transitions, from ClientRouter and LanguageSwitcher, producing "Transition was skipped. New ViewTransition started". Waiting for theme completion does not fix it. Read-only explorer and browser stack traces independently identify both owners. Exclude desktop/mobile language links from Astro interception via data-astro-reload; existing preventDefault custom handler retains SPA switching, scroll and canvas. No new runtime JavaScript.

L15. Final checks: 7/7 Playwright Chromium tests, including Worker/2D × atomic/fallback DOM movement with real header clicks, active transition.ready layer inspection, evolving bitmaps, one Worker init and history; banner identity/position/counterpart href/dismissal; one mobile language fetch; eight SPA routes with light theme and a real desktop locale switch issuing exactly one transition. No page errors. Earlier expanded test failed on the language race twice, including after waiting for theme cleanup; no errors were filtered or suppressed in the route test.
L16. Final local functional proof: bun test 341 pass/0 fail; Astro check 123 files/0 diagnostics; architecture audit PASS; check-only formatting PASS; local Astro build plus admin vault isolation 65 pages. Used Astro CLI directly to avoid pnpm prebuild R2 credential access. Native assessment: medium, review_due=false, under_budget (268 changed lines); no review ceremony or approval fabricated.
L17. Remaining proof: production T3 remains unresolved and was not accessed, deployed or purged this session; no current remote authorization inferred from history. Lighthouse binary is not installed; 100/100 lab scores, real-user CWV and universal 120 FPS remain unmeasured, not certified. Matrix intentionally renders around 22 FPS independently of display refresh. No new runtime JavaScript/dependencies. Current work unit is under 400 authored lines; no push or PR.

L18. Work unit committed as e9527e0 (fix(spa): isolate live matrix and language navigation), including tests and task log. Committed-range native assessment against 50594ec: medium, 272 lines, review_due=false/under_budget. Parent spot-check architectural audit PASS; clean tracked tree after commit. Rollback boundary is the Matrix layer CSS, three language-link exclusions and their regression tests; no Worker lifecycle, deployment or dependencies changed. Production and performance proof remain pending, so this feature is not globally complete.
