# Task Plan: Convert Specs to 100% ODD Workflow

## Overview
Convert the 7 hybrid SPEC files (SPEC-001 to SPEC-007) from a mixed SDD/RDD/ODD methodology to a pure Organic/Operational-Driven Development (ODD) workflow. Goal: eliminate the SDD/RDD hybrid layer, standardize only ODD phases, and optimize token efficiency.

## Sub-tasks

1. **Create odd/convert-specs/README.md** — Document the ODD flow standardization across all specs (author → explore → resolve → classify → track → implement → check → close).
2. **Update SPEC-001 headers/methodology** — Replace Tri-Axis Model reference with ODD-only phase flow; preserve all REQ/VAL and technical content.
3. **Update SPEC-002 headers/methodology** — Same: replace SDD/RDD reference with ODD phases; preserve all REQ-01 to REQ-12 and VAL-01 to VAL-12.
4. **Update SPEC-003 headers/methodology** — Replace SDD/RDD with ODD; preserve all REQ-EDGE-01 to REQ-EDGE-08 and VAL-*.
5. **Update SPEC-004 headers/methodology** — Replace SDD/RDD with ODD; preserve all audit logic and DoD matrix.
6. **Update SPEC-005 headers/methodology** — Replace SDD/RDD with ODD; preserve all performance and content delivery invariants.
7. **Update SPEC-006 headers/methodology** — Replace SDD/RDD with ODD; preserve all UX editorial refinements.
8. **Update SPEC-007 headers/methodology** — Replace SDD/RDD with ODD; preserve all frontend stability and UX polish.
9. **Verify all odd/ files exist and are consistent** — Run final check: every spec heading has ODD reference only, no SDD/RDD hybrid language remains in methodology sections.

## Definition of Done (DoD)
- All 7 SPEC files have methodology section referencing only ODD phases (no SDD/RDD).
- `odd/convert-specs/tasks.md` has all 9 tasks marked as done.
- No technical content (REQ, VAL, code blocks, schemas) was removed or altered.
- All `odd/` directory structure follows the established pattern (no nested hybrids).
## Execution Log
- [done] Created `odd/convert-specs/README.md` (ODD flow standard)
- [done] Created `odd/convert-specs/tasks.md` (9 sub-tasks defined before any edit)
- [done] Updated SPEC-001 (YAML + 1.2 section)
- [done] Updated SPEC-002 (YAML + 1.2 section)
- [done] Updated SPEC-003 (YAML + 1.2 section)
- [done] Updated SPEC-004 (YAML + 1.2 section)
- [done] Updated SPEC-005 (YAML + 1.3 section)
- [done] Updated SPEC-006 (YAML + 1.3 section)
- [done] Updated SPEC-007 (added 1.1 ODD method, no hybrid block present)
- [done] Verified all 7 specs have `methodology: Organic/Operational-Driven Development (ODD)`; zero Tri-Axis references remain in methodology sections; all `REQ-*`, `VAL-*`, code blocks, schemas preserved.
