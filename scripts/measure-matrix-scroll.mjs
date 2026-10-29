// Comparable local scroll sample, not a physical-display FPS guarantee.
// Serve a built dist/ directory before running this script.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({
  headless: process.env.MATRIX_HEADFUL !== "1",
  ...(process.env.MATRIX_CHROMIUM_PATH
    ? { executablePath: process.env.MATRIX_CHROMIUM_PATH }
    : {}),
  args:
    process.env.MATRIX_SOFTWARE === "0"
      ? []
      : ["--disable-gpu", "--disable-gpu-compositing"],
});
try {
  const session = await browser.newBrowserCDPSession();
  const { gpu } = await session.send("SystemInfo.getInfo");
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.addInitScript((disabled) => {
    window.__matrixBenchmarkDisabled = disabled;
    Object.defineProperty(navigator, "webdriver", {
      get: () => window.__matrixBenchmarkDisabled === true,
    });
    localStorage.setItem("theme", "dark");
  }, process.env.MATRIX_DISABLE === "1");
  const ready =
    process.env.MATRIX_DISABLE === "1"
      ? null
      : page.waitForEvent("worker", (worker) =>
          worker.url().includes("matrix.worker"),
        );
  const path = process.env.MATRIX_PATH ?? "/projects/";
  await page.goto(
    `${process.env.MATRIX_BASE_URL ?? "http://127.0.0.1:8788"}${path}`,
    {
      waitUntil: "networkidle",
    },
  );
  await page.mouse.move(400, 400);
  if (ready) await ready;
  await page.waitForTimeout(500);
  const sample = page.evaluate(
    () =>
      new Promise((resolve) => {
        const gaps = [];
        let last = 0;
        const until = performance.now() + 3000;
        const frame = (now) => {
          if (last) gaps.push(now - last);
          last = now;
          if (now < until) requestAnimationFrame(frame);
          else resolve(gaps);
        };
        requestAnimationFrame(frame);
      }),
  );
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, i < 12 ? 220 : -220);
    await page.waitForTimeout(95);
  }
  const gaps = await sample;
  gaps.sort((a, b) => a - b);
  const p50 = gaps[Math.floor(gaps.length * 0.5)] ?? null;
  const p75 = gaps[Math.floor(gaps.length * 0.75)] ?? null;
  const p95 = gaps[Math.floor(gaps.length * 0.95)] ?? null;
  console.log(
    JSON.stringify({
      renderer: gpu.auxAttributes?.glRenderer,
      softwareCompositing: gpu.featureStatus?.gpu_compositing,
      viewport: "1440x900",
      path,
      matrixEnabled: process.env.MATRIX_DISABLE !== "1",
      samples: gaps.length,
      p50FrameIntervalMs: p50,
      p75FrameIntervalMs: p75,
      p95FrameIntervalMs: p95,
      maxFrameIntervalMs: gaps.at(-1) ?? null,
      note: "One local rAF sample during scripted scroll; not compositor presentation or field FPS.",
    }),
  );
} finally {
  await browser.close();
}
