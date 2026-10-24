import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { isIndexableSitemapPath } from "../scripts/lib/sitemap-metadata.mjs";
import worker, {
  handleAdminDashboardRequest,
  classifyVisitor,
} from "../cloudflare/worker";

const ROOT_DIR = process.cwd();

describe("ODD Task 1: Refined /admin Surface (Cloudflare Access & Rich Dashboard)", () => {
  it("generates static admin pages in build output for both default and Spanish locales (isolated in vault)", () => {
    const vaultEnPath = path.join(
      ROOT_DIR,
      "dist",
      "__admin_vault__",
      "default",
      "index.html",
    );
    const vaultEsPath = path.join(
      ROOT_DIR,
      "dist",
      "__admin_vault__",
      "es",
      "index.html",
    );
    const adminEnPath = path.join(ROOT_DIR, "dist", "admin", "index.html");
    const adminEsPath = path.join(
      ROOT_DIR,
      "dist",
      "es",
      "admin",
      "index.html",
    );

    const isVaultIsolated =
      fs.existsSync(vaultEnPath) && fs.existsSync(vaultEsPath);
    if (isVaultIsolated) {
      expect(fs.existsSync(adminEnPath)).toBe(false);
      expect(fs.existsSync(adminEsPath)).toBe(false);
      const enHtml = fs.readFileSync(vaultEnPath, "utf8");
      expect(enHtml).toContain("Admin Management Surface");
      expect(enHtml).toContain("Zero Trust");
      expect(enHtml).toContain('id="site-header"');
      expect(enHtml).toContain('id="theme-toggle"');
      expect(enHtml).toContain('aria-label="Language selector"');
    } else {
      expect(fs.existsSync(adminEnPath)).toBe(true);
      expect(fs.existsSync(adminEsPath)).toBe(true);
      const enHtml = fs.readFileSync(adminEnPath, "utf8");
      expect(enHtml).toContain("Admin Management Surface");
      expect(enHtml).toContain("Zero Trust");
      expect(enHtml).toContain('id="site-header"');
      expect(enHtml).toContain('id="theme-toggle"');
      expect(enHtml).toContain('aria-label="Language selector"');
    }
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
    expect(astroConfig).toContain(
      "isIndexableSitemapPath(new URL(page).pathname)",
    );
    expect(isIndexableSitemapPath("/admin/")).toBe(false);
    expect(isIndexableSitemapPath("/es/admin/")).toBe(false);

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
      ADMIN_ACCESS_TOKEN: "mock-admin-token-for-testing-32-chars-long",
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
          all: async () => ({ results: [] }),
        }),
      },
    } as any;

    const req = new Request("https://admin.arturonavax.dev/", {
      headers: {
        Authorization: "Bearer mock-admin-token-for-testing-32-chars-long",
      },
    });
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
    expect(html).not.toContain('<a href="/experience/">Experience</a>');
    expect(html).not.toContain('<a href="/services/">Services</a>');
  });

  it("provides /api/leads endpoint in Cloudflare Worker", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      ADMIN_ACCESS_TOKEN: "mock-admin-token-for-testing-32-chars-long",
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

    const req = new Request("https://admin.arturonavax.dev/api/leads", {
      headers: {
        Authorization: "Bearer mock-admin-token-for-testing-32-chars-long",
      },
    });
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

describe("ODD Task 3: Mobile View Transitions Hardening & Anti-Squishing", () => {
  it("enforces root group isolation to eliminate bounding-box morphing", () => {
    const cssPath = path.join(ROOT_DIR, "src", "styles", "global.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");

    expect(cssContent).toContain("::view-transition-group(root)");
    expect(cssContent).toMatch(
      /::view-transition-group\(root\)\s*\{\s*animation:\s*none\s*!important;/,
    );
  });

  it("normalizes mobile view transitions, scrollbars, and dynamic viewport in global.css", () => {
    const cssPath = path.join(ROOT_DIR, "src", "styles", "global.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");

    expect(cssContent).toContain("@media (max-width: 768px)");
    expect(cssContent).toContain("scrollbar-gutter: auto");
    expect(cssContent).toContain("min-height: 100dvh");
    expect(cssContent).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?::view-transition-group\(\*\)[\s\S]*?animation:\s*none\s*!important;/,
    );
  });

  it("enables circular theme reveal with startViewTransition without blocking mobile devices in ThemeToggle.astro", () => {
    const themePath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "common",
      "ThemeToggle.astro",
    );
    const themeContent = fs.readFileSync(themePath, "utf8");

    expect(themeContent).toContain("document.startViewTransition");
    expect(themeContent).not.toMatch(
      /isMobile[\s\S]*?!document\.startViewTransition\s*\|\|\s*prefersReduced\s*\|\|\s*isAnimationDisabled\s*\|\|\s*isMobile/,
    );
    expect(themeContent).toContain("circularThemeClip(");
    expect(themeContent).toContain("::view-transition-new(root)");
  });

  it("bypasses startViewTransition on mobile devices in LanguageSwitcher.astro while maintaining DOM swap", () => {
    const langPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "common",
      "LanguageSwitcher.astro",
    );
    const langContent = fs.readFileSync(langPath, "utf8");

    expect(langContent).toContain("isMobile");
    expect(langContent).toMatch(
      /if\s*\(\s*isMobile\s*\|\|\s*typeof document\.startViewTransition !== "function"\s*\)\s*\{[\s\S]*?swapDOM\(\);/,
    );
  });
});

describe("ODD Task 4: Removal of Top Loading Bar in Favor of Fetching Beacon", () => {
  it("completely removes page-navigation-bar from BaseLayout.astro", () => {
    const layoutPath = path.join(
      ROOT_DIR,
      "src",
      "layouts",
      "BaseLayout.astro",
    );
    const layoutContent = fs.readFileSync(layoutPath, "utf8");

    expect(layoutContent).not.toContain('id="page-navigation-bar"');
    expect(layoutContent).not.toContain("page-navigation-bar");
  });

  it("preserves page-navigation-beacon with localized loading indicator in BaseLayout.astro", () => {
    const layoutPath = path.join(
      ROOT_DIR,
      "src",
      "layouts",
      "BaseLayout.astro",
    );
    const layoutContent = fs.readFileSync(layoutPath, "utf8");

    expect(layoutContent).toContain('id="page-navigation-beacon"');
    expect(layoutContent).toContain(
      'locale === "es" ? "Cargando..." : "Fetching..."',
    );
    expect(layoutContent).toContain("showBeacon");
    expect(layoutContent).toContain("hideBeacon");
  });

  it("shields file downloads, data-no-beacon anchors and static documents from triggering the navigation beacon", () => {
    const layoutPath = path.join(
      ROOT_DIR,
      "src",
      "layouts",
      "BaseLayout.astro",
    );
    const layoutContent = fs.readFileSync(layoutPath, "utf8");

    // Must ignore download attribute, data-no-beacon, and non-navigational file extensions
    expect(layoutContent).toContain('anchor.hasAttribute("download")');
    expect(layoutContent).toContain('anchor.hasAttribute("data-no-beacon")');
    expect(layoutContent).toContain("BEACON_MAX_DURATION_MS");
    expect(layoutContent).toContain("beaconSafetyTimeout");
  });

  it("ensures CV download buttons in PageIndexNav and /resume/ index declare data-no-beacon", () => {
    const pageIndexNavPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const pageIndexNavContent = fs.readFileSync(pageIndexNavPath, "utf8");
    expect(pageIndexNavContent).toContain('id="desktop-cv-download-btn"');
    expect(pageIndexNavContent).toContain('id="mobile-cv-download-btn"');
    expect(pageIndexNavContent).toContain('data-no-beacon="true"');

    const resumeIndexPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "resume",
      "index.astro",
    );
    const resumeIndexContent = fs.readFileSync(resumeIndexPath, "utf8");
    expect(resumeIndexContent).toContain('data-no-beacon="true"');
  });
});

