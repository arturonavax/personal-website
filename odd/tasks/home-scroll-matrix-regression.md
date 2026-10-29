# Home scroll and Matrix regression

Branch: `fix/home-scroll-matrix-regression`. Scope: local rendering and evidence; no push or deployment.

## Specs

1. S1 — "El downgrade de la animacion de fondo no tuvo ningun efecto en la visualizacion de esta maquina, refina el detector de fallos graficos o algo asi, ya que incluso el scroll ahora se ve mas trabado"
2. S2 — "(El peor problema de rendimiento se ve es en la pagina principal)"
3. S3 — "Portada y detector (recomendado)" — "Investigar y corregir la pausa de Layout de Experience; verificar scroll y carga inicial, además del detector."

## Tasks

- [x] T1 (S1; inline; commit: d2e5e58) Reproduce and refine the Matrix scroll detector with focused regression and route benchmarks.
- [x] T2 (S2-S3; inline; commit: d1540dc) Identify and address home Experience layout pause without breaking navigation, content, or initial loading.
- [x] T3 (S1-S3; inline; commit: d1540dc) Run focused/full checks and local hardware comparisons, then record bounded evidence and close.

## Log

- L1 — El downgrade de la animacion de fondo no tuvo ningun efecto en la visualizacion de esta maquina, refina el detector de fallos graficos o algo asi, ya que incluso el scroll ahora se ve mas trabado
- L2 — (El peor problema de rendimiento se ve es en la pagina principal)
- L3 — Portada y detector (recomendado) — Investigar y corregir la pausa de Layout de Experience; verificar scroll y carga inicial, además del detector.
- L4 — Baseline on local headful Chromium NVE4/Mesa: /projects/ Matrix active p95 ~33 ms versus ~17 ms disabled with p75 ~17 ms in both; homepage experienced a main-thread Layout task ~150 ms in the Experience region even with Matrix disabled. These are local observations, not physical-display FPS or production proof.
- L5 — T1 RED: `bun test tests/matrix-quality.test.ts` failed the spaced-miss regression; GREEN: 20/20 focused Bun tests, `pnpm check && pnpm test && pnpm exec astro build` passed. The postbuild NVE4 trial reached quality level 1 on `/projects/` but not `/`; a single homepage rAF sample showed p95 ~33 ms with Matrix both on and off. No measured homepage win is claimed for T1. Commit `d2e5e58`.
- L6 — T2 RED: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8788 pnpm exec playwright test tests/home-experience-scroll.spec.ts --workers=1 --reporter=line` failed because the section was still `content-visibility: auto`; GREEN: build and 4/4 home/mobile-Spanish/experience-detail browser checks passed. Two serial NVE4 CSS A/B traces without Matrix reduced the largest Experience-region Layout from 135 to 107 ms and from 79 to 11 ms; another pair of scroll samples reduced >24 ms gaps from 6 to 1 and from 1 to 0. A second CSS-initial-load comparison gave 3 to 2 missed frames across two runs and did not show a consistent FCP/LCP regression, but still had an ~100 ms maximum stall. Evidence is local and variable; no physical-display FPS guarantee. Commit `d1540dc`.
- L7 — Final `pnpm check && pnpm test && PLAYWRIGHT_BASE_URL=http://127.0.0.1:8788 pnpm exec playwright test tests/home-experience-scroll.spec.ts tests/experience-surfaces.spec.ts tests/spa-continuity.spec.ts --workers=1 --reporter=line` passed (17/17 browser checks). Native committed-range ASSESS for `d1540dc` returned medium, `reviewDue=false` (`under_budget`), and no independent verifier; no new native review started. Initial ASSESS was unassessable only because Playwright's generated `test-results/.last-run.json` was untracked; it was removed after confirming it contained only this run's summary, then ASSESS succeeded. Production display smoothness, other browsers and field performance remain unverified; one local ~100 ms layout stall can still occur.
