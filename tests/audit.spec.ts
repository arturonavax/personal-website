// tests/audit.spec.ts
import { test, expect } from "@playwright/test";

// Only activate when invoked under Playwright runner; avoid crashing bun test discovery
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  test.describe("Top #1 Tier Architectural and Performance Certification", () => {
    test("Verify CLS = 0.000, LCP < 800ms, and Zero FOUC Under Throttling", async ({
      page,
    }) => {
      // 1. Inject PerformanceObserver to intercept layout shifts
      await page.addInitScript(() => {
        (window as any).__cumulativeLayoutShift = 0;
        const observer = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (!(entry as any).hadRecentInput) {
              (window as any).__cumulativeLayoutShift += (entry as any).value;
            }
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
      });

      // 2. Emulate Fast 4G mobile network conditions
      const client = await page.context().newCDPSession(page);
      await client.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 40,
        downloadThroughput: (4 * 1024 * 1024) / 8, // 4 Mbps
        uploadThroughput: (2 * 1024 * 1024) / 8, // 2 Mbps
      });

      const response = await page.goto("/", { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);

      // 3. Measure LCP
      const lcpValue = await page.evaluate(async () => {
        return new Promise<number>((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const last = entries[entries.length - 1];
            resolve(last.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });

          setTimeout(() => resolve(0), 4000);
        });
      });

      expect(lcpValue).toBeGreaterThan(0);
      expect(lcpValue).toBeLessThan(800);

      // 4. Assert Cumulative Layout Shift
      const finalCls = await page.evaluate(
        () => (window as any).__cumulativeLayoutShift,
      );
      expect(finalCls).toBe(0.0);

      // 5. Assert Scrollbar Gutter Locking
      const hasStableGutter = await page.evaluate(() => {
        const style = window.getComputedStyle(document.documentElement);
        return style.scrollbarGutter.includes("stable");
      });
      expect(hasStableGutter).toBe(true);
    });

    test("Verify Pristine Canonical URLs (Zero Tracking Pollution)", async ({
      page,
    }) => {
      await page.goto(
        "/?utm_source=newsletter&utm_medium=email&ref=developer-review",
        {
          waitUntil: "domcontentloaded",
        },
      );

      const canonicalHref = await page
        .locator('link[rel="canonical"]')
        .getAttribute("href");
      expect(canonicalHref).not.toContain("utm_source");
      expect(canonicalHref).not.toContain("utm_medium");
      expect(canonicalHref).not.toContain("ref");
      expect(canonicalHref).toMatch(/^https?:\/\/[^/]+\/?$/);
    });

    test("Verify Isolated Monobilingual JSON-LD Payloads", async ({ page }) => {
      // English Route
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const enJsonText = await page
        .locator('script[type="application/ld+json"]')
        .first()
        .textContent();
      const enSchema = JSON.parse(enJsonText || "{}");
      expect(enSchema.inLanguage).toBe("en");

      // Spanish Route
      await page.goto("/es/", { waitUntil: "domcontentloaded" });
      const esJsonText = await page
        .locator('script[type="application/ld+json"]')
        .first()
        .textContent();
      const esSchema = JSON.parse(esJsonText || "{}");
      expect(esSchema.inLanguage).toBe("es");

      // Identity Anchor Preservation
      expect(enSchema["@id"]).toBe(esSchema["@id"]);
    });
  });
}
