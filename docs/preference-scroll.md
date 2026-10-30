# Preference changes and scroll position

Changing language or theme preserves the current viewport position. Ordinary page
navigation still intentionally resets to the top.

`LanguageSwitcher.astro` owns locale links and captures their current scroll offset
at the click. Astro swaps localized content and performs its default scroll; the
switcher restores the offset on `astro:after-swap` without taking over navigation
or history. Header navigation must exclude `[data-lang-switch]` links from its
ordinary `nav_reset_scroll` handling: otherwise BaseLayout consumes that flag
after the locale restoration and moves the viewport back to the top.

Theme changes keep their existing native rounded reveal and reduced-motion
fallback. They do not need a second scroll-restoration owner.

## Browser verification

`tests/preference-scroll.spec.ts` covers both locale directions after ordinary
navigation, both theme directions, desktop/mobile viewports, reduced motion,
normal navigation resets and persistent Matrix canvas identity.

The tests click visible controls at their actual screen coordinates. Playwright's
`locator.click()` can scroll a sticky control's ancestor before `pointerdown`,
creating a viewport jump unrelated to the theme handler. Do not mistake that
automation behavior for a native theme-transition regression.

Run against an existing local server and browser:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4321 \
CHROMIUM_EXECUTABLE_PATH=/path/to/chromium \
pnpm exec playwright test tests/preference-scroll.spec.ts --workers=1
```

The saved pixel offset is constrained by the destination document's available
scroll range when translated content is shorter.
