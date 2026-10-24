import { expect, test, type Locator, type Page } from "@playwright/test";

type PreferenceWindow = Window & {
  __preferenceCanvas?: HTMLElement | null;
  __isLangSwitching?: boolean;
};

// Bun discovers browser suites too; only Playwright executes these cases.
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  }
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8788";

  async function clickVisible(page: Page, control: Locator) {
    await expect(control).toBeVisible();
    await expect
      .poll(async () => {
        const rect = await control.boundingBox();
        return (
          rect !== null &&
          rect.y >= 0 &&
          rect.y + rect.height <= page.viewportSize()!.height
        );
      })
      .toBe(true);
    const bounds = await control.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    // Locator.click() may scroll a sticky ancestor before delivering pointerdown.
    await page.mouse.click(
      bounds!.x + bounds!.width / 2,
      bounds!.y + bounds!.height / 2,
    );
  }

  for (const mobile of [false, true]) {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      test(`${mobile ? "mobile" : "desktop"} ${reducedMotion} preference changes retain scroll after navigation`, async ({
        page,
      }) => {
        await page.setViewportSize(
          mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        );
        await page.emulateMedia({ reducedMotion });
        await page.goto(base, { waitUntil: "networkidle" });
        await page.evaluate(() => {
          (window as PreferenceWindow).__preferenceCanvas =
            document.getElementById("matrix-canvas");
        });
        const menu = page.locator("#mobile-nav-details summary");
        async function openMenu() {
          if (mobile) await clickVisible(page, menu);
        }
        await page.evaluate(() => scrollTo(0, 700));
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(700);
        await openMenu();
        await clickVisible(
          page,
          page
            .locator(
              mobile
                ? '#mobile-nav-details a[href="/experience/"]'
                : 'header a[href="/experience/"]',
            )
            .first(),
        );
        await page.waitForURL("**/experience/");
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
        await page.waitForTimeout(250);

        for (const locale of ["es", "en"]) {
          await page.evaluate(() => scrollTo(0, 700));
          await expect.poll(() => page.evaluate(() => scrollY)).toBe(700);
          await openMenu();
          if (mobile) {
            // The compact menu owns an independent overflow area.
            await page.locator("#mobile-nav-details nav").evaluate((nav) => {
              nav.scrollTop = nav.scrollHeight;
            });
          }
          await clickVisible(
            page,
            page
              .locator(`header [data-lang-switch="${locale}"]:visible`)
              .first(),
          );
          await page.waitForURL(
            locale === "es" ? "**/es/experience/" : "**/experience/",
          );
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          await page.waitForFunction(
            () => !(window as PreferenceWindow).__isLangSwitching,
          );
          expect(await page.evaluate(() => scrollY)).toBe(700);
          expect(
            await page.evaluate(
              () =>
                document.getElementById("matrix-canvas") ===
                (window as PreferenceWindow).__preferenceCanvas,
            ),
          ).toBe(true);

          // Both theme directions are exercised in each locale and motion mode.
          for (let direction = 0; direction < 2; direction++) {
            const previous = await page
              .locator("html")
              .getAttribute("data-theme");
            await clickVisible(page, page.locator("#theme-toggle"));
            await expect(page.locator("html")).toHaveAttribute(
              "data-theme",
              previous === "dark" ? "light" : "dark",
            );
            await expect(page.locator("html")).not.toHaveClass(
              /theme-transitioning/,
            );
            expect(await page.evaluate(() => scrollY)).toBe(700);
            expect(
              await page.evaluate(
                () =>
                  document.getElementById("matrix-canvas") ===
                  (window as PreferenceWindow).__preferenceCanvas,
              ),
            ).toBe(true);
          }
        }
      });
    }
  }
}
