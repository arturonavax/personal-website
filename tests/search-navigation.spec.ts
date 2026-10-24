import { expect, test } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH)
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8788";

  test("search retains its working controls across route and language swaps", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let indexRequests = 0;
    await page.route("**/search-index.json", async (route) => {
      indexRequests++;
      await route.fulfill({
        json: {
          en: [
            {
              id: "fixture-en",
              entityId: "fixture",
              title: "Fixture distributed systems",
              description: "Fixture search result",
              type: "experience",
              url: "/experience/",
              tags: ["Fixture"],
              locale: "en",
            },
          ],
          es: [],
        },
      });
    });
    await page.goto(base, { waitUntil: "networkidle" });
    const input = page.locator("#universal-search-input");
    const results = page.locator("#search-results-list a[data-search-item]");
    await page.locator("#header-search-btn").click();
    await input.fill("Fixture");
    await expect(results).toHaveCount(1);
    await page.evaluate(() => {
      (
        window as Window & { __searchTestDialog?: Element | null }
      ).__searchTestDialog = document.getElementById("search-dialog");
      (
        window as Window & { __searchTestInput?: Element | null }
      ).__searchTestInput = document.getElementById("universal-search-input");
    });
    await page.keyboard.press("Escape");
    for (const section of ["experience", "about", "experience"]) {
      await page
        .locator(`header a[data-nav-section="${section}"]`)
        .first()
        .click();
      await expect(page).toHaveURL(
        section === "about" ? `${base}/` : `${base}/experience/`,
      );
      await page.locator("#header-search-btn").click();
      await input.fill("Fixture");
      await expect(results).toHaveCount(1);
      expect(
        await page.evaluate(
          () =>
            (window as Window & { __searchTestDialog?: Element | null })
              .__searchTestDialog === document.getElementById("search-dialog"),
        ),
      ).toBe(true);
      await input.press("ArrowDown");
      await expect(results.first()).toHaveClass(/ring-1/);
      await expect(input).toBeFocused();
      await page.locator("#clear-search-btn").click();
      await expect(input).toHaveValue("");
      await page.locator("#close-search-btn").click();
      await expect(page.locator("#search-dialog")).not.toBeVisible();
    }
    await page.locator('[data-lang-switch="es"]').first().click();
    await expect(page).toHaveURL(`${base}/es/experience/`);
    await page.keyboard.press("Control+k");
    await expect(input).toBeFocused();
    await input.fill("Fixture");
    await expect(results).toHaveCount(1);
    await expect(input).toHaveAttribute("placeholder", /Buscar/);
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __searchTestInput?: Element | null })
            .__searchTestInput ===
          document.getElementById("universal-search-input"),
      ),
    ).toBe(true);
    await page.locator("#clear-search-btn").click();
    await expect(page.locator("#search-empty-state")).toContainText(
      "Escribe cualquier",
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("#search-dialog")).not.toBeVisible();
    expect(indexRequests).toBe(1);
  });
}
