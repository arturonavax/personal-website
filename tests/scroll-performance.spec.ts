import { test, expect } from "@playwright/test";

// Bun discovers browser suites too; only Playwright executes these cases.
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

  test("continuous native scrolling changes position without repeatedly rewriting the back-to-top control", async ({
    page,
  }) => {
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" && url.port === "4322")
        return route.continue();
      return route.abort();
    });
    await page.goto("http://127.0.0.1:4322/", { waitUntil: "networkidle" });
    await expect(page.locator("#contact")).toBeAttached();
    await page.evaluate(() => {
      window.scrollTo({ top: 500, behavior: "instant" });
    });
    await expect(page.locator("#back-to-top-btn")).toHaveClass(/opacity-100/);
    await page.evaluate(() => {
      const button = document.getElementById("back-to-top-btn")!;
      (window as any).__scrollMutations = 0;
      const observer = new MutationObserver((entries) => {
        (window as any).__scrollMutations += entries.filter(
          (entry) => entry.attributeName === "class",
        ).length;
      });
      observer.observe(button, {
        attributes: true,
        attributeFilter: ["class"],
      });
    });
    const before = await page.evaluate(() => window.scrollY);
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(40);
    }
    const result = await page.evaluate(() => ({
      y: window.scrollY,
      mutations: (window as any).__scrollMutations,
    }));
    expect(result.y).toBeGreaterThan(before);
    expect(result.mutations).toBe(0);
    await expect(page.locator("#back-to-top-btn")).toHaveClass(/opacity-100/);
  });

  test("ordinary pointer and wheel input keeps offscreen sections eligible for render skipping", async ({
    page,
  }) => {
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:4322"
        ? route.continue()
        : route.abort(),
    );
    await page.goto("http://127.0.0.1:4322/", { waitUntil: "networkidle" });
    await page.mouse.move(640, 350);
    await page.mouse.wheel(0, 350);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(100);
    const contact = page.locator("section#contact");
    await expect(contact).toHaveCSS("content-visibility", "auto");
    await expect(page.locator("html")).not.toHaveClass(/hydrated-sections/);
  });

  test("fragment arrival and native history retain their scroll geometry", async ({
    page,
  }) => {
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:4322"
        ? route.continue()
        : route.abort(),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://127.0.0.1:4322/#contact", {
      waitUntil: "networkidle",
    });
    await expect(page.locator("#contact")).toBeInViewport();
    await page.goto("http://127.0.0.1:4322/", { waitUntil: "networkidle" });
    await page.evaluate(() =>
      window.scrollTo({ top: 700, behavior: "instant" }),
    );
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(600);
    // A real click may scroll its target into view before navigation starts.
    // Capture that public input-time position, not the earlier setup position.
    const scrollAtClick = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          document.addEventListener("click", () => resolve(window.scrollY), {
            capture: true,
            once: true,
          });
        }),
    );
    await page.locator('header [data-lang-switch="es"]').first().click();
    const before = await scrollAtClick;
    await expect(page).toHaveURL("http://127.0.0.1:4322/es/");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await page.waitForLoadState("networkidle");
    await page.goBack();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect
      .poll(() => page.evaluate((y) => Math.abs(window.scrollY - y), before))
      .toBeLessThan(48);
    await expect(page.locator("html")).toHaveClass(/hydrated-sections/);
  });
}
