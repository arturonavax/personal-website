import { expect, test } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH)
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });

  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8788";

  test("admin renders bilingual bounded subsets and retains them on table pagination", async ({
    page,
  }) => {
    let pageOnlyRequests = 0;
    // Deny non-loopback browser requests before loading the current Astro page.
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
    });
    const quotas = {
      provider_usage: { d1_storage: { used: null, status: "unavailable", source: "D1 binding meta.size_after", scope: "selected database", period: "current read-only query", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Not account usage" } },
      strategy: { daily_write_budget: 100000 },
    };
    await page.route("**/api/telemetry?**", async (route) => {
      const pageOnly = new URL(route.request().url()).searchParams.has(
        "page_only",
      );
      if (pageOnly) pageOnlyRequests++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          timestamp: "2026-10-26T12:00:00Z",
          stats: {
            total_pageviews: 3,
            human_views: 3,
            bot_views: 0,
            unique_visitors: 2,
            prefetches_count: 0,
          },
          pageviews: [],
          prefetches: [],
          top_pages: [],
          top_countries: [],
          utm_attributions: [],
          top_referrers: [],
          pagination: {
            page: pageOnly ? 2 : 1,
            total_pages: 2,
            total_filtered: 3,
          },
          quotas,
          coverage: pageOnly
            ? null
            : {
                device_os: {
                  status: "subset",
                  classified_views: 3,
                  device: { desktop: 2, mobile: 1 },
                  os: {
                    windows: 2,
                    macos: 0,
                    ios: 1,
                    android: 0,
                    linux: 0,
                    other: 0,
                  },
                },
                bots: {
                  status: "subset",
                  collection_enabled: false,
                  sample_rate: 0.01,
                  observed: 1,
                  ai: 1,
                  other: 0,
                  unknown: 0,
                },
              },
        }),
      });
    });
    for (const endpoint of ["metrics", "deployments", "leads"]) {
      await page.route(`**/api/${endpoint}?**`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            quotas,
            deployments: [],
            leads: [],
            data_quality_warnings: [],
          }),
        }),
      );
    }

    for (const locale of ["", "es/"]) {
      await page.goto(`${base}/${locale}admin/`, { waitUntil: "networkidle" });
      await expect(page.locator("#coverage-desktop")).toHaveText("2");
      await expect(page.locator("#coverage-ai")).toHaveText("1");
      await expect(page.locator("#quota-d1-storage")).toContainText("D1 binding meta.size_after · selected database");
      await expect(page.locator("#coverage-bot-status")).toContainText(
        locale ? "Recolección desactivada" : "Collection off",
      );
    }
    await page.locator("#btn-page-next").click();
    await expect.poll(() => pageOnlyRequests).toBe(1);
    await expect(page.locator("#coverage-ai")).toHaveText("1");
  });
}
