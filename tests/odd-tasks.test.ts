import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import worker, { handleAdminDashboardRequest } from "../cloudflare/worker";

const ROOT_DIR = process.cwd();

describe("ODD Task 1: Refined /admin Surface (Cloudflare Access & Rich Dashboard)", () => {
  it("generates static admin pages in build output for both default and Spanish locales", () => {
    const adminEnPath = path.join(ROOT_DIR, "dist", "admin", "index.html");
    const adminEsPath = path.join(
      ROOT_DIR,
      "dist",
      "es",
      "admin",
      "index.html",
    );

    expect(fs.existsSync(adminEnPath)).toBe(true);
    expect(fs.existsSync(adminEsPath)).toBe(true);

    const enHtml = fs.readFileSync(adminEnPath, "utf8");
    expect(enHtml).toContain("Admin Management Surface");
    expect(enHtml).toContain("Zero Trust");
    expect(enHtml).toContain('id="site-header"');
    expect(enHtml).toContain('id="theme-toggle"');
    expect(enHtml).toContain('aria-label="Language selector"');
  });

  it("enforces private no-store headers and robots disallow for /admin routes", () => {
    const headersContent = fs.readFileSync(
      path.join(ROOT_DIR, "public", "_headers"),
      "utf8",
    );
    expect(headersContent).toContain("/admin*");
    expect(headersContent).toContain("/es/admin*");
    expect(headersContent).toContain("Cache-Control: no-store, private");

    const robotsContent = fs.readFileSync(
      path.join(ROOT_DIR, "public", "robots.txt"),
      "utf8",
    );
    expect(robotsContent).toContain("Disallow: /admin");
    expect(robotsContent).toContain("Disallow: /es/admin");
  });

  it("excludes /admin from sitemap generation", () => {
    const astroConfig = fs.readFileSync(
      path.join(ROOT_DIR, "astro.config.mjs"),
      "utf8",
    );
    expect(astroConfig).toContain('!page.includes("/admin/")');

    const sitemapPath = path.join(ROOT_DIR, "dist", "sitemap-0.xml");
    if (fs.existsSync(sitemapPath)) {
      const sitemapContent = fs.readFileSync(sitemapPath, "utf8");
      expect(sitemapContent.includes("/admin/")).toBe(false);
    }
  });

  it("serves rich isolated dashboard with header, theme toggle, and footer in Worker fallback", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
          all: async () => ({ results: [] }),
        }),
      },
    } as any;

    const req = new Request("https://admin.arturonavax.dev/");
    const res = await worker.fetch(req, mockEnv, mockCtx);

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Admin Management Surface");
    expect(html).toContain("Zero Trust Surface");
    expect(html).toContain("site-header");
    expect(html).toContain("theme-btn");
    expect(html).toContain("lang-switcher");
    expect(html).toContain("site-footer");
    expect(html).toContain("chart-svg");
    expect(html).toContain("kpi-total");
    expect(html).toContain("kpi-human");
    expect(html).toContain("kpi-bot");
    expect(html).toContain("kpi-unique");
    expect(html).toContain("kpi-prefetch");
    expect(html).toContain("kpi-leads");
  });

  it("provides /api/leads endpoint in Cloudflare Worker", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => ({
          all: async () => ({
            results: [
              {
                id: 1,
                from_email: "recruiter@test.com",
                subject: "Opportunity",
                body: "Hello",
                created_at: "2026-10-09",
              },
            ],
          }),
        }),
      },
    } as any;

    const req = new Request("https://admin.arturonavax.dev/api/leads");
    const res = await worker.fetch(req, mockEnv, mockCtx);

    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("ok");
    expect(data.leads.length).toBe(1);
    expect(data.leads[0].from_email).toBe("recruiter@test.com");
  });
});

describe("ODD Task 2: Production-Ready Cal.com Integration (Direct Dedicated Link)", () => {
  it("provides ScheduleButton.astro linking directly to dedicated Cal.com interface with 0 KB client JS", () => {
    const compPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ScheduleButton.astro",
    );
    expect(fs.existsSync(compPath)).toBe(true);

    const compContent = fs.readFileSync(compPath, "utf8");
    expect(compContent).toContain('variant?: "direct" | "modal"');
    expect(compContent).toContain("calLink?: string");
    expect(compContent).toContain("arturonavax");
    expect(compContent).toContain("https://cal.com/");
    expect(compContent).toContain('target="_blank"');
    expect(compContent).toContain('rel="noopener noreferrer"');
    // Ensure 0 KB client JS: no dialog, no embedded script, no iframe
    expect(compContent).not.toContain("<dialog");
    expect(compContent).not.toContain("<script");
    expect(compContent).not.toContain("window.Cal");
    expect(compContent).not.toContain("embed.js");
  });

  it("integrates ScheduleButton in HeroHeaderBanner.astro", () => {
    const heroPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "HeroHeaderBanner.astro",
    );
    const heroContent = fs.readFileSync(heroPath, "utf8");

    expect(heroContent).toContain("ScheduleButton");
    expect(heroContent).toContain('calLink="arturonavax"');
    expect(heroContent).toContain('variant="direct"');
  });

  it("replaces redundant Start a Conversation in ContactSection.astro with ScheduleButton", () => {
    const contactPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "ContactSection.astro",
    );
    const contactContent = fs.readFileSync(contactPath, "utf8");

    expect(contactContent).toContain("ScheduleButton");
    expect(contactContent).toContain('calLink="arturonavax"');
    expect(contactContent).toContain('variant="direct"');
    // Verifies EmailCopyButton is not used in the Action CTAs
    expect(contactContent).not.toContain(
      'label={t("contact.startConversation")}',
    );
  });

  it("whitelists Cal.com in Content-Security-Policy headers in public/_headers", () => {
    const headersPath = path.join(ROOT_DIR, "public", "_headers");
    const headersContent = fs.readFileSync(headersPath, "utf8");

    expect(headersContent).toContain("https://app.cal.com");
    expect(headersContent).toContain(
      "frame-src 'self' https://app.cal.com https://cal.com",
    );
    expect(headersContent).toContain(
      "child-src 'self' https://app.cal.com https://cal.com",
    );
    expect(headersContent).toContain(
      "connect-src 'self' https://cloudflareinsights.com https://cal.com https://app.cal.com",
    );
  });
});