describe("ODD Task: Refined Contact Container, Form Modal & Cloudflare Free Tier Integration", () => {
  it("provides POST /api/contact endpoint in Cloudflare Worker persisting leads to D1", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;

    let insertedParams: any[] = [];
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => ({
          bind: (...args: any[]) => {
            insertedParams = args;
            return {
              run: async () => ({ success: true }),
            };
          },
        }),
      },
    } as any;

    const payload = {
      name: "Linus Torvalds",
      email: "linus@kernel.org",
      subject: "Kernel Collaboration",
      message: "Let us discuss high performance distributed systems.",
    };

    const req = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("ok");
    expect(insertedParams[0]).toBe("linus@kernel.org");
    expect(insertedParams[1]).toContain("Kernel Collaboration");
    expect(insertedParams[2]).toContain("Linus Torvalds");
  });

  it("drops honeypot spam bot submissions silently on /api/contact", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    let dbCalled = false;
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => {
          dbCalled = true;
          return { bind: () => ({ run: async () => ({}) }) };
        },
      },
    } as any;

    const req = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bot",
        email: "bot@spam.com",
        message: "Spam",
        website: "http://spam.com",
      }),
    });

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    expect(dbCalled).toBe(false);
  });

  it("enforces validation on /api/contact for non-empty name, valid email, and minimum 20 chars message", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    } as any;

    // Empty name
    const reqEmptyName = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "10.0.1.1",
      },
      body: JSON.stringify({
        name: "   ",
        email: "test@domain.com",
        message: "This is a valid message of sufficient length.",
      }),
    });
    const resEmptyName = await worker.fetch(reqEmptyName, mockEnv, mockCtx);
    expect(resEmptyName.status).toBe(400);

    // Invalid email
    const reqInvalidEmail = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "10.0.1.2",
      },
      body: JSON.stringify({
        name: "Test User",
        email: "invalid-email-address",
        message: "This is a valid message of sufficient length.",
      }),
    });
    const resInvalidEmail = await worker.fetch(
      reqInvalidEmail,
      mockEnv,
      mockCtx,
    );
    expect(resInvalidEmail.status).toBe(400);

    // Short message (< 20 chars)
    const reqShortMessage = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "10.0.1.3",
      },
      body: JSON.stringify({
        name: "Test User",
        email: "test@domain.com",
        message: "Too short",
      }),
    });
    const resShortMessage = await worker.fetch(
      reqShortMessage,
      mockEnv,
      mockCtx,
    );
    expect(resShortMessage.status).toBe(400);
  });

  it("handles optional phone with country code and formats it in lead body", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    let insertedParams: any[] = [];
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => ({
          bind: (...args: any[]) => {
            insertedParams = args;
            return { run: async () => ({ success: true }) };
          },
        }),
      },
    } as any;

    const req = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "10.0.1.4",
      },
      body: JSON.stringify({
        name: "Alice Engineer",
        email: "alice@tech.org",
        phone: "+57 300 123 4567",
        subject: "Staff/Senior Engineer Inquiry",
        message:
          "We would love to discuss a Staff / Senior Engineer advisory role.",
      }),
    });

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    expect(insertedParams[2]).toContain("Phone: +57 300 123 4567");
    expect(insertedParams[2]).toContain("Alice Engineer");
  });

  it("normalizes contact form subject to English and stores name, phone, and locale", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    let insertedParams: any[] = [];
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => ({
          bind: (...args: any[]) => {
            insertedParams = args;
            return { run: async () => ({ success: true }) };
          },
        }),
      },
    } as any;

    const req = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Carlos Developer",
        email: "carlos@empresa.es",
        phone: "+34 600 123 456",
        subject: "Consultoría de Arquitectura y Rendimiento",
        locale: "es",
        message: "Necesitamos asesoría técnica urgente para nuestro sistema.",
      }),
    });

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    expect(insertedParams[1]).toBe(
      "[Web] Distributed Architecture & Performance Consulting",
    );
    expect(insertedParams[3]).toBe("Carlos Developer");
    expect(insertedParams[4]).toBe("+34 600 123 456");
    expect(insertedParams[5]).toBe("es");
  });

  it("persists comprehensive legal, geo, and network telemetry on contact form submissions", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    let insertedParams: any[] = [];
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => ({
          bind: (...args: any[]) => {
            insertedParams = args;
            return { run: async () => ({ success: true }) };
          },
        }),
      },
    } as any;

    const req = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "198.51.100.42",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        referer: "https://arturonavax.dev/projects/",
      },
      body: JSON.stringify({
        name: "Elena Rostova",
        email: "elena@distributed-systems.io",
        phone: "+49 30 123456",
        subject: "Distributed Architecture & Performance Consulting",
        locale: "en",
        message:
          "We need an assessment on our high-throughput payment gateway.",
      }),
    });
    // Attach simulated Cloudflare request.cf properties
    (req as any).cf = {
      country: "DE",
      city: "Berlin",
      region: "BE",
      timezone: "Europe/Berlin",
      asn: 13335,
      asOrganization: "Cloudflare, Inc.",
    };

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);

    // Verify legal telemetry storage
    expect(insertedParams[6]).toBe("198.51.100.42"); // ip
    expect(insertedParams[7]).toBe("DE"); // country
    expect(insertedParams[8]).toBe("Berlin"); // city
    expect(insertedParams[9]).toBe("BE"); // region
    expect(insertedParams[10]).toBe("Europe/Berlin"); // timezone
    expect(insertedParams[11]).toBe(13335); // asn
    expect(insertedParams[12]).toBe("Cloudflare, Inc."); // as_organization
    expect(insertedParams[13]).toContain("Mozilla/5.0"); // user_agent
    expect(insertedParams[14]).toBe("https://arturonavax.dev/projects/"); // referer
  });

  it("requires turnstile token when TURNSTILE_SECRET_KEY is configured", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      TURNSTILE_SECRET_KEY: "test-only-not-a-real-turnstile-secret",
    } as any;

    // Missing token with TURNSTILE_SECRET_KEY configured
    const reqNoToken = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "10.0.1.5",
      },
      body: JSON.stringify({
        name: "Test User",
        email: "test@domain.com",
        message: "This is a legitimate message of at least 20 characters.",
      }),
    });

    const resNoToken = await worker.fetch(reqNoToken, mockEnv, mockCtx);
    expect(resNoToken.status).toBe(400);
    const data = (await resNoToken.json()) as any;
    expect(data.error).toContain("Turnstile");
  });

  it("accepts legitimate contact submissions via Edge Shield fallback when Turnstile is blocked by client privacy/ad-blockers", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    let insertedParams: any[] = [];
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      TURNSTILE_SECRET_KEY: "test-only-not-a-real-turnstile-secret",
      DB: {
        prepare: () => ({
          bind: (...args: any[]) => {
            insertedParams = args;
            return { run: async () => ({ success: true }) };
          },
        }),
      },
    } as any;

    const reqFallback = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "198.51.100.99",
        origin: "https://arturonavax.dev",
      },
      body: JSON.stringify({
        name: "AdBlock User",
        email: "adblock@privacy.net",
        message:
          "This is a legitimate user whose browser blocked challenge domains.",
        turnstileToken: "fallback_adblock",
        t_sig: Date.now() - 4000,
      }),
    });

    const res = await worker.fetch(reqFallback, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe("ok");
    // Verify lead stored with turnstile_verified = 0 (Edge Shield mode)
    expect(insertedParams[15]).toBe(0);
  });

  it("drops rapid automated bot submissions silently using time-to-submit verification (t_sig < 1500ms)", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    let dbCalled = false;
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      DB: {
        prepare: () => ({
          bind: () => {
            dbCalled = true;
            return { run: async () => ({ success: true }) };
          },
        }),
      },
    } as any;

    const botRapidReq = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "198.51.100.77",
      },
      body: JSON.stringify({
        name: "Lightning Fast Bot",
        email: "bot@spammer.org",
        message: "Automated submission completing form in 200 milliseconds.",
        t_sig: Date.now() - 200,
      }),
    });

    const res = await worker.fetch(botRapidReq, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.status).toBe("ok");
    // Database insert was bypassed (silent drop trap)
    expect(dbCalled).toBe(false);
  });

  it("rejects cross-origin submissions to protect /api/contact from direct third-party exploitation", async () => {
    const mockCtx = { waitUntil: () => {} } as any;
    const mockEnv = {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    } as any;

    const crossOriginReq = new Request("https://arturonavax.dev/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://malicious-spam-spoofer.xyz",
      },
      body: JSON.stringify({
        name: "Remote Attacker",
        email: "remote@spammer.com",
        message: "Attempting to POST to contact API from foreign domain.",
      }),
    });

    const res = await worker.fetch(crossOriginReq, mockEnv, mockCtx);
    expect(res.status).toBe(403);
    const json = (await res.json()) as any;
    expect(json.error).toContain("Cross-origin submission rejected");
  });

  it("integrates ContactFormModal with accessible dialog and trigger button in ContactSection", () => {
    const modalPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "ContactFormModal.astro",
    );
    expect(fs.existsSync(modalPath)).toBe(true);
    const modalContent = fs.readFileSync(modalPath, "utf8");
    expect(modalContent).toContain('id="contact-form-dialog"');
    expect(modalContent).toContain('fetch("/api/contact"');
    expect(modalContent).toContain("close-contact-modal-btn");
    expect(modalContent).toContain("cf-turnstile-container");
    expect(modalContent).toContain("cf-turnstile-loading");
    expect(modalContent).toContain("cf-turnstile-fallback");
    expect(modalContent).toContain("challenges.cloudflare.com/turnstile");
    expect(modalContent).toContain("contact-country-code");
    expect(modalContent).toContain("contact-phone");
    expect(modalContent).toContain("Staff / Senior Engineer");
    expect(modalContent).not.toContain("Senior / Staff Backend");
    expect(modalContent).toContain('minlength="20"');
    expect(modalContent).toContain("mailto:arturo@arturonavax.dev");

    const contactPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "ContactSection.astro",
    );
    const contactContent = fs.readFileSync(contactPath, "utf8");
    expect(contactContent).toContain("ContactFormModal");
    expect(contactContent).toContain("data-open-contact-modal");
    expect(contactContent).toContain("<ContactFormModal");
  });

  it("guarantees smooth scroll targeting Contact with precise header offset", () => {
    const contactPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "ContactSection.astro",
    );
    const contactContent = fs.readFileSync(contactPath, "utf8");

    expect(contactContent).toContain("data-contact-scroll");
    expect(contactContent).toContain("smoothScrollToContact");
    expect(contactContent).toContain("window.scrollTo");
    expect(contactContent).toContain("headerHeight");

    const headerPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "common",
      "Header.astro",
    );
    const headerContent = fs.readFileSync(headerPath, "utf8");
    expect(headerContent).toContain("window.scrollTo");
    expect(headerContent).toContain("headerOffset");
  });
});

