import { test, expect } from "@playwright/test";

// Bun's unit-test discovery also visits *.spec.ts; this suite requires Playwright.
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  }
  for (const renderer of ["worker", "2d"] as const) {
    for (const atomicMove of [true, false]) {
      test(`Matrix stays live and isolated (${renderer}, atomic move: ${atomicMove})`, async ({
        page,
      }) => {
        const baseUrl =
          process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4329";
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(
          ({ renderer, atomicMove }) => {
            Object.defineProperty(navigator, "webdriver", { get: () => false });
            if (!atomicMove)
              Object.defineProperty(Element.prototype, "moveBefore", {
                value: undefined,
              });
            if (renderer === "2d")
              Object.defineProperty(
                HTMLCanvasElement.prototype,
                "transferControlToOffscreen",
                { value: undefined },
              );
            const messages: string[] = [];
            const postMessage = Worker.prototype.postMessage;
            Worker.prototype.postMessage = function (message, ...args) {
              messages.push(message.type);
              return Reflect.apply(postMessage, this, [message, ...args]);
            };
            const snapshots: { name: string; oldDisplay: string }[] = [];
            const startTransition = document.startViewTransition.bind(document);
            document.startViewTransition = (...args) => {
              const transition = startTransition(...args);
              void transition.ready
                .then(() => {
                  const matrix = document.getElementById("matrix-container");
                  if (matrix)
                    snapshots.push({
                      name: getComputedStyle(matrix).viewTransitionName,
                      oldDisplay: getComputedStyle(
                        document.documentElement,
                        "::view-transition-old(matrix-background)",
                      ).display,
                    });
                })
                .catch(() => {});
              return transition;
            };
            Object.assign(window, {
              __matrixTestMessages: messages,
              __matrixTestSnapshots: snapshots,
            });
          },
          { renderer, atomicMove },
        );
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        await page.waitForFunction(() =>
          Boolean(window.__matrixSingleton?.initialized),
        );
        await page.waitForTimeout(1000);
        const canvas = page.locator("#matrix-canvas");
        const original = await canvas.elementHandle();
        const sample = () =>
          canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
        const assertLive = async () => {
          expect(
            await canvas.evaluate(
              (node, original) => node === original,
              original,
            ),
          ).toBe(true);
          const bitmap = await sample();
          await expect.poll(sample).not.toBe(bitmap);
          expect(
            await page.evaluate(
              () =>
                (
                  window as Window & { __matrixTestMessages: string[] }
                ).__matrixTestMessages.filter((type) => type === "init").length,
            ),
          ).toBe(renderer === "worker" ? 1 : 0);
        };
        // A real header click exercises the navigation path users actually use.
        await page.locator('header a[href="/projects/"]').first().click();
        await page.waitForURL("**/projects/");
        await assertLive();
        // ready samples the real active pseudo-elements, before finished removes them.
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as Window & { __matrixTestSnapshots: unknown[] })
                  .__matrixTestSnapshots.length,
            ),
          )
          .toBeGreaterThan(0);
        expect(
          await page.evaluate(
            () =>
              (window as Window & { __matrixTestSnapshots: unknown[] })
                .__matrixTestSnapshots,
          ),
        ).toEqual([{ name: "matrix-background", oldDisplay: "none" }]);
        await page.goBack();
        await page.waitForURL((url) => url.pathname === "/");
        await assertLive();
        await page.goForward();
        await page.waitForURL("**/projects/");
        await assertLive();
        expect(errors).toEqual([]);
      });
    }
  }
  test("language banner stays mounted, aligned and dismissed across real navigation", async ({
    page,
  }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4329";
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "languages", { get: () => ["es"] });
    });
    await page.goto(`${baseUrl}/projects/`, { waitUntil: "networkidle" });
    const banner = page.locator("#lang-suggestion-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveClass(/opacity-100/);
    // Measure only after the one permitted first entrance completes.
    await page.waitForTimeout(400);
    const original = await banner.elementHandle();
    const before = await banner.boundingBox();
    await page.locator('header a[href="/experience/"]').first().click();
    await page.waitForURL("**/experience/");
    await expect(banner).toBeVisible();
    expect(
      await banner.evaluate((node, original) => node === original, original),
    ).toBe(true);
    const after = await banner.boundingBox();
    expect(after?.y).toBe(before?.y);
    expect(after?.x).toBe(before?.x);
    await expect(page.locator("#lang-suggestion-accept")).toHaveAttribute(
      "href",
      "/es/experience/",
    );
    await page.locator("#lang-suggestion-dismiss").click();
    await expect(banner).toBeHidden();
    await page.locator('header a[href="/projects/"]').first().click();
    await page.waitForURL("**/projects/");
    await expect(banner).toBeHidden();
  });

  test("mobile language switching uses one fetch without reloading", async ({
    page,
  }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4329";
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/es/`, { waitUntil: "networkidle" });
    await page.evaluate(() =>
      Object.assign(window, { __mobileLanguageDocument: true }),
    );
    const requests: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/")
        requests.push(request.resourceType());
    });
    await page.locator("#mobile-nav-details summary").click();
    await page.locator('#mobile-nav-details [data-lang-switch="en"]').click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __mobileLanguageDocument?: boolean })
            .__mobileLanguageDocument,
      ),
    ).toBe(true);
    expect(requests).toEqual(["fetch"]);
    expect(errors).toEqual([]);
  });

  test("navigation retains the canvas and theme without reloading the document", async ({
    page,
  }) => {
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4329";
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      (window as Window & { __spaTestDocument?: string }).__spaTestDocument =
        "original";
      (
        document.getElementById("matrix-canvas") as HTMLCanvasElement & {
          __spaTestCanvas?: string;
        }
      ).__spaTestCanvas = "original";
    });
    await page.locator("#theme-toggle").click();
    const chosenTheme = await page.locator("html").getAttribute("data-theme");
    expect(chosenTheme).toBe("light");
    await expect(page.locator("html")).not.toHaveClass(/theme-transitioning/);

    for (const path of [
      "/projects/",
      "/experience/",
      "/blog/",
      "/services/",
      "/case-studies/",
      "/resume/",
      "/tools/resume-maker/",
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
            (
              window as Window & {
                __matrixSingleton?: { initialized: boolean };
              }
            ).__matrixSingleton?.initialized,
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
    await page.evaluate(() => {
      const start = document.startViewTransition.bind(document);
      Object.assign(window, { __languageTransitionCount: 0 });
      document.startViewTransition = (...args) => {
        (window as Window & { __languageTransitionCount: number })
          .__languageTransitionCount++;
        return start(...args);
      };
    });
    await page.locator('header [data-lang-switch="en"]').first().click();
    await page.waitForURL((url) => url.pathname === "/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __spaTestDocument?: string }).__spaTestDocument,
      ),
    ).toBe("original");
    expect(
      await page
        .locator("#matrix-canvas")
        .evaluate(
          (node) =>
            (node as HTMLCanvasElement & { __spaTestCanvas?: string })
              .__spaTestCanvas,
        ),
    ).toBe("original");
    await expect(page.locator("#lang-suggestion-banner")).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __languageTransitionCount: number })
            .__languageTransitionCount,
      ),
    ).toBe(1);
    expect(pageErrors).toEqual([]);
  });
}
