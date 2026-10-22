import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";

// Bun discovers *.spec.ts too; browser instrumentation requires Playwright.
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  test.use({
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
      args: ["--disable-gpu", "--disable-gpu-compositing"],
    },
  });

  test("software-rendered Matrix records Worker and presented navigation activity separately", async ({
    page,
    browser,
  }, testInfo) => {
    const gpuSession = await browser.newBrowserCDPSession();
    const { gpu } = await gpuSession.send("SystemInfo.getInfo");
    expect(gpu.featureStatus?.gpu_compositing).toBe("disabled_software");
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      localStorage.setItem("theme", "dark");
    });
    const ready = page.waitForEvent("worker", (worker) =>
      worker.url().includes("matrix.worker"),
    );
    const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
    await page.goto(`${base}/projects/`, { waitUntil: "networkidle" });
    await page.mouse.move(400, 400);
    const worker = await ready;
    // Let the naturally positioned glyph streams enter the sampled gutter.
    await page.waitForTimeout(1600);
    const originalDocument = await page.evaluateHandle(() => document);
    const originalCanvas = await page.locator("#matrix-canvas").elementHandle();
    const originalWorker = await page.evaluateHandle(
      () => window.__matrixSingleton?.worker,
    );
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
    await page.evaluate(() => {
      document.addEventListener(
        "astro:after-swap",
        () => {
          const start = Date.now();
          const until = performance.now() + 450;
          while (performance.now() < until) {
            // Identical controlled contention for reproducible local comparisons.
          }
          (
            window as typeof window & {
              __matrixContention?: { start: number; end: number };
            }
          ).__matrixContention = { start, end: Date.now() };
        },
        { once: true },
      );
    });
    await page.route("**/services/", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    });
    const cdp = await page.context().newCDPSession(page);
    const frames: { time: number; data: string }[] = [];
    cdp.on("Page.screencastFrame", (event) => {
      frames.push({ time: event.metadata.timestamp! * 1000, data: event.data });
      void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId });
    });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await page.waitForTimeout(450);
    await page.locator('header a[href="/services/"]').first().click();
    await page.waitForURL("**/services/");
    await page.waitForTimeout(1200);
    await cdp.send("Page.stopScreencast");
    const interval = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __matrixContention?: { start: number; end: number };
          }
        ).__matrixContention!,
    );
    const paints = await worker.evaluate(
      () => (self as typeof self & { __paintTimes: number[] }).__paintTimes,
    );
    const during = paints.filter(
      (time) => time >= interval.start && time <= interval.end,
    );
    const { default: sharp } = await import("sharp");
    const samples = await Promise.all(
      frames.map(async ({ time, data }) => ({
        time,
        hash: createHash("sha256")
          .update(
            await sharp(Buffer.from(data, "base64"))
              // This gutter is outside the foreground article in both routes.
              .extract({ left: 0, top: 100, width: 200, height: 750 })
              .raw()
              .toBuffer(),
          )
          .digest("hex"),
      })),
    );
    const changes = samples.filter(
      (sample, index) =>
        index === 0 || sample.hash !== samples[index - 1]!.hash,
    );
    const before = changes
      .filter((sample) => sample.time < interval.start)
      .at(-1);
    const after = changes.find((sample) => sample.time > interval.end);
    const around = changes.filter(
      (sample) =>
        sample.time >= (before?.time ?? interval.start) &&
        sample.time <= (after?.time ?? interval.end),
    );
    await testInfo.attach("software-matrix-measurement", {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          renderer: gpu.auxAttributes?.glRenderer,
          softwareCompositing: gpu.featureStatus?.gpu_compositing,
          interval,
          workerPaintsDuringContention: during.length,
          workerMaxGap: Math.max(
            0,
            ...during.slice(1).map((time, index) => time - during[index]!),
          ),
          presentedChangeOffsets: around.map(
            (sample) => sample.time - interval.start,
          ),
          maxObservedPresentationGap: Math.max(
            0,
            ...around
              .slice(1)
              .map((sample, index) => sample.time - around[index]!.time),
          ),
          limitation:
            "CDP screenshots are sampled compositor output, not every display refresh. Glyph randomness and capture overhead affect gaps; this does not certify a frame-rate SLA or physical-display smoothness.",
        }),
      ),
    });
    expect(during.length).toBeGreaterThan(1);
    expect(changes.length).toBeGreaterThan(1);
    // Detect a frozen presentation without pretending sampled output proves 60 FPS.
    expect(
      changes.filter(
        (sample) =>
          sample.time >= interval.start && sample.time <= interval.end,
      ).length,
    ).toBeGreaterThan(1);
    expect(
      await page.evaluate((old) => document === old, originalDocument),
    ).toBe(true);
    expect(
      await page
        .locator("#matrix-canvas")
        .evaluate((node, old) => node === old, originalCanvas),
    ).toBe(true);
    expect(
      await page.evaluate(
        (old) => window.__matrixSingleton?.worker === old,
        originalWorker,
      ),
    ).toBe(true);
    await page.goBack();
    await page.waitForURL("**/projects/");
    expect(
      await page.evaluate((old) => document === old, originalDocument),
    ).toBe(true);
  });
}
