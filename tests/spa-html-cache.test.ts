import { describe, expect, it } from "bun:test";
import worker, { type Env } from "../cloudflare/worker";

async function serveHtml(html: string): Promise<Response> {
  return worker.fetch(
    new Request("http://localhost:8788/projects/", {
      headers: { Accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () =>
          new Response(html, {
            headers: { "Content-Type": "text/html" },
          }),
      },
    } as Env,
    { waitUntil: () => {} } as unknown as ExecutionContext,
  );
}

describe("Worker HTML preserves the SPA bootstrap", () => {
  const router =
    '<script type="module" src="/_astro/ClientRouter.js"></script>';
  const metadata =
    '<meta name="astro-view-transitions-enabled" content="true">';
  const defensiveScript =
    '<script>(function(){const marker = "__CF$cv$params"; const text = ""; if (text.includes(marker)) return;})();</script>';
  const trailingModule =
    '<script type="module" src="/_astro/MatrixBackground.js"></script>';
  const application = `<html><head>${router}${metadata}${defensiveScript}</head><body>${trailingModule}</body></html>`;

  it("preserves router, metadata and defensive marker references byte-for-byte", async () => {
    const response = await serveHtml(application);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await response.text()).toBe(application);
  });

  for (const injected of [
    '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
    '<script>(function(){window.__CF$cv$params={r:"test"};})();</script>',
  ]) {
    it(`removes only the injected challenge: ${injected}`, async () => {
      const response = await serveHtml(
        application.replace("</head>", `${injected}</head>`),
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(application);
    });
  }

  it("leaves ordinary HTML and application scripts unchanged", async () => {
    const html = `<html><head>${router}${metadata}</head><body>${trailingModule}</body></html>`;
    const response = await serveHtml(html);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
  });
});

describe("SPA HTML deployment freshness", () => {
  it("serves current static HTML instead of a previous deployment's Cache API entry", async () => {
    const originalCaches = Object.getOwnPropertyDescriptor(
      globalThis,
      "caches",
    );
    let cacheReads = 0;
    let cacheWrites = 0;
    let assetReads = 0;
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      value: {
        default: {
          match: async () => {
            cacheReads++;
            return new Response("<html>stale deployment</html>", {
              headers: { "Content-Type": "text/html" },
            });
          },
          put: async () => {
            cacheWrites++;
          },
        },
      },
    });

    try {
      const response = await worker.fetch(
        new Request("https://arturonavax.dev/projects/", {
          headers: { Accept: "text/html" },
        }),
        {
          ASSETS: {
            fetch: async () => {
              assetReads++;
              return new Response("<html>current deployment</html>", {
                headers: { "Content-Type": "text/html" },
              });
            },
          },
        } as any,
        { waitUntil: () => {} } as any,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<html>current deployment</html>");
      expect(response.headers.get("Content-Type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(assetReads).toBe(1);
      expect(cacheReads).toBe(0);
      expect(cacheWrites).toBe(0);
    } finally {
      if (originalCaches) {
        Object.defineProperty(globalThis, "caches", originalCaches);
      } else {
        Reflect.deleteProperty(globalThis, "caches");
      }
    }
  });
});
