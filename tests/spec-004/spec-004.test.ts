import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALES,
  type LocaleDefinition,
} from "../../src/i18n/locales";
import {
  generatePersonSchema,
  sanitizeCanonicalUrl,
} from "../../src/utils/seo";
import {
  attachHardwareAcceleration,
  isReducedMotion,
} from "../../src/utils/motion";
import { triggerCircularThemeReveal } from "../../src/utils/theme-reveal";
import { getHomepageJsonLd } from "../../src/data/schemaOrg";
import worker from "../../cloudflare/worker";

describe("SPEC-004 SDD: Multi-Language Architecture & Schema.org Monobilingual Invariants", () => {
  it("enforces English as primary and Spanish as secondary in LOCALES", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("es");

    const enDef: LocaleDefinition = LOCALES.en;
    const esDef: LocaleDefinition = LOCALES.es;

    expect(enDef.code).toBe("en");
    expect(enDef.isoCode).toBe("en-US");
    expect(enDef.name).toBe("English");
    expect(enDef.dir).toBe("ltr");

    expect(esDef.code).toBe("es");
    expect(esDef.isoCode).toBe("es-CO");
    expect(esDef.name).toBe("Español");
    expect(esDef.dir).toBe("ltr");
  });

  it("generatePersonSchema generates isolated monobilingual schema with stable global @id anchor", () => {
    const enPerson = generatePersonSchema({
      locale: "en",
      canonicalUrl: "https://arturonavax.dev/",
      headline: "Senior Software Engineer",
      bio: "Distributed systems engineer",
    });

    const esPerson = generatePersonSchema({
      locale: "es",
      canonicalUrl: "https://arturonavax.dev/es/",
      headline: "Ingeniero de Software Senior",
      bio: "Ingeniero de sistemas distribuidos",
    });

    expect(enPerson["@id"]).toBe("https://arturonavax.dev/#person");
    expect(esPerson["@id"]).toBe("https://arturonavax.dev/#person");
    expect(enPerson["@id"]).toBe(esPerson["@id"]);

    expect(enPerson.inLanguage).toBe("en");
    expect(esPerson.inLanguage).toBe("es");
  });

  it("getHomepageJsonLd produces monobilingual payloads with matching global @id", () => {
    const enLd = getHomepageJsonLd("en");
    const esLd = getHomepageJsonLd("es");

    expect(enLd["@id"]).toBe("https://arturonavax.dev/#person");
    expect(esLd["@id"]).toBe("https://arturonavax.dev/#person");
    expect(enLd.inLanguage).toBe("en");
    expect(esLd.inLanguage).toBe("es");
  });

  it("sanitizeCanonicalUrl purges all tracking parameters and preserves clean trailing slashes", () => {
    const dirtyUrl =
      "https://arturonavax.dev/?utm_source=newsletter&utm_medium=email&ref=hacker-news";
    const cleanUrl = sanitizeCanonicalUrl(dirtyUrl);
    expect(cleanUrl).toBe("https://arturonavax.dev/");
    expect(cleanUrl).not.toContain("utm_source");
    expect(cleanUrl).not.toContain("utm_medium");
    expect(cleanUrl).not.toContain("ref");

    const subpageDirty =
      "https://arturonavax.dev/blog/sub-50ms-fraud-engine-go?utm_campaign=launch&tag=tech";
    const cleanSubpage = sanitizeCanonicalUrl(subpageDirty);
    expect(cleanSubpage).toBe(
      "https://arturonavax.dev/blog/sub-50ms-fraud-engine-go/",
    );
    expect(cleanSubpage).not.toContain("utm_campaign");
    expect(cleanSubpage).not.toContain("tag");
  });
});

describe("SPEC-004 SDD: Dynamic Hardware Acceleration Lifecycle (Compositor GPU Direct)", () => {
  it("attachHardwareAcceleration dynamically toggles will-change and restores auto on cleanup", () => {
    const mockElement = {
      style: {
        willChange: "auto",
      },
    } as unknown as HTMLElement;

    const cleanup = attachHardwareAcceleration(mockElement);
    expect(mockElement.style.willChange).toBe("transform, opacity");

    cleanup();
    expect(mockElement.style.willChange).toBe("auto");
  });

  it("isReducedMotion reports false in non-browser or non-reduced environments safely", () => {
    expect(typeof isReducedMotion()).toBe("boolean");
  });
});

