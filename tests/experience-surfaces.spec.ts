import { expect, test } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  }
  for (const theme of ["dark", "light"]) {
    test(`experience header masks the timeline while arrows remain usable (${theme})`, async ({
      page,
    }) => {
      const sharp = (await import("sharp")).default;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(
        (theme) => localStorage.setItem("theme", theme),
        theme,
      );
      const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
      await page.goto(`${base}/experience/latam/`, {
        waitUntil: "networkidle",
      });
      const header = page.locator("#role-header");
      const surface = await header.evaluate((el) => {
        const reference = document.createElement("div");
        reference.style.backgroundColor = "var(--color-surface-card)";
        document.body.append(reference);
        const expected = getComputedStyle(reference).backgroundColor;
        reference.remove();
        return { actual: getComputedStyle(el).backgroundColor, expected };
      });
      expect(surface.actual).toBe(surface.expected);
      const rail = page.locator("#timeline-rail-container > div").first();
      await rail.evaluate((el) => {
        (el as HTMLElement).style.background = "#ff00ff";
        const gradient = el.firstElementChild as HTMLElement;
        gradient.style.background = "#ff00ff";
      });
      const card = (await header.boundingBox())!;
      const axis = (await rail.boundingBox())!;
      const points = [
        { x: Math.round(card.x + 28), y: Math.floor(axis.y + axis.height / 2) },
        { x: Math.round(card.x - 36), y: Math.floor(axis.y + axis.height / 2) },
      ];
      const sample = async () => {
        const { data, info } = await sharp(await page.screenshot())
          .raw()
          .toBuffer({ resolveWithObject: true });
        return points.map(({ x, y }) => [
          ...data.subarray(
            (y * info.width + x) * info.channels,
            (y * info.width + x) * info.channels + 3,
          ),
        ]);
      };
      const withRail = await sample();
      await rail.evaluate(
        (el) => ((el as HTMLElement).style.visibility = "hidden"),
      );
      const withoutRail = await sample();
      expect(withRail[0]).toEqual(withoutRail[0]);
      expect(withRail[1]).not.toEqual(withoutRail[1]);
      await rail.evaluate(
        (el) => ((el as HTMLElement).style.visibility = "visible"),
      );
      const past = page.locator('[data-timeline-nav="past"]');
      const pastUrl = await past.getAttribute("href");
      await past.click();
      await page.waitForURL(new URL(pastUrl!, base).href);
      const future = page.locator('[data-timeline-nav="future"]');
      await expect(future).toHaveAttribute("href", "/experience/latam/");
      await future.click();
      await page.waitForURL(`${base}/experience/latam/`);
      await expect(header).toBeVisible();
    });
  }
}
