import { describe, expect, it } from "bun:test";
import worker, { verifyAdminAccess, type Env } from "../cloudflare/worker";

const context = { waitUntil() {} } as unknown as ExecutionContext;
const env = {
  REQUIRE_CF_ACCESS: "true",
  REQUIRE_ADMIN_AUTH: "true",
  ADMIN_AUTHORIZED_EMAILS: "owner@example.com",
} as Env;

describe("public admin authentication boundaries", () => {
  for (const headers of [
    { "cf-access-authenticated-user-email": "owner@example.com" },
    { "cf-access-jwt-assertion": "not-a-jwt" },
    { cookie: "CF_Authorization=forged" },
    { cookie: "CF_Authorization=%" },
  ]) {
    it(`rejects unverified identity ${Object.keys(headers)[0]}`, async () => {
      const result = await verifyAdminAccess(
        new Request("https://admin.arturonavax.dev/api/status", { headers }),
        env,
      );
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(401);
    });
  }
  for (const pathname of [
    "/__admin_vault__/default/index.html",
    "/%5f%5fadmin_vault__//en/index.html",
  ]) {
    it(`denies forged internal vault fetch ${pathname} before touching assets`, async () => {
      let reads = 0;
      const res = await worker.fetch(
        new Request(`https://arturonavax.dev${pathname}`, {
          headers: { "x-admin-vault-internal": "1" },
        }),
        {
          ...env,
          ASSETS: {
            fetch: async () => {
              reads++;
              return new Response("PRIVATE SHELL");
            },
          },
        } as Env,
        context,
      );
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toContain("no-store");
      expect(await res.text()).not.toContain("PRIVATE SHELL");
      expect(reads).toBe(0);
    });
  }
  it("preserves configured constant-time bearer authentication", async () => {
    const token = "test-only-admin-token-at-least-20";
    const result = await verifyAdminAccess(
      new Request("https://admin.arturonavax.dev/api/status", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { ...env, ADMIN_ACCESS_TOKEN: token },
    );
    expect(result.authorized).toBe(true);
    expect(result.method).toBe("admin_token");
  });
});

it("preserves cryptographically verified Access JWT authentication", async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
    kid: "test-key",
  };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const team = "fixture-admin.cloudflareaccess.com";
  const input = `${encode({ alg: "RS256", kid: "test-key" })}.${encode({ aud: ["test-audience"], iss: `https://${team}`, exp: Math.floor(Date.now() / 1000) + 300, email: "owner@example.com" })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(input),
  );
  const jwt = `${input}.${Buffer.from(signature).toString("base64url")}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    expect(String(url)).toBe(`https://${team}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  }) as typeof fetch;
  try {
    const result = await verifyAdminAccess(
      new Request("https://admin.arturonavax.dev/", {
        headers: { "cf-access-jwt-assertion": jwt },
      }),
      { ...env, CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: "test-audience" },
    );
    expect(result.authorized).toBe(true);
    expect(result.method).toBe("cf_access");
    expect(result.email).toBe("owner@example.com");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
