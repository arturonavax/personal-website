# Workflow documentation and package scripts

Branch: `feat/workflow-docs-and-scripts`, based on local `main` at `569d6d4`.
Scope: reconcile current guides/instructions with integrated changes, then simplify package workflows without remote operations or unrelated worktree edits.

## Specs

S1. "Continua, y al finalizar actualiza todas las documentaciones, memoria en engram y AGENTS.md con todo lo relevante que haya cambiado."
S2. "Al finalizar vas a refactorizar el @package.json para que los scripts esten prolijos, solo los que realmente se necesitan y formen parte de un workflow escalable y profesional, y los necesarios para build, y vuelve a actualiza toda documentacion necesaria."
S3. "Hazlo todo directo y sin tantos procesos de verificacion para no gastar tantos tokens."

## Tasks

T1 [S1] route inline, in progress; commit pending — reconcile current documentation and `AGENTS.md` with integrated Obsidian/R2, bounded telemetry, Search Console evidence and local merge state.
T2 [S2] route inline, pending; commit pending — simplify only evidenced redundant package scripts, preserve required build/deployment and explicit-publication paths, update their current command guides.
T3 [S1-S3] route inline, pending; commit pending — run proportional structural and focused checks, record results/limits and update the Engram mirror without remote side effects.

## Log

L1 (user original request verbatim): Continua, y al finalizar actualiza todas las documentaciones, memoria en engram y AGENTS.md con todo lo relevante que haya cambiado. Al finalizar vas a refactorizar el @package.json para que los scripts esten prolijos, solo los que realmente se necesitan y formen parte de un workflow escalable y profesional, y los necesarios para build, y vuelve a actualiza toda documentacion necesaria. Hazlo todo directo y sin tantos procesos de verificacion para no gastar tantos tokens.
L2: Local `main` and the integrated branch point to `569d6d4`; `origin/main` remains at `b461557`. The new feature branch preserves unrelated `.gitignore`, `odd/tasks/edge-telemetry-coverage.md`, `odd/tasks/obsidian-r2-telemetry-workflow.md` edits and untracked `test-results/`. Source already documents Obsidian staging/backup and bounded telemetry in their current guides, but `README.md`, `AGENTS.md`, `docs/verification.md`, `docs/security.md`, `docs/frontend-redesign.md` and the current spec index still mention obsolete synthetic telemetry fallback; `README.md` also wrongly suggests `dev-prod` can pull R2. The 2026-10-23 SEO audit is historical; the bounded 2026-10-26 Search Console work is in `odd/tasks/search-console-indexation.md`. No production verification, upload, migration or deployment was authorized.
