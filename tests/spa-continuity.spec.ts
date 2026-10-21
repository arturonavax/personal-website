import { test, expect } from "@playwright/test";

// Bun's unit-test discovery also visits *.spec.ts; this suite requires Playwright.
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  }
  test("navigation retains the canvas and theme without reloading the document", async ({
    page,
  }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4329";
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      (window as Window & { __spaTestDocument?: string }).__spaTestDocument =
        "original";
      (document.getElementById("matrix-canvas") as HTMLCanvasElement & {
        __spaTestCanvas?: string;
      }).__spaTestCanvas = "original";
    });
    await page.locator("#theme-toggle").click();
    const chosenTheme = await page.locator("html").getAttribute("data-theme");

    for (const path of [
      "/projects/",
      "/experience/",
      "/blog/",
      "/services/",
      "/resume/",
      "/es/",
    ]) {
      const pageLoaded = page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            document.addEventListener("astro:page-load", () => resolve(), {
              once: true,
            });
          }),
      );
      await page.evaluate((targetPath) => {
        const link = document.createElement("a");
        link.href = targetPath;
        link.textContent = "Navigate";
        document.body.append(link);
        link.click();
      }, path);
      await page.waitForURL((url) => url.pathname === path);
      await pageLoaded;
      // Allow the current page's 130ms view transition to finish before
      // initiating the next navigation; otherwise Astro cancels its snapshot.
      await page.waitForTimeout(180);
      expect(
        await page.evaluate(() => ({
          document: (window as Window & { __spaTestDocument?: string })
            .__spaTestDocument,
          canvas: (
            document.getElementById("matrix-canvas") as HTMLCanvasElement & {
              __spaTestCanvas?: string;
            }
          )?.__spaTestCanvas,
          initialized: Boolean(
            (window as Window & { __matrixSingleton?: { initialized: boolean } })
              .__matrixSingleton?.initialized,
          ),
          theme: document.documentElement.getAttribute("data-theme"),
        })),
      ).toEqual({
        document: "original",
        canvas: "original",
        initialized: true,
        theme: chosenTheme,
      });
    }
    expect(pageErrors).toEqual([]);
  });
}
