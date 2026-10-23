import { test, expect } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  }
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
  test("shared outlines follow hover without a second delay or blocking card links", async ({
    page,
  }) => {
    await page.goto(`${baseUrl}/projects/`);
    const card = page.locator("[data-project-card]").first();
    await card.hover();
    await page.waitForTimeout(250);
    const colors = await card.evaluate((element) => ({
      parent: getComputedStyle(element).borderTopColor,
      outline: getComputedStyle(element, "::before").borderTopColor,
    }));
    expect(colors.outline).toBe(colors.parent);
    await card.locator("h3 a").click();
    await expect(page.locator(".article-detail__header")).toBeVisible();
  });

  for (const theme of ["dark", "light"]) {
    test(`corner strokes share scalable geometry including clipped surfaces: ${theme}`, async ({
      page,
    }) => {
      await page.goto(baseUrl);
      const results = await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        return [4, 8, 24, 48].flatMap((radius) =>
          ["visible", "hidden"].map((overflow) => {
            const box = document.createElement("div");
            box.className = "geometric-box rounded-lg";
            box.style.cssText = `width:280px;height:160px;--geometric-radius:${radius}px;overflow:${overflow}`;
            document.body.append(box);
            const parent = getComputedStyle(box);
            const before = getComputedStyle(box, "::before");
            const after = getComputedStyle(box, "::after");
            const result = {
              radius,
              parentRadius: parent.borderTopLeftRadius,
              baseRadius: before.borderTopLeftRadius,
              accentRadius: after.borderTopLeftRadius,
              baseWidth: before.width,
              accentWidth: after.width,
              width: box.getBoundingClientRect().width,
              top: after.top,
              left: after.left,
              pointerEvents: after.pointerEvents,
              baseBorder: before.borderTopWidth,
              accentBorder: after.borderTopWidth,
              mask: after.maskImage,
            };
            box.classList.add("no-corner-accents");
            const optedOut = {
              base: getComputedStyle(box, "::before").display,
              accent: getComputedStyle(box, "::after").display,
            };
            box.remove();
            return { ...result, optedOut };
          }),
        );
      }, theme);
      for (const result of results) {
        expect(result.parentRadius).toBe(`${result.radius}px`);
        expect(result.baseRadius).toBe(result.parentRadius);
        expect(result.accentRadius).toBe(result.parentRadius);
        expect(parseFloat(result.baseWidth)).toBe(result.width);
        expect(parseFloat(result.accentWidth)).toBe(result.width);
        expect(result.top).toBe("0px");
        expect(result.left).toBe("0px");
        expect(result.pointerEvents).toBe("none");
        expect(result.baseBorder).toBe("1px");
        expect(result.accentBorder).toBe("2px");
        expect(result.mask).not.toBe("none");
        expect(result.optedOut.base).not.toBe("none");
        expect(result.optedOut.accent).toBe("none");
      }
    });
  }

  test("corner radii follow actual responsive utilities rather than class substrings", async ({
    page,
  }) => {
    await page.goto(baseUrl);
    for (const [width, expected] of [
      [390, "4px"],
      [1440, "12px"],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const radii = await page.evaluate(() => {
        const box = document.createElement("div");
        box.className =
          "geometric-box rounded-sm sm:rounded-xl overflow-hidden";
        document.body.append(box);
        const radii = [
          getComputedStyle(box),
          getComputedStyle(box, "::before"),
          getComputedStyle(box, "::after"),
        ].map((style) => style.borderTopLeftRadius);
        box.remove();
        return radii;
      });
      expect(radii).toEqual([expected, expected, expected]);
    }
  });
}