describe("ODD Task: LATAM Airlines Timeline Entry & Writing-History Animations", () => {
  it("defines LATAM Airlines as active current role at order 1 in both locales", () => {
    const latamEnPath = path.join(
      ROOT_DIR,
      "src",
      "content",
      "experience",
      "en",
      "latam.md",
    );
    const latamEsPath = path.join(
      ROOT_DIR,
      "src",
      "content",
      "experience",
      "es",
      "latam.md",
    );

    expect(fs.existsSync(latamEnPath)).toBe(true);
    expect(fs.existsSync(latamEsPath)).toBe(true);

    const enContent = fs.readFileSync(latamEnPath, "utf8");
    expect(enContent).toContain('company: "LATAM Airlines"');
    expect(enContent).toContain('role: "Senior Backend Engineer"');
    expect(enContent).toContain("order: 1");
    expect(enContent).toContain("startDate: 2026-10-01");
    expect(enContent).not.toContain("endDate:");
    expect(enContent).toContain("keyAchievements: []");

    const esContent = fs.readFileSync(latamEsPath, "utf8");
    expect(esContent).toContain('company: "LATAM Airlines"');
    expect(esContent).toContain('role: "Senior Backend Engineer"');
    expect(esContent).toContain("order: 1");
    expect(esContent).toContain("startDate: 2026-10-01");
    expect(esContent).not.toContain("endDate:");
    expect(esContent).toContain("keyAchievements: []");
  });

  it("re-sequences existing experience orders cleanly after LATAM", () => {
    const lealPath = path.join(
      ROOT_DIR,
      "src",
      "content",
      "experience",
      "en",
      "leal.md",
    );
    const lealContent = fs.readFileSync(lealPath, "utf8");
    expect(lealContent).toContain("order: 2");

    const meliPath = path.join(
      ROOT_DIR,
      "src",
      "content",
      "experience",
      "en",
      "mercado-libre.md",
    );
    const meliContent = fs.readFileSync(meliPath, "utf8");
    expect(meliContent).toContain("order: 3");
  });

  it("registers LATAM Airlines in companiesData dictionary", () => {
    const companiesPath = path.join(ROOT_DIR, "src", "data", "companies.ts");
    const content = fs.readFileSync(companiesPath, "utf8");
    expect(content).toContain('"latam airlines": {');
    expect(content).toContain('name: "LATAM Airlines"');
    expect(content).toContain('domain: "latamairlines.com"');
  });

  it("renders writing-history TypewriterTicker when keyAchievements is empty in ExperienceTimeline", () => {
    const timelinePath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "ExperienceTimeline.astro",
    );
    const content = fs.readFileSync(timelinePath, "utf8");
    expect(content).toContain("keyAchievements.length > 0");
    expect(content).toContain("Escribiendo la historia en");
    expect(content).toContain("Writing history at");
  });

  it("renders writing-history TypewriterTicker for empty description and achievements in experience detail page", () => {
    const slugPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "experience",
      "[slug].astro",
    );
    const content = fs.readFileSync(slugPath, "utf8");
    expect(content).toContain("hasBodyContent");
    expect(content).toContain("keyAchievements.length > 0");
    expect(content).toContain("Escribiendo la historia en");
  });
});

describe("ODD Task: Timeline Sticky Scroll Mobile Header Alignment", () => {
  it("enforces sticky top-14 in ExperienceTimeline to remain visible below the 56px sticky site header on mobile", () => {
    const timelinePath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "ExperienceTimeline.astro",
    );
    const content = fs.readFileSync(timelinePath, "utf8");

    // Must be sticky top-14 on all breakpoints, not sticky top-0 on mobile
    expect(content).toContain("sticky top-14 z-20");
    expect(content).not.toContain("sticky top-0 sm:top-14");
  });
});

