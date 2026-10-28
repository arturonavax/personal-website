import { describe, expect, it } from "bun:test";
import worker, { type Env } from "../cloudflare/worker";
import { CloudflareEdgeRoutingPolicy } from "../src/lib/adapters/cloudflare/edge-routing-policy.adapter";

const token = "fixture-admin-token-longer-than-20";
const ctx = { waitUntil() {} } as unknown as ExecutionContext;
const policy = new CloudflareEdgeRoutingPolicy();
function fixture() {
  const reads: string[] = [];
  const env = {
    REQUIRE_ADMIN_AUTH: "true",
    ADMIN_ACCESS_TOKEN: token,
    ASSETS: {
      fetch: async (request: Request) => {
        reads.push(new URL(request.url).pathname);
        return new Response("PRIVATE DASHBOARD", {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
  } as Env;
  return { env, reads };
}

async function request(
  url: string,
  env: Env,
  headers: Record<string, string> = {},
) {
  const response = await worker.fetch(
    new Request(url, { headers: { accept: "text/html", ...headers } }),
    env,
    ctx,
  );
  return {
    status: response.status,
    location: response.headers.get("Location"),
    body: await response.text(),
    response,
  };
}

describe("single-apex admin document boundary", () => {
  it("keeps the apex entry and localized URL guarded and retires the old host", async () => {
    const f = fixture();
    const entry = await request("https://arturonavax.dev/admin", f.env);
    expect([entry.status, entry.location, entry.body, f.reads]).toEqual([
      308, "https://arturonavax.dev/admin/", "", [],
    ]);
    for (const path of ["/admin/", "/es/admin/"]) {
      const denied = await request(`https://arturonavax.dev${path}`, f.env);
      expect([denied.status, denied.location, denied.body.includes("PRIVATE DASHBOARD")]).toEqual([401, null, false]);
      const allowed = await request(`https://arturonavax.dev${path}`, f.env, {
        Authorization: `Bearer ${token}`,
      });
      expect([allowed.status, allowed.body]).toEqual([200, "PRIVATE DASHBOARD"]);
    }
    const oldHost = await request("https://admin.arturonavax.dev/", f.env, {
      Authorization: `Bearer ${token}`,
    });
    expect([oldHost.status, oldHost.location, f.reads.length]).toEqual([404, null, 2]);
  });

  for (const [url, location] of [
    ["https://arturonavax.dev/admin", "https://arturonavax.dev/admin/"],
    ["https://arturonavax.dev/admin/", null],
  ] as const) {
    it(`${url} settles at the guarded admin root`, async () => {
      const f = fixture();
      const first = await request(url, f.env);
      expect(first.status).toBe(location ? 308 : 401);
      expect(first.location).toBe(location);
      expect(first.body).not.toContain("PRIVATE DASHBOARD");
      expect(f.reads).toEqual([]);
      if (location) {
        const second = await request(location, f.env);
        expect(second.status).toBe(401);
        expect(second.location).toBeNull();
        expect(second.body).not.toContain("PRIVATE DASHBOARD");
        expect(f.reads).toEqual([]);
      }
    });
  }

  it("retains locale and safe query without propagating credential query parameters", async () => {
    const f = fixture();
    const alias = await request(
      "https://arturonavax.dev/es/admin?lang=es&range=7d&token=secret&admin_token=secret",
      f.env,
    );
    expect(alias.status).toBe(308);
    expect(alias.location).toBe(
      "https://arturonavax.dev/es/admin/?lang=es&range=7d",
    );
    expect(alias.body).not.toContain("PRIVATE DASHBOARD");
    expect(f.reads).toEqual([]);
    const settled = await request(alias.location!, f.env, {
      Authorization: `Bearer ${token}`,
    });
    expect(settled.status).toBe(200);
    expect(settled.location).toBeNull();
    expect(settled.body).toBe("PRIVATE DASHBOARD");
    expect(f.reads).toContain("/__admin_vault__/es/index.html");
  });

  it("issues only a verified, host-only token session and rejects forged exchanges", async () => {
    const f = fixture();
    const send = (headers: Record<string, string>) =>
      worker.fetch(
        new Request("https://arturonavax.dev/api/admin/session", {
          method: "POST",
          headers,
        }),
        f.env,
        ctx,
      );
    const denied = await send({ cookie: `admin_session=${token}` });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Set-Cookie")).toBeNull();
    const wrong = await send({ Authorization: "Bearer wrong-token" });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("Set-Cookie")).toBeNull();
    const accepted = await send({
      Authorization: `Bearer ${token}`,
      Origin: "https://arturonavax.dev",
    });
    expect(accepted.status).toBe(204);
    expect(await accepted.text()).toBe("");
    expect(accepted.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(accepted.headers.get("Set-Cookie")).toContain("SameSite=Strict");
    expect(accepted.headers.get("Set-Cookie")).not.toContain("Domain=");
    const dashboard = await request("https://arturonavax.dev/admin/", f.env, {
      cookie: `admin_session=${token}`,
    });
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toBe("PRIVATE DASHBOARD");
  });

  for (const [name, init, status, body] of [
    [
      "foreign Origin",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://evil.example",
        },
      },
      403,
      "Forbidden origin",
    ],
    [
      "null Origin",
      { headers: { Authorization: `Bearer ${token}`, Origin: "null" } },
      403,
      "Forbidden origin",
    ],
    [
      "explicit request body",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://arturonavax.dev",
        },
        body: "ignored explicit body",
      },
      400,
      "Unexpected request body",
    ],
  ] as const) {
    it(`rejects a valid bearer exchange with ${name} without side effects`, async () => {
      const f = fixture();
      let background = 0;
      const response = await worker.fetch(
        new Request("https://arturonavax.dev/api/admin/session", {
          method: "POST",
          ...init,
        }),
        f.env,
        {
          waitUntil() {
            background++;
          },
        } as unknown as ExecutionContext,
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Location")).toBeNull();
      expect(await response.text()).toBe(body);
      expect(f.reads).toEqual([]);
      expect(background).toBe(0);
    });
  }

  it("does not consume a streamed body when rejecting the session exchange", async () => {
    const f = fixture();
    let pulls = 0;
    const body = new ReadableStream({
      pull() {
        pulls++;
      },
    });
    const streamedRequest = new Request(
      "https://arturonavax.dev/api/admin/session",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: "https://arturonavax.dev",
        },
        body,
        duplex: "half",
      } as RequestInit,
    );
    await Promise.resolve(); // Let Bun's Request constructor schedule its initial pull.
    const initialPulls = pulls;
    const response = await worker.fetch(streamedRequest, f.env, ctx);
    expect(response.status).toBe(400);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("Unexpected request body");
    expect(pulls).toBe(initialPulls);
    expect(f.reads).toEqual([]);
  });

  it("preserves guarded session method behavior without issuing cookies", async () => {
    const f = fixture();
    for (const [method, expectedStatus] of [
      ["GET", 404],
      ["HEAD", 404],
      ["OPTIONS", 204],
      ["PUT", 404],
    ] as const) {
      const response = await worker.fetch(
        new Request("https://arturonavax.dev/api/admin/session", {
          method,
          headers: { Authorization: `Bearer ${token}` },
        }),
        f.env,
        ctx,
      );
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("Set-Cookie")).toBeNull();
    }
    expect(f.reads).toEqual([]);
  });

  it("keeps protected APIs and vault out of document redirects", async () => {
    const f = fixture();
    const api = await request(
      "https://arturonavax.dev/api/telemetry",
      f.env,
    );
    expect(api.status).toBe(401);
    expect(api.location).toBeNull();
    expect(api.body).not.toContain("PRIVATE DASHBOARD");
    const vault = await request(
      "https://arturonavax.dev/__admin_vault__/default/index.html",
      f.env,
    );
    expect(vault.status).toBe(404);
    expect(vault.location).toBeNull();
    expect(vault.body).not.toContain("PRIVATE DASHBOARD");
    expect(f.reads).toEqual([]);
  });

  it("preserves existing public document and thematic redirects", () => {
    expect(
      policy.resolveCanonicalRedirect(
        new URL("https://arturonavax.dev/blog?x=1"),
      ),
    ).toEqual({
      shouldRedirect: true,
      targetUrl: "https://arturonavax.dev/blog/?x=1",
      statusCode: 301,
    });
    expect(
      policy.resolveCanonicalRedirect(
        new URL("https://blog.arturonavax.dev/es/post?x=1"),
      ),
    ).toEqual({
      shouldRedirect: true,
      targetUrl: "https://arturonavax.dev/es/blog/post?x=1",
      statusCode: 308,
    });
  });
});
