import { test, expect } from "@playwright/test";

// Bun discovers spec files too; browser tests run only through Playwright.
if (process.env.TEST_WORKER_INDEX !== undefined || !("Bun" in globalThis)) {
  test.use({ screenshot: "on" });
  if (process.env.CHROMIUM_EXECUTABLE_PATH) {
    test.use({
      launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH },
    });
  }

  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8788";
  const slug = process.env.BLOG_SURFACE_SLUG ?? "sub-50ms-fraud-engine-go";

  for (const locale of ["en", "es"]) {
    for (const theme of ["dark", "light"]) {
      for (const width of [390, 1440]) {
        test(`blog surfaces: ${locale}, ${theme}, ${width}px`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.addInitScript(
            (selected) => localStorage.setItem("theme", selected),
            theme,
          );
          const prefix = locale === "es" ? "/es" : "";
          const indexUrl = `${baseUrl}${prefix}/blog/`;
          const available = await page.request.get(indexUrl);
          // Unpublished posts are intentionally absent from static output. A
          // fixture build or a published post is required for surface coverage.
          test.skip(
            available.status() === 404,
            "No published blog fixture in this build",
          );
          expect(available.status()).toBe(200);
          await page.goto(indexUrl);

          const inspect = async (selector: string) =>
            page.locator(selector).evaluate((element) => {
              const surface = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              const siteHeader = document.getElementById("site-header")!;
              const main = document.getElementById("main-content")!;
              const card = document.createElement("span");
              card.style.backgroundColor = "var(--color-surface-card)";
              element.append(card);
              const expectedBackground = getComputedStyle(card).backgroundColor;
              card.remove();
              return {
                background: surface.backgroundColor,
                expectedBackground,
                backdrop: surface.backdropFilter,
                left: rect.left,
                right: innerWidth - rect.right,
                headerGap: rect.top - siteHeader.getBoundingClientRect().bottom,
                mainGap: rect.top - main.getBoundingClientRect().top,
              };
            });

          const header = await inspect("#main-content header");
          expect(header.background).toBe(header.expectedBackground);
          expect(header.backdrop).toBe("none");
          expect(header.left).toBeGreaterThanOrEqual(16);
          expect(header.right).toBeGreaterThanOrEqual(16);
          expect(header.headerGap).toBeGreaterThanOrEqual(24);

          const detail = await page.goto(`${baseUrl}${prefix}/blog/${slug}/`);
          expect(detail?.status()).toBe(200);
          const article = await inspect(".article-detail__content");
          expect(article.background).toBe(article.expectedBackground);
          expect(article.backdrop).toBe("none");
          expect(article.left).toBeGreaterThanOrEqual(16);
          expect(article.right).toBeGreaterThanOrEqual(16);
          expect(article.mainGap).toBeGreaterThanOrEqual(24);
          await expect(
            page.locator(".article-detail__header.geometric-box"),
          ).toBeVisible();
          expect(article.headerGap).toBeGreaterThanOrEqual(24);
          await expect(page.locator("#main-content h1")).toBeVisible();
        });
      }
    }
  }

  for (const theme of ["dark", "light"]) {
    for (const width of [390, 1440]) {
      test(`project detail matches service composition: ${theme}, ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          (selected) => localStorage.setItem("theme", selected),
          theme,
        );
        await page.goto(`${baseUrl}/projects/fyld/`);
        const article = page.locator(".article-detail");
        const header = article.locator(".article-detail__header.geometric-box");
        const content = article.locator(".article-detail__content");
        await expect(header).toBeVisible();
        await expect(content).toBeVisible();
        await expect(header.locator("h1")).toBeVisible();
        await expect(
          header.locator(".article-detail__description"),
        ).toBeVisible();
        const geometry = await article.evaluate((element) => {
          const header = element.querySelector(".article-detail__header")!;
          const content = element.querySelector(".article-detail__content")!;
          return {
            outerBorder: getComputedStyle(element).borderTopWidth,
            outerBackdrop: getComputedStyle(element).backdropFilter,
            gap:
              content.getBoundingClientRect().top -
              header.getBoundingClientRect().bottom,
            left: header.getBoundingClientRect().left,
            right: innerWidth - header.getBoundingClientRect().right,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(geometry.outerBorder).toBe("0px");
        expect(geometry.outerBackdrop).toBe("none");
        expect(geometry.gap).toBeGreaterThanOrEqual(24);
        expect(geometry.left).toBeGreaterThanOrEqual(16);
        expect(geometry.right).toBeGreaterThanOrEqual(16);
        expect(geometry.overflow).toBe(false);
      });
    }
  }
}
