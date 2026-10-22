import { test, expect } from "@playwright/test";

// Bun's unit-test discovery also visits *.spec.ts; this suite requires Playwright.
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  }
  test("Matrix visibility follows the selected theme rather than the OS theme", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788",
      { waitUntil: "networkidle" },
    );
    expect(
      await page
        .locator("#matrix-container")
        .evaluate((el) => getComputedStyle(el).opacity),
    ).toBe("0.28");
    await page.evaluate(() => {
      (window as any).__DISABLE_THEME_ANIMATION__ = true;
    });
    await page.locator("#theme-toggle").click();
    expect(
      await page
        .locator("#matrix-container")
        .evaluate((el) => getComputedStyle(el).opacity),
    ).toBe("0.2");
    await page.emulateMedia({ colorScheme: "dark" });
    expect(
      await page
        .locator("#matrix-container")
        .evaluate((el) => getComputedStyle(el).opacity),
    ).toBe("0.2");
  });

  test("theme reveal preserves old pixels while its first animation frame is pending", async ({
    page,
  }) => {
    const sharp = (await import("sharp")).default;
    await page.addInitScript(() => localStorage.setItem("theme", "dark"));
    await page.goto(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788",
      { waitUntil: "networkidle" },
    );
    await page.addStyleTag({
      content: `#theme-pixel-probe { position:fixed;left:20px;top:500px;width:80px;height:80px;z-index:100000;background:rgb(17,34,51); } html[data-theme="light"] #theme-pixel-probe { background:rgb(221,238,255); }`,
    });
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.id = "theme-pixel-probe";
      document.body.append(probe);
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const theme =
          typeof options === "object" &&
          options.pseudoElement === "::view-transition-new(root)";
        const animation = animate.call(
          this,
          keyframes,
          theme ? { ...options, delay: 500 } : options,
        );
        if (theme) (window as any).__themeProbeAnimation = animation;
        return animation;
      };
    });
    const sample = async () => {
      const { data, info } = await sharp(await page.screenshot())
        .raw()
        .toBuffer({ resolveWithObject: true });
      const offset = (540 * info.width + 60) * info.channels;
      return [...data.subarray(offset, offset + 3)];
    };
    for (const [oldPixel, newPixel] of [
      [
        [17, 34, 51],
        [221, 238, 255],
      ],
      [
        [221, 238, 255],
        [17, 34, 51],
      ],
    ]) {
      expect(await sample()).toEqual(oldPixel);
      await page.evaluate(() => {
        (window as any).__themeProbeAnimation = null;
      });
      await page.locator("#theme-toggle").click();
      await page.waitForFunction(() => !!(window as any).__themeProbeAnimation);
      expect(await sample()).toEqual(oldPixel);
      await page.waitForFunction(
        () =>
          !document.documentElement.hasAttribute("data-theme-transitioning"),
      );
      expect(await sample()).toEqual(newPixel);
    }
  });

  test("ordinary navigation keeps live foreground above Matrix without snapshot layers", async ({
    page,
  }) => {
    await page.goto(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788",
      { waitUntil: "networkidle" },
    );
    const points = await page.evaluate(() => {
      // Put both foreground regions in view; their probes stay inside capture bounds.
      const footer = document.querySelector("footer")!;
      footer.style.cssText +=
        ";position:fixed;left:0;top:400px;width:100%;height:120px;z-index:10;";
      const points: { x: number; y: number }[] = [];
      for (const [selector, left, top] of [
        ["main", 100, 200],
        ["footer", 180, 20],
      ] as const) {
        const probe = document.createElement("div");
        probe.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:80px;height:80px;background:red;z-index:100;`;
        document.querySelector(selector)!.append(probe);
        const bounds = probe.getBoundingClientRect();
        points.push({
          x: Math.floor(bounds.left + 40),
          y: Math.floor(bounds.top + 40),
        });
      }
      const backdrop = document.createElement("div");
      backdrop.style.cssText = "position:absolute;inset:0;background:lime;";
      document.querySelector("#matrix-container")!.append(backdrop);
      return points;
    });
    const { default: sharp } = await import("sharp");
    const assertOpaque = async () => {
      const screenshot = await page.screenshot();
      const { data, info } = await sharp(screenshot)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (const { x, y } of points) {
        const index = (y * info.width + x) * 3;
        expect([...data.subarray(index, index + 3)]).toEqual([255, 0, 0]);
      }
    };
    // Establish that the exact sampled pixels belong to the foreground before capture.
    await assertOpaque();
    const names = await page.evaluate(() =>
      [...document.querySelectorAll("*")]
        .map((element) => getComputedStyle(element).viewTransitionName)
        .filter((name) => name !== "none"),
    );
    expect(names).toEqual([]);
    await page.evaluate(async () => {
      const transition = document.startViewTransition(() => {
        document.documentElement.dataset.layerProbe = "new";
      });
      await transition.finished;
    });
    await assertOpaque();
    const released = await page.evaluate(() => {
      document.documentElement.classList.add("theme-transitioning");
      const names = ["html", "#matrix-container", "main", "footer"].map(
        (selector) =>
          getComputedStyle(document.querySelector(selector)!)
            .viewTransitionName,
      );
      document.documentElement.classList.remove("theme-transitioning");
      return names;
    });
    expect(released).toEqual(["root", "none", "none", "none"]);
  });
  test("Matrix Worker paints while navigation and main-thread work overlap", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "webdriver", { get: () => false }),
    );
    const ready = page.waitForEvent("worker", (worker) =>
      worker.url().includes("matrix.worker"),
    );
    await page.goto(
      process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788",
      { waitUntil: "networkidle" },
    );
    await page.mouse.move(400, 400);
    const worker = await ready;
    await worker.evaluate(() => {
      const state = self as typeof self & { __paintTimes: number[] };
      state.__paintTimes = [];
      const clearRect = OffscreenCanvasRenderingContext2D.prototype.clearRect;
      OffscreenCanvasRenderingContext2D.prototype.clearRect = function (
        ...args
      ) {
        state.__paintTimes.push(Date.now());
        return Reflect.apply(clearRect, this, args);
      };
    });
    await page.route("**/services/", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    const requested = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/services/",
    );
    await page.locator('header a[href="/services/"]').first().click();
    await requested;
    const interval = await page.evaluate(() => {
      const start = Date.now();
      const until = performance.now() + 250;
      while (performance.now() < until) {
        /* Controlled navigation contention. */
      }
      return { start, end: Date.now() };
    });
    const times = await worker.evaluate(
      () => (self as typeof self & { __paintTimes: number[] }).__paintTimes,
    );
    const during = [...new Set(times)].filter(
      (time) => time >= interval.start && time <= interval.end,
    );
    expect(during.length).toBeGreaterThanOrEqual(8);
    expect(
      Math.max(...during.slice(1).map((time, index) => time - during[index]!)),
    ).toBeLessThan(80);
    await page.waitForURL("**/services/");
  });
  test("Worker delivery retains the shell through real header and job-arrow navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "languages", { get: () => ["es"] });
    });
    const documentRequests: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documentRequests.push(request.url());
    });
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
    await page.goto(`${baseUrl}/projects/`, { waitUntil: "networkidle" });
    await expect(
      page.locator('meta[name="astro-view-transitions-enabled"]'),
    ).toHaveCount(1);
    await page.mouse.move(400, 400);
    await page.waitForFunction(() => window.__matrixSingleton?.initialized);
    const originalDocument = await page.evaluateHandle(() => document);
    const originalCanvas = await page.locator("#matrix-canvas").elementHandle();
    const originalWorker = await page.evaluateHandle(
      () => window.__matrixSingleton?.worker,
    );
    const banner = page.locator("#lang-suggestion-banner");
    await expect(banner).toBeVisible();
    await page.waitForTimeout(400);
    const initialBanner = await banner.boundingBox();
    const navigate = async (selector: string) => {
      const link = page.locator(selector).first();
      const href = await link.getAttribute("href");
      const loaded = page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            document.addEventListener("astro:page-load", () => resolve(), {
              once: true,
            }),
          ),
      );
      await link.click();
      await page.waitForURL(
        (url) => url.pathname === new URL(href!, baseUrl).pathname,
      );
      await loaded;
      expect(
        await page.evaluate(
          (original) => document === original,
          originalDocument,
        ),
      ).toBe(true);
      expect(
        await page
          .locator("#matrix-canvas")
          .evaluate((node, original) => node === original, originalCanvas),
      ).toBe(true);
      expect(
        await page.evaluate(
          (original) => window.__matrixSingleton?.worker === original,
          originalWorker,
        ),
      ).toBe(true);
      await expect(banner).toBeVisible();
      const bounds = await banner.boundingBox();
      expect(bounds?.x).toBe(initialBanner?.x);
      expect(bounds?.y).toBe(initialBanner?.y);
      await page.waitForTimeout(180);
    };
    await navigate('#header-desktop-nav a[data-nav-section="about"]');
    await navigate('#header-desktop-nav a[data-nav-section="experience"]');
    await navigate('main a[href="/experience/latam/"]');
    await navigate('a[data-timeline-nav="past"]');
    await navigate('a[data-timeline-nav="future"]');
    await navigate('#header-desktop-nav a[data-nav-section="services"]');
    await navigate('#header-desktop-nav a[data-nav-section="projects"]');
    expect(documentRequests).toEqual([`${baseUrl}/projects/`]);
    expect(errors).toEqual([]);
  });
  for (const renderer of ["worker", "2d"] as const) {
    for (const atomicMove of [true, false]) {
      test(`Matrix stays live and isolated (${renderer}, atomic move: ${atomicMove})`, async ({
        page,
      }) => {
        const baseUrl =
          process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
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
        // The router still swaps normally, but Matrix must not acquire a snapshot.
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
        ).toEqual([{ name: "none", oldDisplay: "none" }]);
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
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
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
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
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
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
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
