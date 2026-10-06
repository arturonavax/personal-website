# Task Plan: SPEC-007 Print PDF CV Fixes

## Root Cause Analysis — Pixelized Print PDF in /resume/maker/

**Actual defect**: The `preview.innerHTML = marked.parse(...)` injects `.progressive-reveal` on `#resume-live-preview`. That class runs `animation: progressiveContentFade` which applies `filter: blur(8px)` + `transform: translateY(6px)` + `opacity: 0`. When Chrome/Firefox print to PDF, compositor-layer content with active filters/transforms gets **rasterized to an image layer** instead of kept as selectable vector text — hence non-selectable, pixelated output. `/resume/` never gets `.progressive-reveal`, so it stays pure vector.

**Fix applied**:
- `global.css`: `@media print` overrides `.progressive-reveal` (animation/filter/transform/opacity → none/1).
- `maker.astro`: `classList.remove("progressive-reveal")` before `window.print()` + restore after `afterprint`; `setTimeout(...,70)` delay to allow full render; expand height/overflow temporarily. Added `-webkit-print-color-adjust: exact`, `image-rendering: auto`, font-smoothing.
- `global.css`: Added `#resume-live-preview a` and `user-select: text` to print link selectors.

1. **PDF Resolution Quality**: `/resume/maker/` Print PDF CV must render at the same visual quality as `/resume/` Print PDF CV.
2. **Link Underline in Print**: Clickable links in Print PDF CV must NOT show underline unless explicitly specified.
3. **Text Selectability**: All text inside Print PDF CV must be natively selectable (no virtual text, no canvas-rendered text).

## Sub-tasks

1. **Explore current state** — Read `/resume/index.astro`, `/resume/maker.astro`, `global.css`, `resume.css` to understand current print rendering differences.
2. **Fix PDF resolution in maker** — Ensure `#resume-live-preview` in maker matches `#cv-document-sheet` in `/resume/` for print output.
3. **Remove link underline in print** — Add CSS rule to suppress default link underline in `@media print` blocks.
4. **Verify text selectability** — Ensure no `user-select: none` or canvas-based text rendering in print paths.
5. **Run tests** — Execute `pnpm test tests/spec-007/spec-007.test.ts` and verify all pass.

## Definition of Done (DoD)
- [x] Fixed print resolution quality: Added `setTimeout` delay (70ms) + full-height expansion before `window.print()` in `maker.astro` to prevent low-DPI rasterization of overflowed content.
- [x] Added print-quality CSS: `-webkit-print-color-adjust: exact`, `print-color-adjust: exact`, `image-rendering: auto`, `text-rendering: optimizeLegibility`, font-smoothing to `#resume-live-preview` inline print CSS and to document sheet selectors in `global.css`.
- [x] Link underline removed in print (`#resume-live-preview a` + `text-decoration: none !important`).
- [x] Text selectability (`user-select: text !important` added to print link selectors in `global.css`).
- [x] Tests: `pnpm test tests/spec-007/spec-007.test.ts` → **29 pass, 0 fail**.
- [x] Build: `bun run build` → **Success**.