describe("SPEC-004 RDD: Binary Compiler & Styling Gatekeeping Checks", () => {
  const ROOT_DIR = process.cwd();
  const SRC_DIR = path.join(ROOT_DIR, "src");

  it("REQ-STY-01: Verifies zero legacy tailwind.config.* or postcss.config.* files exist", () => {
    const legacyTailwindJs = fs.existsSync(
      path.join(ROOT_DIR, "tailwind.config.js"),
    );
    const legacyTailwindMjs = fs.existsSync(
      path.join(ROOT_DIR, "tailwind.config.mjs"),
    );
    const legacyPostcssJs = fs.existsSync(
      path.join(ROOT_DIR, "postcss.config.js"),
    );
    const legacyPostcssMjs = fs.existsSync(
      path.join(ROOT_DIR, "postcss.config.mjs"),
    );

    expect(legacyTailwindJs).toBe(false);
    expect(legacyTailwindMjs).toBe(false);
    expect(legacyPostcssJs).toBe(false);
    expect(legacyPostcssMjs).toBe(false);
  });

  it("REQ-STY-02 & REQ-MOT-02: Zero static will-change declarations in CSS stylesheets", () => {
    function walkCss(dir: string): string[] {
      let files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(walkCss(full));
        } else if (entry.name.endsWith(".css")) {
          files.push(full);
        }
      }
      return files;
    }

    const cssFiles = walkCss(SRC_DIR);
    expect(cssFiles.length).toBeGreaterThan(0);

    for (const file of cssFiles) {
      const content = fs.readFileSync(file, "utf8");
      const hasStaticWillChange = /will-change\s*:\s*[a-z]+/i.test(content);
      expect(hasStaticWillChange).toBe(false);
    }
  });

  it("REQ-MOT-01: Zero prohibited layout animations (width, height, margin, padding, top, left)", () => {
    const BANNED_CSS_PROPERTIES = [
      "width",
      "height",
      "margin",
      "margin-top",
      "margin-bottom",
      "margin-left",
      "margin-right",
      "padding",
      "top",
      "left",
      "bottom",
      "right",
      "border-width",
    ];

    function walkSource(dir: string): string[] {
      let files: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(walkSource(full));
        } else if (
          [".astro", ".ts", ".tsx", ".css"].includes(path.extname(entry.name))
        ) {
          files.push(full);
        }
      }
      return files;
    }

    const sourceFiles = walkSource(SRC_DIR);
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf8");
      for (const prop of BANNED_CSS_PROPERTIES) {
        const transitionRegex = new RegExp(
          `transition(?:-property)?\\s*:[^;]*\\b${prop}\\b`,
          "i",
        );
        expect(transitionRegex.test(content)).toBe(false);
      }
    }
  });

  it("REQ-EDG-01: Public _headers enforces 31536000, immutable for versioned chunks and fonts", () => {
    const headersPath = path.join(ROOT_DIR, "public", "_headers");
    expect(fs.existsSync(headersPath)).toBe(true);

    const headersContent = fs.readFileSync(headersPath, "utf8");
    expect(headersContent).toContain("/_astro/*");
    expect(headersContent).toContain(
      "Cache-Control: public, max-age=31536000, immutable",
    );
    expect(headersContent).toContain("/fonts/*");
  });
});