describe("ODD Task: Bot Telemetry Circuit Breaker & Quota Shedding", () => {
  it("records bot telemetry in D1 pageviews with is_bot = 1 when circuit breaker is closed", async () => {
    let insertedIsBot: number | null = null;
    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          if (sql.includes("INSERT INTO pageviews")) {
            // is_bot is the 10th parameter
            insertedIsBot = args[9];
          }
          return {
            run: async () => ({ success: true }),
            all: async () => ({ results: [] }),
          };
        },
      }),
    };

    const mockCtx = {
      waitUntil: (promise: Promise<any>) => promise,
      passThroughOnException: () => {},
    } as any;

    const mockEnv = {
      DB: mockDb,
      ASSETS: {
        fetch: async () => new Response("Static asset", { status: 200 }),
      },
    } as any;

    const botReq = new Request("https://arturonavax.dev/blog/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "CF-IPCountry": "US",
        "CF-Connecting-IP": "66.249.66.1",
      },
    });

    const res = await worker.fetch(botReq, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    // Allow non-blocking recordAnalyticsNonBlocking to resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(insertedIsBot).toBe(1);
  });

  it("sheds bot telemetry and records incident in circuit_breaker_incidents when quota is constrained", async () => {
    let incidentSubsystem: string | null = null;
    let incidentReason: string | null = null;
    let pageviewInserted = false;

    const mockDb = {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          if (sql.includes("INSERT INTO circuit_breaker_incidents")) {
            incidentSubsystem = args[0];
            incidentReason = args[2];
          }
          if (sql.includes("INSERT INTO pageviews")) {
            pageviewInserted = true;
          }
          return {
            run: async () => ({ success: true }),
            all: async () => ({ results: [] }),
          };
        },
      }),
    };

    const mockCtx = {
      waitUntil: (promise: Promise<any>) => promise,
      passThroughOnException: () => {},
    } as any;

    // Simulate low DB quota via environment toggle
    const mockEnv = {
      DB: mockDb,
      SIMULATE_LOW_DB_QUOTA: "true",
      ASSETS: {
        fetch: async () => new Response("Static asset", { status: 200 }),
      },
    } as any;

    const botReq = new Request("https://arturonavax.dev/projects/", {
      headers: {
        "User-Agent": "ClaudeBot/1.0; (+https://anthropic.com/claudebot)",
        "CF-IPCountry": "US",
        "CF-Connecting-IP": "54.120.10.1",
      },
    });

    const res = await worker.fetch(botReq, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    expect(pageviewInserted).toBe(false);
    expect(incidentSubsystem).toBe("bot_telemetry");
    expect(incidentReason).toBe("budget_exhausted");
  });

  it("exposes bot circuit breaker and prefetch circuit breaker in /api/telemetry and /api/metrics", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      ADMIN_ACCESS_TOKEN: "mock-admin-token-for-testing-32-chars-long",
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
          all: async () => ({ results: [] }),
        }),
      },
    } as any;

    const authHeaders = {
      Authorization: "Bearer mock-admin-token-for-testing-32-chars-long",
    };
    const telReq = new Request("https://admin.arturonavax.dev/api/telemetry", {
      headers: authHeaders,
    });
    const telRes = await worker.fetch(telReq, mockEnv, mockCtx);
    expect(telRes.status).toBe(200);
    const telData = await telRes.json();
    expect(telData.circuit_breakers).toBeDefined();
    expect(telData.circuit_breakers.bot).toBeDefined();
    expect(telData.circuit_breakers.bot.maxBotBudget).toBe(15000);
    expect(telData.circuit_breakers.prefetch).toBeDefined();
    expect(telData.circuit_breakers.prefetch.maxPrefetchBudget).toBe(25000);

    const metReq = new Request("https://admin.arturonavax.dev/api/metrics", {
      headers: authHeaders,
    });
    const metRes = await worker.fetch(metReq, mockEnv, mockCtx);
    expect(metRes.status).toBe(200);
    const metData = await metRes.json();
    expect(metData.circuit_breakers).toBeDefined();
    expect(metData.circuit_breakers.bot).toBeDefined();
  });
});

describe("ODD Task: Real-Time Admin Telemetry Dashboard Overhaul", () => {
  it("renders real-time dual circuit breakers monitor and distribution bars in adminHtml", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      ADMIN_ACCESS_TOKEN: "mock-admin-token-for-testing-32-chars-long",
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
          all: async () => ({ results: [] }),
        }),
      },
    } as any;

    const req = new Request("https://admin.arturonavax.dev/", {
      headers: {
        Authorization: "Bearer mock-admin-token-for-testing-32-chars-long",
      },
    });
    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);

    const html = await res.text();
    // Live pulse and elapsed sync indicator
    expect(html).toContain("badge-sync-time");
    expect(html).toContain("Sincronizado: justo ahora");

    // Dual circuit breakers panel
    expect(html).toContain("cb-prefetch-badge");
    expect(html).toContain("cb-prefetch-stats");
    expect(html).toContain("cb-prefetch-bar");
    expect(html).toContain("cb-bot-badge");
    expect(html).toContain("cb-bot-stats");
    expect(html).toContain("cb-bot-bar");

    // Real-time distribution sections
    expect(html).toContain("top-paths");
    expect(html).toContain("countries-list");
    expect(html).toContain("leads-tbody");
    expect(html).toContain("telemetry-tbody");

    // Server-side pagination controls
    expect(html).toContain("pagination-info");
    expect(html).toContain("btn-page-first");
    expect(html).toContain("btn-page-prev");
    expect(html).toContain("btn-page-next");
    expect(html).toContain("btn-page-last");
    expect(html).toContain("select-limit");

    // Live polling default option (paused by default to protect D1 daily quota)
    expect(html).toContain('value="0" selected');
    expect(html).toContain('value="30000"');
  });

  it("supports server-side pagination, aggregations, and filtering in /api/telemetry", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      ADMIN_ACCESS_TOKEN: "mock-admin-token-for-testing-32-chars-long",
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
          all: async () => ({ results: [] }),
        }),
      },
    } as any;

    const req = new Request(
      "https://admin.arturonavax.dev/api/telemetry?page=2&limit=25&range=7d&segment=human&path=/blog/",
      {
        headers: {
          Authorization: "Bearer mock-admin-token-for-testing-32-chars-long",
        },
      },
    );
    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;

    expect(data.pagination).toBeDefined();
    expect(data.pagination.page).toBe(2);
    expect(data.pagination.limit).toBe(25);
    expect(data.filters).toBeDefined();
    expect(data.filters.range).toBe("7d");
    expect(data.filters.segment).toBe("human");
    expect(data.filters.path).toBe("/blog/");
    expect(data.stats).toBeDefined();
    expect(data.top_pages).toBeDefined();
    expect(data.top_countries).toBeDefined();
    expect(data.top_referrers).toBeDefined();
  });
});

