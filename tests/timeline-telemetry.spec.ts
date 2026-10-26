import { expect, test } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH)
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
  test("timeline speculative fetches carry a recognized prefetch marker", async ({
    page,
  }) => {
    const requests: Record<string, string>[] = [];
    page.on("request", (request) => {
      if (
        request.resourceType() === "fetch" &&
        request.url().includes("/experience/")
      )
        requests.push(request.headers());
    });
    await page.goto(`${base}/experience/latam/`, { waitUntil: "networkidle" });
    expect(requests.length).toBeGreaterThan(0);
    expect(
      requests.every((headers) => headers["x-astro-prefetch"] === "true"),
    ).toBe(true);
  });
  test("cached timeline commits retain their paths until idle and send one visit each", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const state = window as any;
      state.__telemetryTasks = [];
      state.__visits = [];
      state.__extraNavigations = 0;
      document.addEventListener(
        "astro:before-preparation",
        () => state.__extraNavigations++,
      );
      window.requestIdleCallback = (task) => {
        state.__telemetryTasks.push(task);
        return 1;
      };
      navigator.sendBeacon = (_url, payload) => {
        (payload as Blob)
          .text()
          .then((text) => state.__visits.push(JSON.parse(text)));
        return true;
      };
    });
    await page.goto(`${base}/experience/latam/`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      (window as any).__telemetryTasks
        .splice(0)
        .forEach((task: () => void) => task());
    });
    expect(await page.evaluate(() => (window as any).__visits)).toEqual([]);
    const past = page.locator('[data-timeline-nav="past"]');
    const target = new URL((await past.getAttribute("href"))!, base).pathname;
    await past.click();
    await page.waitForURL(`${base}${target}`);
    // Ingestion must not wait for idle (the tab could close before idle runs).
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__visits.map((v: { path: string }) => v.path),
        ),
      )
      .toEqual([target]);
    await expect
      .poll(() =>
        page
          .locator("#experience-article-content")
          .evaluate((el) => (el as HTMLElement).style.transition),
      )
      .toBe("");
    await page.waitForTimeout(300); // The existing timeline guard releases after its entry animation.
    await page.locator('[data-timeline-nav="future"]').click();
    await page.waitForURL(`${base}/experience/latam/`);
    await page.evaluate(() => {
      (window as any).__telemetryTasks
        .splice(0)
        .forEach((task: () => void) => task());
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__visits.map((v: { path: string }) => v.path),
        ),
      )
      .toEqual([target, "/experience/latam/"]);
    expect(await page.evaluate(() => (window as any).__extraNavigations)).toBe(
      0,
    );
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
      (window as any).__telemetryTasks
        .splice(0)
        .forEach((task: () => void) => task());
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).__visits.length))
      .toBe(3);
    expect(
      await page.evaluate(() => (window as any).__visits.at(-1).trigger),
    ).toBe("bfcache");
  });
  test("dated timeline roles and H/L/arrows commit exactly one visit per keyboard move", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const state = window as any;
      state.__visits = [];
      state.__routeCommits = 0;
      document.addEventListener(
        "site:route-committed",
        () => state.__routeCommits++,
      );
      navigator.sendBeacon = (_url, payload) => {
        (payload as Blob)
          .text()
          .then((text) => state.__visits.push(JSON.parse(text)));
        return true;
      };
      window.requestIdleCallback = () => 1;
    });
    await page.goto(`${base}/experience/latam/`, { waitUntil: "networkidle" });
    const startDate = async () => {
      const label = await page
        .locator("#role-header span.truncate")
        .textContent();
      const date = Date.parse(label!.trim().split(" - ")[0]!);
      expect(Number.isNaN(date)).toBe(false);
      return date;
    };
    const initialDate = await startDate();
    const go = async (
      key: string,
      direction: "past" | "future",
      count: number,
    ) => {
      const href = await page
        .locator(`[data-timeline-nav="${direction}"]`)
        .getAttribute("href");
      const target = new URL(href!, base).pathname;
      const committed = page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            document.addEventListener("site:route-committed", () => resolve(), {
              once: true,
            }),
          ),
      );
      await page.keyboard.press(key);
      await committed;
      await page.waitForURL(`${base}${target}`);
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).__visits.map(
              (v: { path: string; trigger: string }) => [v.path, v.trigger],
            ),
          ),
        )
        .toHaveLength(count);
      expect(
        await page.evaluate(() => (window as any).__visits.at(-1)),
      ).toMatchObject({ path: target, trigger: "spa_transition" });
      expect(await page.evaluate(() => (window as any).__routeCommits)).toBe(
        count,
      );
      await page.waitForTimeout(280);
      return startDate();
    };
    expect(await go("h", "past", 1)).toBeLessThanOrEqual(initialDate);
    expect(await go("l", "future", 2)).toBe(initialDate);
    expect(await go("ArrowLeft", "past", 3)).toBeLessThanOrEqual(initialDate);
    expect(await go("ArrowRight", "future", 4)).toBe(initialDate);

    const input = page.locator("body").evaluate((body) => {
      const el = document.createElement("input");
      body.appendChild(el);
      el.focus();
    });
    await input;
    await page.keyboard.press("h");
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press("Control+h");
    await page.evaluate(() => {
      const modal = document.createElement("dialog");
      modal.id = "timeline-keyboard-isolation";
      document.body.appendChild(modal);
      modal.showModal();
    });
    await page.keyboard.press("ArrowLeft");
    await page.evaluate(() =>
      document.getElementById("timeline-keyboard-isolation")?.remove(),
    );
    expect(await page.evaluate(() => (window as any).__routeCommits)).toBe(4);
    expect(await page.evaluate(() => (window as any).__visits.length)).toBe(4);
  });

  test("cached timeline history records the restored committed path", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const state = window as any;
      state.__visits = [];
      navigator.sendBeacon = (_url, payload) => {
        (payload as Blob)
          .text()
          .then((text) => state.__visits.push(JSON.parse(text)));
        return true;
      };
      window.requestIdleCallback = () => 1;
    });
    await page.goto(`${base}/experience/latam/`, { waitUntil: "networkidle" });
    const link = page.locator('[data-timeline-nav="past"]');
    const target = new URL((await link.getAttribute("href"))!, base).pathname;
    await link.click();
    await page.waitForURL(`${base}${target}`);
    await page.waitForTimeout(300);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__visits.map((v: { path: string }) => v.path),
        ),
      )
      .toEqual([target]);
    await page.goBack();
    await page.waitForURL(`${base}/experience/latam/`);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__visits.map((v: { path: string }) => v.path),
        ),
      )
      .toEqual([target, "/experience/latam/"]);
  });
}