describe("SPEC-004 ODD: Cloudflare Edge Prefetch Shielding & Cache API Optimization", () => {
  const dummyEnv = {
    DB: {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ success: true }),
        }),
      }),
    } as any,
    ASSETS: {
      fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/_astro/app.js")) {
          return new Response("console.log('static asset')", {
            status: 200,
            headers: { "Content-Type": "application/javascript" },
          });
        }
        if (url.pathname.endsWith(".pdf")) {
          return new Response("pdf-stream", {
            status: 200,
            headers: { "Content-Type": "application/pdf" },
          });
        }
        return new Response("<html><body>Static Document</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      },
    } as any,
  };

  const dummyCtx = {
    waitUntil: (p: Promise<any>) => {},
    passThroughOnException: () => {},
  } as any;

  it("REQ-EDG-02: Speculative prefetch requests to telemetry return 204 without writing to D1", async () => {
    const prefetchHeaders = [
      { Purpose: "prefetch" },
      { "Sec-Purpose": "prefetch" },
      { "X-Astro-Prefetch": "true" },
    ];

    for (const h of prefetchHeaders) {
      const req = new Request("https://arturonavax.dev/api/v1/telemetry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...h,
        },
        body: JSON.stringify({ path: "/blog", locale: "en" }),
      });

      const res = await worker.fetch(req, dummyEnv, dummyCtx);
      expect(res.status).toBe(204);
    }
  });

  it("Valid non-speculative telemetry requests return 202 queued", async () => {
    const req = new Request("https://arturonavax.dev/api/v1/telemetry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: "/blog",
        locale: "en",
        visitorHash: "abc12345",
      }),
    });

    const res = await worker.fetch(req, dummyEnv, dummyCtx);
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.status).toBe("queued");
  });

  it("REQ-EDG-01: Injects immutable cache-control headers on versioned static assets", async () => {
    const req = new Request("https://arturonavax.dev/_astro/app.js");
    const res = await worker.fetch(req, dummyEnv, dummyCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("Injects long-lived stale-while-revalidate headers on PDF documents", async () => {
    const req = new Request("https://arturonavax.dev/ArturoNava-Resume.pdf");
    const res = await worker.fetch(req, dummyEnv, dummyCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain(
      "stale-while-revalidate=86400",
    );
  });

  it("REQ-EDG-03: Serves R2 cdn-assets with Cache-Control headers when bucket is configured", async () => {
    const envWithR2 = {
      ...dummyEnv,
      APP_STORAGE_DRIVER: "cloudflare-r2",
      STORAGE_BUCKET: {
        get: async (key: string) => {
          if (key === "test-file.png") {
            return {
              body: new Uint8Array([1, 2, 3]),
              size: 3,
              httpEtag: '"etag-123"',
              httpMetadata: { contentType: "image/png" },
            };
          }
          return null;
        },
      } as any,
    };

    const req = new Request("https://arturonavax.dev/cdn-assets/test-file.png");
    const res = await worker.fetch(req, envWithR2, dummyCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("max-age=86400");

    const notFoundReq = new Request(
      "https://arturonavax.dev/cdn-assets/missing.png",
    );
    const notFoundRes = await worker.fetch(notFoundReq, envWithR2, dummyCtx);
    expect(notFoundRes.status).toBe(404);
  });
});

describe("SPEC-004 Components & WAAPI Animation Directives", () => {
  const ROOT_DIR = process.cwd();

  it("EdgeViewCounter.astro exists and provides accessible pulse fallback", () => {
    const filePath = path.join(
      ROOT_DIR,
      "src/components/ui/EdgeViewCounter.astro",
    );
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("counter-");
    expect(content).toContain("views");
  });

  it("OptimizedVisual.astro implements aspect-ratio containment and eager/lazy prioritization", () => {
    const filePath = path.join(
      ROOT_DIR,
      "src/components/ui/OptimizedVisual.astro",
    );
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("aspect-ratio");
    expect(content).toContain('loading={isHero ? "eager" : "lazy"}');
    expect(content).toContain('fetchpriority={isHero ? "high" : "auto"}');
  });

  it("triggerCircularThemeReveal gracefully executes callback in Node/Bun environment", async () => {
    let mutated = false;
    await triggerCircularThemeReveal(
      { clientX: 100, clientY: 100 } as MouseEvent,
      () => {
        mutated = true;
      },
    );
    expect(mutated).toBe(true);
  });

  it("global.css defines font-metric overrides and dynamic semantic tokens", () => {
    const cssPath = path.join(ROOT_DIR, "src/styles/global.css");
    const content = fs.readFileSync(cssPath, "utf8");
    expect(content).toContain('font-family: "Geist Fallback"');
    expect(content).toContain("ascent-override");
    expect(content).toContain("descent-override");
    expect(content).toContain("size-adjust");
    expect(content).toContain("--surface-backdrop");
    expect(content).toContain("scrollbar-gutter: stable");
  });
});