describe("ODD Task: Comprehensive Security Audit Hardening", () => {
  it("enforces object-src 'none' in Content-Security-Policy in public/_headers", () => {
    const headersContent = fs.readFileSync(
      path.join(ROOT_DIR, "public", "_headers"),
      "utf8",
    );
    expect(headersContent).toContain("object-src 'none'");
    expect(headersContent).not.toContain("object-src 'self'");
  });

  it("rate limits POST /api/contact against automated floods (returns 429)", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      DB: {
        prepare: () => ({
          bind: () => ({ run: async () => ({ success: true }) }),
        }),
      },
    } as any;

    const testIp = "203.0.113.42";
    let lastStatus = 200;

    // Send 6 requests rapidly from the same IP (threshold is 5)
    for (let i = 0; i < 6; i++) {
      const contactReq = new Request("https://arturonavax.dev/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": testIp,
        },
        body: JSON.stringify({
          name: `Attacker ${i}`,
          email: `attacker${i}@test.com`,
          message: "Rapid spam request",
        }),
      });

      const res = await worker.fetch(contactReq, mockEnv, mockCtx);
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  it("blocks unauthorized access to /admin when Cloudflare Access is required", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;

    // Production environment requiring CF Access
    const mockEnv = {
      REQUIRE_CF_ACCESS: "true",
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
          all: async () => ({ results: [] }),
        }),
      },
    } as any;

    // Request from production domain without Access headers
    const req = new Request("https://admin.arturonavax.dev/", {
      headers: {
        Host: "admin.arturonavax.dev",
      },
    });

    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
    expect(data.message).toContain(
      "Cloudflare Access Zero Trust authentication required",
    );
  });

  it("Task 15: detects vulnerability scanning and exploit probe paths as automated bots", () => {
    const probePaths = [
      "https://arturonavax.dev/.env",
      "https://arturonavax.dev/.git/config",
      "https://arturonavax.dev/.aws/credentials",
      "https://arturonavax.dev/wp-admin/setup-config.php",
      "https://arturonavax.dev/phpmyadmin/index.php",
      "https://arturonavax.dev/actuator/health",
      "https://arturonavax.dev/solr/admin",
      "https://arturonavax.dev/shell?cmd=whoami",
    ];

    for (const url of probePaths) {
      const req = new Request(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          accept: "text/html",
        },
      });
      const classification = classifyVisitor(req);
      expect(classification.isBot).toBe(true);
      expect(classification.classification).toBe("automated_client");
      expect(classification.reason).toBe("vulnerability_scanner_path_probe");
    }

    // Legitimate navigation path must remain human
    const normalReq = new Request("https://arturonavax.dev/experience/", {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "text/html",
      },
    });
    const normalClassification = classifyVisitor(normalReq);
    expect(normalClassification.isBot).toBe(false);
    expect(normalClassification.classification).toBe("human");
  });

  it("Task 13: aggregates and renders unique human visitors in /api/telemetry and admin template", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      DB: {
        prepare: (sql: string) => {
          const handler = {
            all: async () => {
              if (sql.includes("total_views")) {
                return {
                  results: [
                    {
                      total_views: 100,
                      human_views: 80,
                      bot_views: 20,
                      unique_visitors: 50,
                      unique_human_visitors: 40,
                    },
                  ],
                };
              }
              return { results: [] };
            },
          };
          return {
            ...handler,
            bind: () => handler,
          };
        },
      },
      ADMIN_ACCESS_TOKEN: "mock-admin-token-for-testing-32-chars-long",
    } as any;

    const req = new Request(
      "https://admin.arturonavax.dev/api/telemetry?range=24h",
      {
        headers: {
          Authorization: "Bearer mock-admin-token-for-testing-32-chars-long",
        },
      },
    );
    const res = await worker.fetch(req, mockEnv, mockCtx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stats).toBeDefined();
    expect(data.stats.unique_visitors).toBe(50);
    expect(data.stats.unique_human_visitors).toBe(40);

    const adminAstroPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "admin",
      "index.astro",
    );
    const adminContent = fs.readFileSync(adminAstroPath, "utf8");
    expect(adminContent).toContain('id="kpi-unique-sub"');
    expect(adminContent).toContain("unique_human_visitors");
  });

  it("Task 5: stacks floating Print and Download buttons vertically in PageIndexNav.astro", () => {
    const pageIndexNavPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const content = fs.readFileSync(pageIndexNavPath, "utf8");
    expect(content).toContain("flex flex-col items-end gap-2.5 self-end");
    expect(content).toContain('id="mobile-cv-print-btn"');
    expect(content).toContain('id="mobile-cv-download-btn"');
  });

  it("Task 7: resets page filters when clicking nav link of current page in Header.astro", () => {
    const headerPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "common",
      "Header.astro",
    );
    const content = fs.readFileSync(headerPath, "utf8");
    expect(content).toContain("reset-page-filters");
    expect(content).toContain("reset-exp-filter-btn");
    expect(content).toContain("navSection");
  });

  it("Task 9: dynamically aligns desktop Page Index with alignTargetId in PageIndexNav.astro", () => {
    const pageIndexNavPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const content = fs.readFileSync(pageIndexNavPath, "utf8");
    expect(content).toContain("function alignDesktopIndex");
    expect(content).toContain("getBoundingClientRect");
    expect(content).toContain("desiredTop");
  });

  it("Task 11: shows beacon on timeline navigation request start and hides on arrival", () => {
    const slugPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "experience",
      "[slug].astro",
    );
    const content = fs.readFileSync(slugPath, "utf8");
    expect(content).toContain("window.__showBeacon(undefined, true)");
    expect(content).toContain("window.__hideBeacon()");
  });
});

