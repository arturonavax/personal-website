import { expect, test } from "@playwright/test";

// Bun discovers browser suites too; only Playwright executes these cases.
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  }
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8788";

  for (const locale of ["/", "/es/"]) {
    for (const mode of ["manual", "top"] as const) {
      test(`${locale} clears contact when it leaves the viewport during ${mode} scrolling`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`${base}${locale}?scroll-test=1`, {
          waitUntil: "networkidle",
        });
        await page
          .locator('header a[data-nav-section="contact"]')
          .first()
          .click();
        await page.waitForFunction(() => !(window as any).__isProgrammaticNav);
        await expect(
          page.locator('[data-nav-section="contact"][aria-current]').first(),
        ).toBeAttached();
        await page.evaluate(() => {
          history.replaceState(
            { retained: "viewport" },
            "",
            `${location.pathname}${location.search}#contact`,
          );
        });
        const historyLength = await page.evaluate(() => history.length);
        await page.evaluate(() =>
          scrollTo({
            top:
              document.getElementById("contact")!.getBoundingClientRect().top +
              scrollY -
              innerHeight +
              20,
            behavior: "instant",
          }),
        );
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document.getElementById("contact")!.getBoundingClientRect().top,
            ),
          )
          .toBeGreaterThan(800);
        expect(await page.evaluate(() => location.hash)).toBe("#contact");
        // Pause above Contact but well short of the top. This also models an
        // interrupted smooth Top scroll while its programmatic guard is set.
        await page.evaluate((mode) => {
          const originalScrollTo = window.scrollTo.bind(window);
          const leaveContact = () =>
            originalScrollTo({
              top:
                document.getElementById("contact")!.getBoundingClientRect()
                  .top +
                scrollY -
                innerHeight -
                100,
              behavior: "instant",
            });
          if (mode === "top") window.scrollTo = leaveContact;
          else leaveContact();
        }, mode);
        if (mode === "top") await page.locator("#back-to-top-btn").click();
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document.getElementById("contact")!.getBoundingClientRect().top,
            ),
          )
          .toBeGreaterThan(900);
        await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
        expect(await page.evaluate(() => scrollY)).toBeGreaterThan(400);
        await expect(
          page.locator('[data-nav-section="about"][aria-current]').first(),
        ).toBeAttached();
        expect(
          await page.evaluate(() => ({
            query: location.search,
            state: history.state,
            length: history.length,
          })),
        ).toMatchObject({
          query: "?scroll-test=1",
          state: { retained: "viewport" },
          length: historyLength,
        });
      });
    }
    for (const reducedMotion of ["reduce", "no-preference"] as const) {
      test(`${locale} contact to top synchronizes URL and menu (${reducedMotion})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ reducedMotion });
        await page.goto(`${base}${locale}?top-test=1`, {
          waitUntil: "networkidle",
        });
        for (let repeat = 0; repeat < 2; repeat++) {
          await page
            .locator('header a[data-nav-section="contact"]')
            .first()
            .click();
          await expect
            .poll(() => page.evaluate(() => scrollY))
            .toBeGreaterThan(400);
          await page.waitForFunction(
            () => !(window as any).__isProgrammaticNav,
          );
          await page.evaluate(() => {
            history.replaceState(
              { retained: "state" },
              "",
              `${location.pathname}${location.search}#contact`,
            );
          });
          await expect(
            page.locator('[data-nav-section="contact"][aria-current]').first(),
          ).toBeAttached();
          const historyLength = await page.evaluate(() => history.length);
          await page.locator("#back-to-top-btn").click();
          await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(2);
          await expect(page).toHaveURL(`${base}${locale}?top-test=1`);
          await expect(
            page.locator('[data-nav-section="about"][aria-current]').first(),
          ).toBeAttached();
          await expect(
            page.locator('[data-nav-section="contact"][aria-current]'),
          ).toHaveCount(0);
          expect(
            await page.evaluate(() => ({
              state: history.state,
              length: history.length,
            })),
          ).toMatchObject({
            state: { retained: "state" },
            length: historyLength,
          });
        }
      });
    }
  }

  test("non-home route retains its active menu section", async ({ page }) => {
    await page.goto(`${base}/experience/`, { waitUntil: "networkidle" });
    await page.evaluate(() =>
      scrollTo({ top: document.body.scrollHeight, behavior: "instant" }),
    );
    await page.locator("#back-to-top-btn").click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(2);
    await expect(
      page.locator('[data-nav-section="experience"][aria-current]').first(),
    ).toBeAttached();
    await expect(page).toHaveURL(`${base}/experience/`);
    // The persisted button must still reconcile a newly swapped home page.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('header a[data-nav-section="about"]').first().click();
    await expect(page).toHaveURL(`${base}/`);
    await page.locator('header a[data-nav-section="contact"]').first().click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(400);
    await page.waitForFunction(() => !(window as any).__isProgrammaticNav);
    await page.locator("#back-to-top-btn").click();
    await expect(page).toHaveURL(`${base}/`);
    await expect(
      page.locator('[data-nav-section="about"][aria-current]').first(),
    ).toBeAttached();
  });
}
