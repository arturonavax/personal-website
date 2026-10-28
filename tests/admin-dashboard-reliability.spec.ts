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
    // Deny all non-loopback browser requests before any navigation.
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
    });
    const quotas = {
      strategy: { workers_daily_budget: 100000, daily_read_budget: 5000000, daily_write_budget: 100000 },
      degradation_tier_name: "NOMINAL",
      provider_usage: {
        workers_requests: { used: null, status: "setup_required", source: "workersInvocationsAdaptive", scope: "account", period: "2026-10-28 UTC", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Sampled, not billing" },
        d1_rows_read: { used: 7, status: "observed", source: "d1AnalyticsAdaptiveGroups", scope: "account", period: "2026-10-28 UTC", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Sampled, not billing" },
        d1_rows_written: { used: 0, status: "observed", source: "d1AnalyticsAdaptiveGroups", scope: "account", period: "2026-10-28 UTC", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Sampled, not billing" },
        d1_storage: { used: 0, status: "observed", source: "D1 binding meta.size_after", scope: "selected database", period: "current read-only query", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Not account usage" },
        r2_storage: { used: null, status: "unavailable", source: "r2StorageAdaptiveGroups", scope: "selected bucket", period: "latest sample within 31 days", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Sampled, not billing" },
        r2_class_a: { used: 0, status: "observed", source: "r2OperationsAdaptiveGroups", scope: "selected bucket", period: "2026-10 month-to-date UTC", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Sampled, not billing" },
        r2_class_b: { used: 2, status: "observed", source: "r2OperationsAdaptiveGroups", scope: "selected bucket", period: "2026-10 month-to-date UTC", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Sampled, not billing" },
        zero_trust_seats: { used: 1, status: "observed", source: "GET /access/users", scope: "account", period: "current occupied users", retrieved_at: "2026-10-28T12:00:00Z", accuracy: "Observed, not billing" },
      },
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
    await page.route("**/api/metrics?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ quotas, data_quality_warnings: [] }) }));
    await page.route("**/api/deployments?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deployments: [] }) }));
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
    await expect(page.locator("#quota-workers-ai, #quota-vectorize, #quota-workers-monthly")).toHaveCount(0);
    await expect(page.locator("#quota-workers-daily")).toContainText("Setup required");
    await expect(page.locator("#quota-workers-daily")).toContainText("workersInvocationsAdaptive · account · 2026-10-28 UTC");
    await expect(page.locator("#quota-d1-writes")).toContainText("0 rows / 100k · Observed");
    await expect(page.locator("#quota-r2-storage")).toContainText("Unavailable");
    await expect(page.locator("#quota-zero-trust")).toContainText("1 occupied seats");
    await expect(page.locator("#quota-r2-class-a")).toContainText("0 / 1M · Observed");
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
    quotas.provider_usage.workers_requests.used = 0;
    quotas.provider_usage.workers_requests.status = "observed";
    await page.locator("#btn-refresh").click();
    await expect(page.locator("#quota-workers-daily")).toContainText("0 / 100k · Observed");
    await expect(page.locator("#quota-workers-daily-status")).toHaveText("OBSERVED");
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

  test("desktop index stays outside the actual admin surface and other page surfaces", async ({
    page,
  }) => {
    for (const width of [1280, 1700, 1800, 2000]) {
      await page.setViewportSize({ width, height: 950 });
      for (const path of ["/admin/", "/"]) {
        await page.goto(base + path);
        if (width === 2000)
          await expect
            .poll(async () => page.locator("#desktop-page-index").isVisible())
            .toBe(true);
        if (!(await page.locator("#desktop-page-index").isVisible())) {
          console.info(`${path} ${width}px: floating index`);
          await expect(page.locator("#mobile-page-index-container")).toBeVisible();
          const trigger = page.locator("#open-index-floating-btn");
          await trigger.click();
          await expect(trigger).toHaveAttribute("aria-expanded", "true");
          await expect(page.locator("#index-expanded-panel")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.locator("#index-expanded-panel")).toBeHidden();
          await expect(trigger).toBeFocused();
          continue;
        }
        await expect(page.locator("#mobile-page-index-container")).toBeHidden();
        const edges = await page.evaluate(() => {
          const aside = document
            .querySelector("#desktop-page-index")!
            .getBoundingClientRect();
          const content = document
            .querySelector(pathForContent())!
            .getBoundingClientRect();
          function pathForContent() {
            return location.pathname.includes("admin")
              ? "main > div"
              : "#about";
          }
          return { asideRight: aside.right, contentLeft: content.left };
        });
        console.info(`${path} ${width}px: aside right ${edges.asideRight}, content left ${edges.contentLeft}`);
        expect(edges.asideRight).toBeLessThanOrEqual(edges.contentLeft - 20);
      }
    }
    await page.goto(base + "/admin/");
    await expect(page.locator("#desktop-page-index")).toBeVisible();
    await page.setViewportSize({ width: 1700, height: 950 });
    await expect(page.locator("#desktop-page-index")).toBeHidden();
    await expect(page.locator("#mobile-page-index-container")).toBeVisible();
    await page.setViewportSize({ width: 2000, height: 950 });
    await expect(page.locator("#desktop-page-index")).toBeVisible();
    await expect(page.locator("#mobile-page-index-container")).toBeHidden();
  });
}