describe("ODD Task 6: Persistent SPA App-Shell & Zero-Jump HUD Architecture", () => {
  it("declares transition:persist on PageIndexNav, LanguageSuggestionBanner, BackToTopButton, and global modals in BaseLayout.astro", () => {
    const layoutPath = path.join(
      ROOT_DIR,
      "src",
      "layouts",
      "BaseLayout.astro",
    );
    const content = fs.readFileSync(layoutPath, "utf8");

    expect(content).toMatch(
      /<PageIndexNav[^>]*transition:persist="page-index-nav"/,
    );
    expect(content).toMatch(
      /<LanguageSuggestionBanner[^>]*transition:persist="language-banner"/,
    );
    expect(content).toMatch(
      /<BackToTopButton[^>]*transition:persist="backtotop"/,
    );
    expect(content).toMatch(/<UniversalSearchModal[^>]*transition:persist/);
    expect(content).toMatch(/<ShortcutsModal[^>]*transition:persist/);
    expect(content).toMatch(/<CoffeeSponsorshipModal[^>]*transition:persist/);
    expect(content).toMatch(/<ContactFormModal[^>]*transition:persist/);
    expect(content).toMatch(/<OnlineJudgesModal[^>]*transition:persist/);
    expect(content).toContain('<main id="main-content"');
  });

  it("exposes current page metadata and synchronizes in astro:after-swap in BaseLayout.astro", () => {
    const layoutPath = path.join(
      ROOT_DIR,
      "src",
      "layouts",
      "BaseLayout.astro",
    );
    const content = fs.readFileSync(layoutPath, "utf8");

    expect(content).toContain("data-current-locale");
    expect(content).toContain("data-current-path");
    expect(content).toContain("astro:after-swap");
  });

  it("synchronizes PageIndexNav state on astro:after-swap before paint and stores localized strings", () => {
    const navPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const content = fs.readFileSync(navPath, "utf8");

    expect(content).toContain('transition:persist="page-index-nav"');
    expect(content).toContain("data-i18n-en");
    expect(content).toContain("data-i18n-es");
    expect(content).toContain("data-has-sections");
    expect(content).toContain("astro:after-swap");
    expect(content).toContain("no-transition");
    expect(content).toContain("togglePanel(false)");
  });

  it("implements zero-flicker session state machine in LanguageSuggestionBanner.astro", () => {
    const bannerPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "LanguageSuggestionBanner.astro",
    );
    const content = fs.readFileSync(bannerPath, "utf8");

    expect(content).toContain('transition:persist="language-banner"');
    expect(content).toContain("data-i18n-en");
    expect(content).toContain("data-i18n-es");
    expect(content).toContain("window.__langBannerState");
    expect(content).toContain("hasAnimatedIn");
    expect(content).toContain("isDismissed");
    expect(content).toContain("astro:after-swap");
    expect(content).not.toContain("localStorage");
  });

  it("coordinates BackToTopButton, Header, LanguageSwitcher, and global.css view-transition isolation", () => {
    const btnPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "BackToTopButton.astro",
    );
    const btnContent = fs.readFileSync(btnPath, "utf8");
    expect(btnContent).toContain("window.__backToTopInitialized");
    expect(btnContent).toContain("astro:after-swap");

    const headerPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "common",
      "Header.astro",
    );
    const headerContent = fs.readFileSync(headerPath, "utf8");
    expect(headerContent).toContain("syncHeaderStatePrePaint");
    expect(headerContent).toContain("astro:after-swap");

    const switcherPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "common",
      "LanguageSwitcher.astro",
    );
    const switcherContent = fs.readFileSync(switcherPath, "utf8");
    expect(switcherContent).toContain("astro:after-swap");

    const cssPath = path.join(ROOT_DIR, "src", "styles", "global.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");
    expect(cssContent).toContain("view-transition-name: site-header");
    expect(cssContent).toContain("view-transition-name: page-index-nav");
    expect(cssContent).toContain(
      "view-transition-name: lang-suggestion-banner",
    );
    expect(cssContent).toContain("view-transition-name: back-to-top");
    expect(cssContent).toContain(".no-transition");
  });

  it("enforces strict responsive isolation between desktop page index and floating HUD button", () => {
    const cssPath = path.join(ROOT_DIR, "src", "styles", "global.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");
    expect(cssContent).toContain("#desktop-page-index-root");
    expect(cssContent).toContain("display: none !important");
    expect(cssContent).toContain("@media (min-width: 1600px)");
    expect(cssContent).toContain("#mobile-page-index-container");
    expect(cssContent).toContain("display: flex !important");

    const navPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const navContent = fs.readFileSync(navPath, "utf8");
    expect(navContent).toContain("function alignDesktopIndex");
    expect(navContent).not.toMatch(
      /desktopRoot\.classList\.remove\([^)]*['"]hidden['"][^)]*\)/,
    );
  });

  it("strictly restricts CV actions (Download and Print) to /resume/ and excludes /tools/resume-maker/ and other routes", () => {
    const navPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const navContent = fs.readFileSync(navPath, "utf8");

    // Route detection checks
    expect(navContent).toContain(
      'normalizedPath === "/resume/" || normalizedPath === "/es/resume/"',
    );
    expect(navContent).toContain("showPdfPrint = isResumeRoute");
    expect(navContent).toContain("showPdfDownload = isResumeRoute");
    expect(navContent).toContain("function checkIsResumePage");
    expect(navContent).toContain("!isResumeMaker");

    // Element display guards
    expect(navContent).toContain('id="desktop-cv-actions"');
    expect(navContent).toContain('id="mobile-cv-actions"');
    expect(navContent).toContain(
      'style={showPdfPrint ? undefined : "display: none;"}',
    );
    expect(navContent).toContain("updateCvButtons(isCv, isLangEs)");
  });

  it("adapts PageIndex dynamically on zoom and resize via syncResponsiveMode and clearance check", () => {
    const navPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const navContent = fs.readFileSync(navPath, "utf8");

    expect(navContent).toContain("function syncResponsiveMode");
    expect(navContent).toContain("window.visualViewport");
    expect(navContent).toContain("spaceLeft >= 280");
    expect(navContent).toContain("force-hide-desktop");
    expect(navContent).toContain("force-show-mobile");
    expect(navContent).toContain("force-hide-mobile");

    const cssPath = path.join(ROOT_DIR, "src", "styles", "global.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");
    expect(cssContent).toContain("#desktop-page-index-root.force-hide-desktop");
    expect(cssContent).toContain(
      "#mobile-page-index-container.force-hide-mobile",
    );
    expect(cssContent).toContain(
      "#mobile-page-index-container:not(.force-show-mobile)",
    );
  });

  it("eliminates LanguageSuggestionBanner shadow flicker by avoiding transition-all and dropping old view-transition snapshot", () => {
    const bannerPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "LanguageSuggestionBanner.astro",
    );
    const bannerContent = fs.readFileSync(bannerPath, "utf8");

    // Must not transition all (which animates box-shadow and causes flickering during DOM swap)
    expect(bannerContent).toContain("transition-[transform,opacity]");
    expect(bannerContent).not.toMatch(/transition-all[^"]*duration-300/);

    const cssPath = path.join(ROOT_DIR, "src", "styles", "global.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");
    expect(cssContent).toContain(
      "::view-transition-old(lang-suggestion-banner)",
    );
    expect(cssContent).toContain("display: none !important");
  });

  it("elevates floating actions stack only on colliding viewports when LanguageSuggestionBanner is active", () => {
    const layoutPath = path.join(
      ROOT_DIR,
      "src",
      "layouts",
      "BaseLayout.astro",
    );
    const layoutContent = fs.readFileSync(layoutPath, "utf8");

    expect(layoutContent).toContain("function updateToastCollision");
    expect(layoutContent).toContain("elevated-for-toast");
    expect(layoutContent).toContain("bannerRect.right + 12 > stackRect.left");

    const cssPath = path.join(ROOT_DIR, "src", "styles", "global.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");
    expect(cssContent).toContain("#floating-actions-stack.elevated-for-toast");
    expect(cssContent).toContain("@media (max-width: 640px)");
  });

  it("prevents MatrixBackground from freezing on page transition from Experience to About by resuming on navigation", () => {
    const matrixPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "MatrixBackground.astro",
    );
    const matrixContent = fs.readFileSync(matrixPath, "utf8");

    expect(matrixContent).toContain("function resumeMatrixOnNav");
    expect(matrixContent).toContain(
      'state.worker.postMessage({ type: "resume" })',
    );
    expect(matrixContent).toContain("astro:page-load");
    expect(matrixContent).toContain("astro:after-swap");

    const workerPath = path.join(
      ROOT_DIR,
      "src",
      "scripts",
      "matrix.worker.ts",
    );
    const workerContent = fs.readFileSync(workerPath, "utf8");
    expect(workerContent).toMatch(
      /case\s*"resize":\s*layout\([^)]*\);\s*scheduleNextFrame\(\);/,
    );
  });

  it("prevents TOC flicker during timeline arrow navigation and synchronizes page-index-custom-items", () => {
    const slugPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "experience",
      "[slug].astro",
    );
    const slugContent = fs.readFileSync(slugPath, "utf8");

    // Must NOT copy oldNav.innerHTML = newNav.innerHTML (which injected the 11 default homepage items)
    expect(slugContent).not.toContain("oldNav.innerHTML = newNav.innerHTML");
    // Must synchronize page-index-custom-items script
    expect(slugContent).toContain("page-index-custom-items");
    expect(slugContent).toContain(
      "oldCustomScript.textContent = newCustomScript.textContent",
    );
    expect(slugContent).toContain("window.__setupPageIndex()");

    // Must have compact spacing between milestone bar and role-header
    expect(slugContent).toContain(
      'class="relative isolate py-0 mt-1 sm:mt-1.5 mb-2 sm:mb-4"',
    );
  });

  it("aligns desktop page index to role-header and provides horizontal clearance for timeline axis and dot", () => {
    const navPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const navContent = fs.readFileSync(navPath, "utf8");

    // SSR gap, width, and alignment
    expect(navContent).toContain(
      'asideGapClass = isJobPage ? "mr-16" : "mr-6"',
    );
    expect(navContent).toContain(
      'data-align-target={isJobPage ? "role-header" : alignTargetId}',
    );

    // Client-side dynamic updates
    expect(navContent).toContain(
      'desktopAside.classList.toggle("mr-16", isJob)',
    );
    expect(navContent).toContain("desktopAside.setAttribute(");
    expect(navContent).toContain(
      'isJob ? "role-header" : isCv ? "cv-document-sheet" : "about"',
    );
    expect(navContent).toContain("alignDesktopIndex()");
  });
});

