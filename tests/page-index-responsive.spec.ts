import { expect, test } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH)
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8788";
  test("Index label follows small and medium floating modes without changing desktop placement", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(base, { waitUntil: "networkidle" });
    const button = page.locator("#open-index-floating-btn");
    const label = page.locator("#mobile-index-label");
    await expect(button).toBeVisible();
    await expect(label).toHaveText("Index", { useInnerText: true });
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(button).toBeVisible();
      await expect(label).toHaveText("Page Index", { useInnerText: true });
    }
    await page.setViewportSize({ width: 1920, height: 900 });
    await expect(page.locator("#desktop-page-index")).toBeVisible();
    await expect(button).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(label).toHaveText("Index", { useInnerText: true });
    await page
      .locator("#mobile-nav-details")
      .evaluate((el) => el.setAttribute("open", ""));
    await page.locator('[data-lang-switch="es"]:visible').first().click();
    await expect(page).toHaveURL(`${base}/es/`);
    await expect(label).toHaveText("Índice", { useInnerText: true });
    await page.setViewportSize({ width: 768, height: 900 });
    await expect(label).toHaveText("Índice", { useInnerText: true });
    await page.locator('[data-lang-switch="en"]:visible').first().click();
    await expect(page).toHaveURL(`${base}/`);
    await expect(label).toHaveText("Page Index", { useInnerText: true });
  });
}
