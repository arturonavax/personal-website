import { expect, test } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("home timeline spreads rendering across cards and reveals active tooltips", async ({
    page,
  }) => {
    const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    const section = page.locator("section#experience");
    const card = section.locator("[data-experience-item]").first();
    await expect(section).toHaveCSS("content-visibility", "visible");
    await expect(card).toHaveCSS("content-visibility", "auto");

    const trigger = card.locator("[data-company-trigger]");
    await trigger.hover();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(card).toHaveCSS("content-visibility", "visible");
    await expect(card.locator("[data-company-tooltip]")).toBeVisible();
  });

  test("mobile Spanish experience fragment keeps the heading and job links reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
    await page.goto(`${base}/es/#experience`, { waitUntil: "networkidle" });
    const section = page.locator("section#experience");
    await expect(section.locator("#experience-heading")).toBeInViewport();
    const firstLink = section.locator("[data-experience-item] h3 a").first();
    await expect(firstLink).toHaveAttribute("href", /\/es\/experience\//);
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 600);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(before);
  });
}
