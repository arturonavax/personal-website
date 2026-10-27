import { expect, test } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH)
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4322";
  test("locale, leads availability, unknown quotas and response ordering survive admin navigation", async ({
    page,
  }) => {
    let slow: (() => void) | undefined;
    let telemetryCalls = 0;
    let pageOnlyCalls = 0;
    const quotas = {
      r2_storage: { used_gb: null, limit_gb: 10, available: false },
      zero_trust_seats: { used: null, limit: 50, available: false },
      workers_ai_daily: { used: null, limit: 10000, available: false },
      vectorize_monthly: { used: null, limit: 5000000, available: false },
      workers_daily: { used: null, limit: 100000, available: false },
      workers_monthly: { used: null, limit: 3000000, available: false },
    };
    await page.route("**/api/telemetry?**", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      telemetryCalls++;
      if (params.has("page_only")) pageOnlyCalls++;
      if (params.get("segment") === "human") {
        await new Promise<void>((resolve) => {
          slow = resolve;
        });
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          timestamp: new Date().toISOString(),
          stats: {
            total_pageviews: params.get("segment") === "human" ? 1 : 9,
            human_views: 1,
            bot_views: 0,
            unique_visitors: 1,
            prefetches_count: 0,
          },
          pageviews: [],
          prefetches: [],
          top_pages: [],
          top_countries: [],
          utm_attributions: [],
          top_referrers: [],
          pagination: { page: 1, total_pages: 1, total_filtered: 0 },
          quotas,
        }),
      });
    });
    for (const endpoint of ["metrics", "deployments"])
      await page.route(`**/api/${endpoint}?**`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ deployments: [], data_quality_warnings: [] }),
        }),
      );
    let leadsUnavailable = true;
    const lead = {
      id: 1,
      name: "Local Visitor",
      from_email: "visitor@example.invalid",
      subject: "Project inquiry",
      body: "Please contact me",
      created_at: "2026-10-23 12:00:00",
      locale: "en",
    };
    await page.route("**/api/leads?**", (route) =>
      route.fulfill({
        status: leadsUnavailable ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          leadsUnavailable
            ? { status: "unavailable" }
            : { status: "ok", leads: [lead] },
        ),
      }),
    );
    await page.goto(`${base}/admin/`);
    await expect(page.locator("#kpi-total")).toHaveText("9");
    await expect(page.locator("#kpi-leads")).not.toHaveText("0");
    await expect(page.locator("#quota-r2-storage")).not.toContainText("0.18");
    await expect(page.locator("#quota-zero-trust")).not.toContainText("1 / 50");
    await expect(page.locator("#quota-workers-ai")).not.toContainText(
      "0 / 10,000",
    );
    await expect(page.locator("#quota-workers-daily")).toContainText(
      "— / 100k",
    );
    await expect(page.locator("#quota-workers-monthly")).toContainText(
      "— / 3M",
    );
    await expect(page.locator("#quota-workers-daily-status")).toHaveText(
      "UNAVAILABLE",
    );
    await expect(page.locator("#badge-live-status")).not.toHaveText("LIVE");
    await page.locator("#tab-human").click();
    await page.locator("#btn-apply-filters").click();
    await expect.poll(() => Boolean(slow)).toBe(true);
    await page.locator("#tab-all").click();
    await page.locator("#btn-apply-filters").click();
    await expect(page.locator("#kpi-total")).toHaveText("9");
    slow?.();
    await expect(page.locator("#kpi-total")).toHaveText("9");
    leadsUnavailable = false;
    await page.locator("#btn-refresh").click();
    await expect(page.locator("#kpi-leads")).toHaveText("1");
    await expect(page.getByText("Project inquiry")).toBeVisible();
    quotas.workers_daily = { used: 0, limit: 100000, available: true };
    quotas.workers_monthly = { used: 0, limit: 3000000, available: true };
    await page.locator("#btn-refresh").click();
    await expect(page.locator("#quota-workers-daily")).toContainText(
      "0 / 100k",
    );
    await expect(page.locator("#quota-workers-daily-status")).toHaveText("OK");
    await page.locator('[data-lang-switch="es"]').first().click();
    await expect(page).toHaveURL(/\/es\/admin\//);
    await expect(page.locator("#btn-apply-filters")).toContainText(
      "Aplicar Filtros",
    );
    await expect(page.locator("#kpi-total")).toHaveText("9");
    await expect(page.locator("#kpi-leads")).toHaveText("1");
    const before = telemetryCalls;
    await page.evaluate(() => (window as any).onPollIntervalChange("100"));
    await expect.poll(() => telemetryCalls).toBeGreaterThan(before);
    await page.evaluate(() => (window as any).onPollIntervalChange("0"));
    await page.locator('[data-lang-switch="en"]').first().click();
    await expect(page).toHaveURL(/\/admin\/$/);
    await expect(page.locator("#kpi-leads")).toHaveText("1");
    // Existing table pagination remains page-only and does not discard the KPI snapshot.
    await page.evaluate(() => (window as any).goToPage(2));
    // The fixture has one page: the previous behavior rejects out-of-range navigation.
    expect(pageOnlyCalls).toBe(0);
    await expect(page.locator("#kpi-total")).toHaveText("9");
  });

}
