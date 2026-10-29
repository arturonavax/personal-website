import { expect, test } from "@playwright/test";

if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("fixed page gradient stays behind interactive content across themes and routes", async ({
    page,
  }) => {
    const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";

    for (const theme of ["dark", "light"]) {
      await page.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      for (const path of ["/", "/es/", "/projects/"]) {
        await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const background = await page.evaluate(() => {
          const body = getComputedStyle(document.body);
          const layer = getComputedStyle(document.documentElement, "::before");
          return {
            bodyImage: body.backgroundImage,
            bodyColor: body.backgroundColor,
            bodyLayer: body.zIndex,
            layerImage: layer.backgroundImage,
            layerPosition: layer.position,
            layerDepth: layer.zIndex,
            layerPointerEvents: layer.pointerEvents,
          };
        });
        expect(background.bodyImage).toBe("none");
        expect(background.bodyColor).toBe("rgba(0, 0, 0, 0)");
        expect(background.bodyLayer).toBe("1");
        expect(background.layerImage).toContain("radial-gradient");
        expect(background.layerPosition).toBe("fixed");
        expect(background.layerDepth).toBe("0");
        expect(background.layerPointerEvents).toBe("none");
        await expect(page.locator("main#main-content")).toBeVisible();
      }
    }

    await page.emulateMedia({ media: "print" });
    const printBackground = await page.evaluate(() => ({
      layerDisplay: getComputedStyle(document.documentElement, "::before")
        .display,
      bodyColor: getComputedStyle(document.body).backgroundColor,
    }));
    expect(printBackground.layerDisplay).toBe("none");
    expect(printBackground.bodyColor).toBe("rgb(255, 255, 255)");
  });
}
