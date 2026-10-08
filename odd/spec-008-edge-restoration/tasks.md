# Task Plan: SPEC-008 Edge Architecture Restoration & Anti-Regression Invariants

## Root Cause Analysis — Destructive Re-Architecture Overwrites & Cascade Failure

1. **Initial Flawed Re-Architecture**:
   - A generic "10-step" re-architecture prompt executed blind `OVERWRITE entire file` operations over 10 core files.
   - It forced `@astrojs/cloudflare` adapter into a pure SSG codebase (`output: 'static'`), breaking output directories (`dist/client` vs `dist`) and creating 404 errors.
   - It modified `wrangler.jsonc` by removing `run_worker_first: true`, breaking binding names (`STORAGE_BUCKET`, `VECTORIZE_INDEX`), and setting `not_found_handling: "single-page-application"`.
   - It stripped CSP rules in `public/_headers` (breaking SPEC-006 tests).
   - It replaced the Hexagonal edge router `cloudflare/worker.ts` with a primitive script, losing subdomain canonicalization (308), admin isolation (308), prefetch shielding (204), and fail-open search fallback.

2. **Secondary Damage via `odd/tasks.md`**:
   - In attempting to patch the 404s caused by the adapter, subsequent steps wiped out `Header.astro` (from 1118 lines to 150 lines), `ExperienceTimeline.astro` (replaced with hardcoded mockups), `resume/maker.astro` (editor replaced with a dummy button), and `MatrixBackground.astro`.

3. **Restoration Strategy**:
   - Pin baseline to the last verified, 100% healthy commit: `fb10674d5412ec18278b99b105d2e482d15a2212`.
   - Restore all components, layouts, and edge configurations to their rich, verified implementations.
   - Formalize SPEC-008 in `openspec/specs/SPEC-008-edge-performance-re-architecture-restoration.md` and add to `AGENTS.md`.
   - Standardize `package.json` dev script to use `wrangler dev` with Workers Static Assets.
   - Verify quadruple gates: Bun test (140/140), static audit script, Astro check, and static build (63 pages).

## Sub-tasks

1. [x] **Forensic Codebase Analysis**: Use Git history and diffs to trace exact regressions from `fb10674d5412ec18278b99b105d2e482d15a2212`.
2. [x] **Preserve Backup**: Stash and branch backup of corrupted state (`backup-corrupted-state`).
3. [x] **Restore Pure SSG State**: Align workspace to `fb10674d5412ec18278b99b105d2e482d15a2212`.
4. [x] **Author SPEC-008**: Create formal OpenSpec document covering the diagnosis, architecture, and anti-regression invariants.
5. [x] **Update AGENTS.md**: Register SPEC-008 in the specifications matrix.
6. [x] **Update Dev Scripts**: Update `package.json` to use native `wrangler dev` for Workers Static Assets.
7. [x] **Execute Verification Gates**: Run `bun test`, `bun scripts/audit-codebase.ts`, `pnpm check`, `pnpm build`.

## Definition of Done (DoD)

- [x] All 140 unit tests pass in `bun test` across 6 test suites.
- [x] All architectural static gates pass in `bun scripts/audit-codebase.ts`.
- [x] Zero errors, warnings, or hints in `pnpm check` (107 files verified).
- [x] Pure static build completes successfully (`pnpm build`, 63 pages in `./dist`).
- [x] Rich UI preserved: 1118-line Header, ATS Resume Maker Studio, responsive timeline, Matrix persistence.
- [x] Cloudflare edge worker operates with Hexagonal Architecture and fail-open resilience.
