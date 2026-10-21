import { describe, expect, it } from "bun:test";
import worker from "../cloudflare/worker";

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
