# ODD Flow Standardization — Specs 001–007

## Standard Methodology (ODD Only)

Every spec follows the single Organic/Operational-Driven Development pipeline:

1. Authorize (scope / constraints / decision)
2. Explore (code + requirements — use CodeGraph, `.agents/skills/`)
3. Resolve Uncertainty (research only if named; ask one focused question; stop)
4. Classify (substantial vs. small; create `odd/<feature>/tasks.md` before first write)
5. Track (update `todo` + feature doc; work-unit commit per task)
6. Implement (test-first when deterministic; build-time computation; zero-fluff output)
7. Check (build `bun run check`, audit `scripts/audit-codebase.ts`, verify Core Web Vitals gates)
8. Close (verified outcome; record failed/skipped checks; save memory if key decision)

No SDD (Spec-Driven) or RDD (Requirement-Driven) hybrid layer remains in method sections.

## Token-Saving Rules

- Preserve all `REQ-*`, `VAL-*`, `DoD`, code blocks, schema definitions exactly.
- Only replace the methodology paragraph + diagram references (Tri-Axis) with ODD phase ordering.
- Do not duplicate technical content — reference existing spec content by file, not inline.
