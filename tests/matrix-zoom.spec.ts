import { test, expect } from "@playwright/test";
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  test.use({
    launchOptions: {
      ...(process.env.CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
        : {}),
    },
  });
  for (const renderer of ["worker", "2d"]) {
    test(`Matrix handles live viewport/DPR zoom and pointer input without reinitialization (${renderer})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript((renderer) => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        localStorage.setItem("theme", "dark");
        if (renderer === "2d")
          Object.defineProperty(
            HTMLCanvasElement.prototype,
            "transferControlToOffscreen",
            { value: undefined },
          );
      }, renderer);
      const workerReady =
        renderer === "worker"
          ? page.waitForEvent("worker", (w) =>
              w.url().includes("matrix.worker"),
            )
          : null;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(
        (process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788") +
          "/projects/",
        { waitUntil: "networkidle" },
      );
      await page.mouse.move(500, 350);
      await page.waitForFunction(() => window.__matrixSingleton?.initialized);
      const worker = workerReady ? await workerReady : null;
      const identity = await page.evaluateHandle(() => ({
        document,
        canvas: document.getElementById("matrix-canvas"),
        worker: window.__matrixSingleton?.worker,
      }));
      const instrumentation = (offscreen: boolean) => {
        const state = globalThis as any;
        const proto = offscreen
          ? OffscreenCanvasRenderingContext2D.prototype
          : CanvasRenderingContext2D.prototype;
        const blit = proto.drawImage;
        proto.drawImage = function (...args: any[]) {
          const x = Number(args[5]);
          if (Math.abs(x - Math.round(x)) > 0.00001)
            state.__matrixWarpSeen = true;
          return Reflect.apply(blit, this, args);
        };
        const clear = proto.clearRect;
        proto.clearRect = function (x, y, width, height) {
          if (width > 300 && height > 300) {
            const t = this.getTransform();
            state.__matrixSize = {
              logicalWidth: width,
              logicalHeight: height,
              width: this.canvas.width,
              height: this.canvas.height,
              a: t.a,
              d: t.d,
            };
          }
          return clear.call(this, x, y, width, height);
        };
      };
      if (worker) await worker.evaluate(instrumentation, true);
      else await page.evaluate(instrumentation, false);
      const cdp = await page.context().newCDPSession(page);
      for (const [width, height, dpr] of [
        [1460, 910, 1],
        [1430, 895, 0.8],
        [1920, 1080, 1.25],
        [1440, 900, 1],
        [1440, 900, 0.9],
        [1440, 900, 1],
      ]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: dpr,
          mobile: false,
        });
        // CDP changes DPR without emitting browser zoom's resize/media signal.
        await page.evaluate(() => window.dispatchEvent(new Event("resize")));
        const actualDpr = await page.evaluate(() => window.devicePixelRatio);
        const expected = await page
          .locator("#matrix-canvas")
          .evaluate((node) => ({
            width: (node as HTMLCanvasElement).clientWidth,
            height: (node as HTMLCanvasElement).clientHeight,
          }));
        await expect
          .poll(async () => {
            const size = worker
              ? await worker.evaluate(() => (globalThis as any).__matrixSize)
              : await page.evaluate(() => (globalThis as any).__matrixSize);
            return size
              ? {
                  width: size.logicalWidth,
                  height: size.logicalHeight,
                  mappedWidth: Math.round(size.a * size.logicalWidth),
                  mappedHeight: Math.round(size.d * size.logicalHeight),
                  bufferWidth: size.width,
                  bufferHeight: size.height,
                }
              : null;
          })
          .toEqual({
            width: expected.width,
            height: expected.height,
            mappedWidth: Math.floor(
              expected.width *
                Math.min(
                  actualDpr,
                  1,
                  Math.sqrt((1920 * 1080) / (expected.width * expected.height)),
                ),
            ),
            mappedHeight: Math.floor(
              expected.height *
                Math.min(
                  actualDpr,
                  1,
                  Math.sqrt((1920 * 1080) / (expected.width * expected.height)),
                ),
            ),
            bufferWidth: Math.floor(
              expected.width *
                Math.min(
                  actualDpr,
                  1,
                  Math.sqrt((1920 * 1080) / (expected.width * expected.height)),
                ),
            ),
            bufferHeight: Math.floor(
              expected.height *
                Math.min(
                  actualDpr,
                  1,
                  Math.sqrt((1920 * 1080) / (expected.width * expected.height)),
                ),
            ),
          });
        await page.mouse.move(320, 420);
        await page.mouse.move(610, 310);
      }
      await expect
        .poll(async () =>
          worker
            ? await worker.evaluate(() => (globalThis as any).__matrixWarpSeen)
            : await page.evaluate(() => (globalThis as any).__matrixWarpSeen),
        )
        .toBe(true);
      await page.locator('header a[href="/services/"]').first().click();
      await page.waitForURL("**/services/");
      expect(
        await page.evaluate(
          (old) => ({
            document: document === old.document,
            canvas: document.getElementById("matrix-canvas") === old.canvas,
            worker: window.__matrixSingleton?.worker === old.worker,
          }),
          identity,
        ),
      ).toEqual({ document: true, canvas: true, worker: true });
      expect(errors).toEqual([]);
    });
  }
}