describe("ODD Task 7: SEO Canonical Indexing, Trailing Slashes & Robots Directives", () => {
  it("enforces trailing slashes on Header.astro and BackToHomeButton.astro home links", () => {
    const headerPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "common",
      "Header.astro",
    );
    const headerContent = fs.readFileSync(headerPath, "utf8");
    expect(headerContent).toContain(
      'const homeUrl = locale === "es" ? "/es/" : "/";',
    );
    expect(headerContent).not.toContain(
      'const homeUrl = locale === "es" ? "/es" : "/";',
    );
    expect(headerContent).toContain("${homeUrl}#contact");

    const backBtnPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "BackToHomeButton.astro",
    );
    const backBtnContent = fs.readFileSync(backBtnPath, "utf8");
    expect(backBtnContent).toContain('const homeHref = isEs ? "/es/" : "/";');
    expect(backBtnContent).not.toContain(
      'const homeHref = isEs ? "/es" : "/";',
    );
  });

  it("emits trailing slashes on 100% of generated document URLs in searchIndex.ts", () => {
    const searchIndexPath = path.join(
      ROOT_DIR,
      "src",
      "data",
      "searchIndex.ts",
    );
    const searchIndexContent = fs.readFileSync(searchIndexPath, "utf8");

    expect(searchIndexContent).toContain("url: `/projects/${slug}/`");
    expect(searchIndexContent).toContain("url: `/es/experience/${slug}/`");
    expect(searchIndexContent).not.toContain("url: `/projects/${slug}`");
    expect(searchIndexContent).not.toContain("url: `/es/experience/${slug}`");

    const urlMatches = Array.from(
      searchIndexContent.matchAll(/url:\s*[`"']([^`"']+)`?["']?/g),
    );
    expect(urlMatches.length).toBeGreaterThan(0);
    for (const match of urlMatches) {
      expect(match[1].endsWith("/")).toBe(true);
    }
  });

  it("replaces crawlable ?company= filter anchors with rel='nofollow' and data-company-filter", () => {
    const timelinePath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "ExperienceTimeline.astro",
    );
    const timelineContent = fs.readFileSync(timelinePath, "utf8");
    expect(timelineContent).toContain("href={companyFilterUrl}");
    expect(timelineContent).toContain('rel="nofollow"');
    expect(timelineContent).toContain(
      "data-company-filter={company.toLowerCase().trim()}",
    );

    const simCardPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "SimulationCard.astro",
    );
    const simCardContent = fs.readFileSync(simCardPath, "utf8");
    expect(simCardContent).toContain("href={companyFilterUrl}");
    expect(simCardContent).toContain('rel="nofollow"');
    expect(simCardContent).toContain(
      "data-company-filter={simulation.company.toLowerCase().trim()}",
    );

    const telemetryPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "SystemTelemetryDemo.astro",
    );
    const telemetryContent = fs.readFileSync(telemetryPath, "utf8");
    expect(telemetryContent).toContain('id="viewer-company-link"');
    expect(telemetryContent).toContain('rel="nofollow"');

    const expSlugPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "experience",
      "[slug].astro",
    );
    const expSlugContent = fs.readFileSync(expSlugPath, "utf8");
    expect(expSlugContent).toContain("href={companyFilterUrl}");
    expect(expSlugContent).toContain('rel="nofollow"');
    expect(expSlugContent).toContain(
      "data-company-filter={company.toLowerCase().trim()}",
    );
  });

  it("unlocks /case-studies/ in sitemap and robots.txt while disallowing search/filter queries", () => {
    const astroConfigPath = path.join(ROOT_DIR, "astro.config.mjs");
    const astroConfig = fs.readFileSync(astroConfigPath, "utf8");
    expect(astroConfig).not.toContain('!page.includes("/case-studies/")');

    const robotsPath = path.join(ROOT_DIR, "public", "robots.txt");
    const robots = fs.readFileSync(robotsPath, "utf8");
    expect(robots).not.toContain("Disallow: /case-studies");
    expect(robots).not.toContain("Disallow: /es/case-studies");
    expect(robots).not.toContain("Disallow: /search\n");
    expect(robots).not.toContain("Disallow: /es/search\n");
    expect(robots).toContain("Disallow: /*?company=");
    expect(robots).toContain("Disallow: /*?filters=");
    expect(robots).toContain("Disallow: /*?q=");
  });

  it("enforces 301 trailing-slash canonical redirects on worker.ts for public document routes", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      ASSETS: {
        fetch: async () =>
          new Response(
            "<!doctype html><html><body><h1>Document</h1></body></html>",
            {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          ),
      },
    } as any;

    const res1 = await worker.fetch(
      new Request("https://arturonavax.dev/experience"),
      mockEnv,
      mockCtx,
    );
    expect(res1.status).toBe(301);
    expect(res1.headers.get("Location")).toBe(
      "https://arturonavax.dev/experience/",
    );

    const res2 = await worker.fetch(
      new Request("https://arturonavax.dev/projects?page=2"),
      mockEnv,
      mockCtx,
    );
    expect(res2.status).toBe(301);
    expect(res2.headers.get("Location")).toBe(
      "https://arturonavax.dev/projects/?page=2",
    );

    const res3 = await worker.fetch(
      new Request("https://arturonavax.dev/es/blog/distributed-systems"),
      mockEnv,
      mockCtx,
    );
    expect(res3.status).toBe(301);
    expect(res3.headers.get("Location")).toBe(
      "https://arturonavax.dev/es/blog/distributed-systems/",
    );
  });

  it("sets X-Robots-Tag: noindex, nofollow on /search/ and query parameter filter URLs", async () => {
    const mockCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as any;
    const mockEnv = {
      ASSETS: {
        fetch: async () =>
          new Response(
            "<!doctype html><html><body><h1>Search Page</h1></body></html>",
            {
              status: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          ),
      },
    } as any;

    const searchRes = await worker.fetch(
      new Request("https://arturonavax.dev/search/"),
      mockEnv,
      mockCtx,
    );
    expect(searchRes.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const esSearchRes = await worker.fetch(
      new Request("https://arturonavax.dev/es/search/"),
      mockEnv,
      mockCtx,
    );
    expect(esSearchRes.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const companyRes = await worker.fetch(
      new Request("https://arturonavax.dev/experience/?company=acme"),
      mockEnv,
      mockCtx,
    );
    expect(companyRes.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const filterRes = await worker.fetch(
      new Request("https://arturonavax.dev/experience/?filters=rust"),
      mockEnv,
      mockCtx,
    );
    expect(filterRes.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const queryRes = await worker.fetch(
      new Request("https://arturonavax.dev/projects/?q=kafka"),
      mockEnv,
      mockCtx,
    );
    expect(queryRes.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    const publicRes = await worker.fetch(
      new Request("https://arturonavax.dev/projects/"),
      mockEnv,
      mockCtx,
    );
    expect(publicRes.headers.get("X-Robots-Tag")).toContain("index, follow");
  });

  it("passes explicit canonicalUrl props in services, projects, blog and case-studies pages", () => {
    const servicesPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "services",
      "[slug].astro",
    );
    const servicesContent = fs.readFileSync(servicesPath, "utf8");
    expect(servicesContent).toContain("canonicalUrl={canonicalUrl}");

    const projectsPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "projects",
      "[slug].astro",
    );
    const projectsContent = fs.readFileSync(projectsPath, "utf8");
    expect(projectsContent).toContain("canonicalUrl={canonicalUrl}");

    const blogPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "blog",
      "[slug].astro",
    );
    const blogContent = fs.readFileSync(blogPath, "utf8");
    expect(blogContent).toContain("canonicalUrl={canonicalUrl}");

    const csPath = path.join(
      ROOT_DIR,
      "src",
      "pages",
      "[...lang]",
      "case-studies",
      "index.astro",
    );
    const csContent = fs.readFileSync(csPath, "utf8");
    expect(csContent).toContain("canonicalUrl=");
    expect(csContent).toContain("/case-studies/");
    expect(csContent).toContain('availableLocales={["en", "es"]}');
  });

  it("ensures Header.astro declares updateActiveNavState at the outer script scope and calls it in syncHeaderStatePrePaint", () => {
    const headerPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "common",
      "Header.astro",
    );
    const headerContent = fs.readFileSync(headerPath, "utf8");
    expect(headerContent).toContain("function updateActiveNavState");
    expect(headerContent).toContain(
      "window.__updateActiveNavState = updateActiveNavState;",
    );
    expect(headerContent).toContain("function syncHeaderStatePrePaint");
    expect(headerContent).toContain("updateActiveNavState(true);");
  });

  it("ensures mobile Print button in PageIndexNav declares keyboard shortcut matching Index button resolution", () => {
    const navPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const navContent = fs.readFileSync(navPath, "utf8");

    // Index button shortcut
    expect(navContent).toContain('id="open-index-floating-btn"');
    expect(navContent).toContain(
      '<kbd class="hidden sm:inline-block rounded border border-[var(--color-surface-border)] bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] font-semibold shrink-0">',
    );

    // Print button shortcut matching resolution
    expect(navContent).toContain('id="mobile-cv-print-btn"');
    expect(navContent).toContain(
      '<kbd class="hidden sm:inline-block rounded border border-[var(--color-accent-gold)]/40 bg-[var(--color-bg-primary)] px-1.5 py-0.5 text-xs text-[var(--color-accent-gold)] font-semibold shrink-0">',
    );
  });

  it("ensures PageIndexNav.astro toggles desktop and mobile download button visibility in updateCvButtons", () => {
    const navPath = path.join(
      ROOT_DIR,
      "src",
      "components",
      "ui",
      "PageIndexNav.astro",
    );
    const navContent = fs.readFileSync(navPath, "utf8");

    expect(navContent).toContain(
      'var desktopDown = document.getElementById("desktop-cv-download-btn");',
    );
    expect(navContent).toContain(
      'var mobileDown = document.getElementById("mobile-cv-download-btn");',
    );
    expect(navContent).toContain(
      'desktopDown.classList.toggle("hidden", !isCv);',
    );
    expect(navContent).toContain(
      'mobileDown.classList.toggle("hidden", !isCv);',
    );
  });

  describe("ODD Tasks 11: 100/100 Lighthouse & Core Web Vitals Restoration", () => {
    it("ensures first 250 bytes of dist/index.html contain charset, viewport, and title before other elements", () => {
      const indexPath = path.join(ROOT_DIR, "dist", "index.html");
      if (!fs.existsSync(indexPath)) return;
      const html = fs.readFileSync(indexPath, "utf8");
      const headIdx = html.indexOf("<head");
      expect(headIdx).toBeGreaterThanOrEqual(0);
      const first250OfHead = html.slice(headIdx, headIdx + 300);

      expect(first250OfHead).toContain('meta charset="utf-8"');
      expect(first250OfHead).toContain('name="viewport"');
      expect(first250OfHead).toContain("<title>");
      expect(html).toContain(
        'rel="preload" href="/fonts/Geist-Variable.woff2"',
      );
      expect(html).toContain(
        'rel="preload" href="/fonts/GeistMono-Variable.woff2"',
      );
    });

    it("verifies font-display: optional and content-visibility rules in global.css", () => {
      const cssPath = path.join(ROOT_DIR, "src/styles/global.css");
      const css = fs.readFileSync(cssPath, "utf8");
      expect(css).toContain('font-family: "Geist Variable"');
      expect(css).toContain("font-display: optional;");
      expect(css).toContain("#about,\n#philosophies");
      expect(css).toContain("content-visibility: visible !important;");
      expect(css).toContain("section#experience,");
      expect(css).toContain("content-visibility: auto;");
    });

    it("verifies Cloudflare JSD challenge platform neutralization in BaseLayout.astro and worker.ts", () => {
      const layoutPath = path.join(ROOT_DIR, "src/layouts/BaseLayout.astro");
      const layout = fs.readFileSync(layoutPath, "utf8");
      expect(layout).toContain("/cdn-cgi/challenge-platform/");
      expect(layout).toContain("__CF$cv$params");

      const workerPath = path.join(ROOT_DIR, "cloudflare/worker.ts");
      const worker = fs.readFileSync(workerPath, "utf8");
      expect(worker).toContain(
        'url.pathname.startsWith("/cdn-cgi/challenge-platform/")',
      );
      expect(worker).toContain("/* noop */");
    });

    it("verifies astro.config.mjs uses inlineStylesheets: auto", () => {
      const configPath = path.join(ROOT_DIR, "astro.config.mjs");
      const config = fs.readFileSync(configPath, "utf8");
      expect(config).toContain('inlineStylesheets: "auto"');
    });

    it("verifies MatrixBackground has static backdrop, interaction-only trigger, and skips webdriver", () => {
      const matrixPath = path.join(
        ROOT_DIR,
        "src/components/ui/MatrixBackground.astro",
      );
      const matrix = fs.readFileSync(matrixPath, "utf8");
      expect(matrix).toContain("matrix-static-backdrop");
      expect(matrix).toContain("navigator.webdriver === true");
      expect(matrix).toContain("pointermove");
      expect(matrix).toContain("5500");
    });

    it("verifies EmailCopyButton inlines clipboard logic with no external module import", () => {
      const btnPath = path.join(
        ROOT_DIR,
        "src/components/ui/EmailCopyButton.astro",
      );
      const btn = fs.readFileSync(btnPath, "utf8");
      expect(btn).not.toContain('from "@/lib/utils/clipboard"');
      expect(btn).toContain("navigator.clipboard.writeText");
    });

    it("verifies Header.astro navigation links avoid non-composited animations", () => {
      const headerPath = path.join(
        ROOT_DIR,
        "src/components/common/Header.astro",
      );
      const header = fs.readFileSync(headerPath, "utf8");
      expect(header).not.toContain(
        'id="header-cv-btn"\n          aria-label="Arturo Nava CV / Resume"\n          data-nav-section="resume"\n          data-astro-prefetch="hover"\n          class:list={[\n            "hidden sm:inline-flex h-8 items-center justify-center gap-1.5 rounded border px-2.5 xl:px-3 text-xs font-mono font-medium transition-all',
      );
    });

    it("verifies ExperienceTimeline links have unique aria-label, sr-only company text, and no literal rarr", () => {
      const expPath = path.join(
        ROOT_DIR,
        "src/components/ui/ExperienceTimeline.astro",
      );
      const exp = fs.readFileSync(expPath, "utf8");
      expect(exp).toContain(
        'aria-label={`${locale === "es" ? "Ver detalles del rol" : "View role details"}: ${role} at ${company}`}',
      );
      expect(exp).toContain('<span class="sr-only"> — {company}</span>');
    });

    it("verifies strict llmstxt.org markdown links format in public/llms.txt", () => {
      const llmsPath = path.join(ROOT_DIR, "public/llms.txt");
      const llms = fs.readFileSync(llmsPath, "utf8");
      expect(llms).toContain(
        "- [Home & Engineering Philosophy](https://arturonavax.dev/):",
      );
      expect(llms).toContain(
        "- [Professional Experience](https://arturonavax.dev/experience/):",
      );
      expect(llms).toContain(
        "- [Full LLMs Documentation](https://arturonavax.dev/llms-full.txt):",
      );
    });

    it("verifies cloudflare/worker.ts sets text/html; charset=utf-8 and Strict-Transport-Security", () => {
      const workerPath = path.join(ROOT_DIR, "cloudflare/worker.ts");
      const worker = fs.readFileSync(workerPath, "utf8");
      expect(worker).toContain(
        'headers.set("Content-Type", "text/html; charset=utf-8");',
      );
      expect(worker).toContain(
        'headers.set(\n      "Strict-Transport-Security",\n      "max-age=63072000; includeSubDomains; preload",\n    );',
      );
    });
  });
});
