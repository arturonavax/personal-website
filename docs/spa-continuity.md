# Continuous SPA rendering

The Matrix canvas and Worker persist across Astro routes and custom experience timeline navigation. Keep the independent render clock: route loading must not reset phases, replace the canvas or pause the Worker.

## Rendering invariants

- Shared Worker/2D renderer: fractional-pixel falling trains, changing symbols, separated glyphs and dynamic fading tails.
- Depth fonts: 18/21/24/28px with proportional cell spacing. Cache both theme palettes before interaction.
- Pointer lens: radius 360px; its center eases toward the latest pointer target using a 300ms time constant, identical at 60/120Hz.
- Live viewport/DPR changes update backing geometry without discarding existing lanes or restarting time.
- Native theme reveal: equivalent rounded-inset circular keyframes, 420ms duration, original easing, zero-radius prepaint protection, fill-both and one cleanup notification.

## Evidence and limits

The accepted local iteration passed 374 Bun tests, 17 Chromium integration tests, Astro check, 65-page build and architecture audit. Matched local default/software Chromium traces showed about 9–10% less raster work with rounded-inset clipping than circle clipping; median rAF cadence remained 16.7ms. These are not universal physical-display FPS or field Core Web Vitals guarantees.

Relevant regressions: `tests/matrix-rain.test.ts`, `tests/matrix-worker.test.ts`, `tests/matrix-zoom.spec.ts`, `tests/theme-clip.test.ts`, `tests/spa-continuity.spec.ts` and `tests/matrix-software.spec.ts`. The Worker HTML pipeline must preserve ClientRouter scripts and transition metadata; a local canvas test alone cannot prove production SPA delivery.
