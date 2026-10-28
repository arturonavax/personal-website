import { expect, it } from "bun:test";
import { readProviderUsage } from "../cloudflare/runtime/provider-usage";

it("reports observed Workers requests and D1 rows separately from unavailable products", async () => {
  const seen: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    seen.push(String(input));
    const body = JSON.parse(String(init?.body));
    if (body.query.includes("workersInvocationsAdaptive")) return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 7 } }] }] } } });
    if (body.query.includes("d1AnalyticsAdaptiveGroups")) return Response.json({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 11, rowsWritten: 2 } }] }] } } });
    return Response.json({ success: false }, { status: 403 });
  };
  const usage = await readProviderUsage({ CLOUDFLARE_ANALYTICS_API_TOKEN: "test-token", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "account", CLOUDFLARE_ANALYTICS_DATABASE_ID: "database" }, { fetcher, now: new Date("2026-10-28T12:00:00Z") });
  expect(usage.workers_requests.status).toBe("observed");
  expect(usage.workers_requests.used).toBe(7);
  expect(usage.d1_rows_read.used).toBe(11);
  expect(usage.d1_rows_written.used).toBe(2);
  expect(usage.r2_storage.used).toBeNull();
  expect(usage.r2_storage.status).toBe("setup_required");
  expect(seen.every((url) => url.startsWith("https://api.cloudflare.com/client/v4/") && (url.endsWith("/graphql") || url.includes("/access/users?")))).toBe(true);
});

it("does not turn missing credentials or permission failures into successful zero", async () => {
  const missing = await readProviderUsage({}, { fetcher: async () => { throw Error("network must not run"); } });
  expect(missing.workers_requests.status).toBe("setup_required");
  expect(missing.workers_requests.used).toBeNull();
  const denied = await readProviderUsage({ CLOUDFLARE_ANALYTICS_API_TOKEN: "dummy", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "account" }, { fetcher: async () => new Response(null, { status: 403 }) });
  expect(denied.workers_requests.status).toBe("unavailable");
  expect(denied.workers_requests.used).toBeNull();
});

it("isolates R2 unknown actions and counts occupied Access/Gateway users only once", async () => {
  const config = { CLOUDFLARE_ANALYTICS_API_TOKEN: "t", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "a", CLOUDFLARE_ANALYTICS_BUCKET_NAME: "deployed" };
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes("/access/users?")) return Response.json({ success: true, result: [{ id: "one", access_seat: true, gateway_seat: true }, { id: "two", access_seat: false, gateway_seat: true }, { id: "three", access_seat: false, gateway_seat: false }], result_info: { page: 1, total_pages: 1 } });
    const body = JSON.parse(String(init?.body));
    const field = ["r2OperationsAdaptiveGroups", "r2StorageAdaptiveGroups", "workersInvocationsAdaptive"].find((key) => body.query.includes(key));
    const rows = field === "r2OperationsAdaptiveGroups" ? [{ dimensions: { actionType: "PutObject" }, sum: { requests: 4 } }, { dimensions: { actionType: "GetObject" }, sum: { requests: 3 } }, { dimensions: { actionType: "NewOperation" }, sum: { requests: 9 } }] : field === "r2StorageAdaptiveGroups" ? [{ max: { payloadSize: 1024, metadataSize: 32 }, dimensions: { datetime: "2026-10-28T10:00:00Z" } }] : [];
    return Response.json({ data: { viewer: { accounts: [{ [field!]: rows }] } } });
  };
  const usage = await readProviderUsage(config, { fetcher, now: new Date("2026-10-28T12:00:00Z") });
  expect(usage.r2_storage.used).toBe(1056);
  expect(usage.r2_class_a.used).toBe(4);
  expect(usage.r2_class_b.used).toBe(3);
  expect(usage.r2_class_a.status).toBe("partial");
  expect(usage.zero_trust_seats.used).toBe(2);
});

it("single-flights overlapping reads and isolates credentials, buckets and UTC dates", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    if (String(input).includes("/access/users")) return Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 1 } });
    return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [], d1AnalyticsAdaptiveGroups: [], r2StorageAdaptiveGroups: [], r2OperationsAdaptiveGroups: [] }] } } });
  };
  const base = { CLOUDFLARE_ANALYTICS_API_TOKEN: "token-a", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "account" };
  const now = new Date("2026-10-28T12:00:00Z");
  const [a, b] = await Promise.all([readProviderUsage(base, { fetcher, now }), readProviderUsage(base, { fetcher, now })]);
  expect(a).toEqual(b);
  expect(calls).toBe(2);
  await readProviderUsage(base, { fetcher, now });
  expect(calls).toBe(2);
  await readProviderUsage({ ...base, CLOUDFLARE_ANALYTICS_API_TOKEN: "token-b" }, { fetcher, now });
  expect(calls).toBe(4);
  await readProviderUsage({ ...base, CLOUDFLARE_ANALYTICS_BUCKET_NAME: "bucket" }, { fetcher, now });
  expect(calls).toBe(8);
  await readProviderUsage(base, { fetcher, now: new Date("2026-10-29T00:00:00Z") });
  expect(calls).toBe(10);
});

it("bounds provider body size and Access pagination without exposing users", async () => {
  const config = { CLOUDFLARE_ANALYTICS_API_TOKEN: "oversize", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "account" };
  let pages = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).includes("/access/users")) {
      pages++;
      return Response.json({ success: true, result: [{ id: `private-${pages}`, access_seat: true }], result_info: { page: pages, total_pages: 100 } });
    }
    return new Response("x".repeat(128_001), { status: 200 });
  };
  const usage = await readProviderUsage(config, { fetcher, now: new Date("2026-10-30T12:00:00Z") });
  expect(usage.workers_requests.status).toBe("unavailable");
  expect(usage.workers_requests.used).toBeNull();
  expect(pages).toBe(5);
  expect(usage.zero_trust_seats.status).toBe("partial");
  expect(usage.zero_trust_seats.used).toBe(5);
  expect(JSON.stringify(usage)).not.toContain("private-");
});

it("uses only declared GraphQL variables and restricts D1 row analytics to the configured database", async () => {
  const seen = new Set<string>();
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes("/access/users?")) return Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 1 } });
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
    const dataset = ["workersInvocationsAdaptive", "d1AnalyticsAdaptiveGroups", "r2StorageAdaptiveGroups", "r2OperationsAdaptiveGroups"].find((field) => query.includes(`${field}(`));
    if (!dataset) throw Error("missing dataset");
    seen.add(dataset);
    const declarations = query.match(/^query\(([^)]*)\)/)?.[1];
    if (!declarations) return Response.json({ errors: [{ message: "invalid declaration" }] });
    const body = query.slice(query.indexOf(")") + 1);
    for (const [, name, type] of declarations.matchAll(/\$(\w+):\s*(string|Date|Time)!?/g)) {
      if (!body.includes(`$${name}`) || !(name in variables)) return Response.json({ errors: [{ message: "unused variable" }] });
      if ((dataset === "d1AnalyticsAdaptiveGroups" && (name === "start" || name === "end") && type !== "Date") || (dataset.startsWith("r2") && (name === "start" || name === "end") && type !== "Time") || (dataset === "workersInvocationsAdaptive" && (name === "start" || name === "end") && type !== "string")) return Response.json({ errors: [{ message: "wrong scalar" }] });
    }
    if (dataset === "d1AnalyticsAdaptiveGroups" && (!query.includes("databaseId: $databaseId") || variables.databaseId !== "selected-db")) return Response.json({ errors: [{ message: "database scope missing" }] });
    const rows = dataset === "d1AnalyticsAdaptiveGroups" ? [{ sum: { rowsRead: 8, rowsWritten: 3 } }] : dataset === "workersInvocationsAdaptive" ? [{ sum: { requests: 4 } }] : dataset === "r2StorageAdaptiveGroups" ? [{ max: { payloadSize: 1, metadataSize: 0 }, dimensions: { datetime: "2026-10-28T09:00:00Z" } }] : [];
    return Response.json({ data: { viewer: { accounts: [{ [dataset]: rows }] } } });
  };
  const usage = await readProviderUsage({ CLOUDFLARE_ANALYTICS_API_TOKEN: "validation-fixture", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "account", CLOUDFLARE_ANALYTICS_DATABASE_ID: "selected-db", CLOUDFLARE_ANALYTICS_BUCKET_NAME: "deployed" }, { now: new Date("2026-10-28T12:00:00Z"), fetcher });
  expect([...seen].sort()).toEqual(["d1AnalyticsAdaptiveGroups", "r2OperationsAdaptiveGroups", "r2StorageAdaptiveGroups", "workersInvocationsAdaptive"].sort());
  expect(usage.workers_requests).toMatchObject({ used: 4, status: "observed", scope: "account" });
  expect(usage.d1_rows_read).toMatchObject({ used: 8, status: "observed", scope: "selected database" });
  expect(usage.d1_rows_written).toMatchObject({ used: 3, status: "observed", scope: "selected database" });
  expect(usage.r2_storage.used).toBe(1);
});

it("selects the latest valid R2 timestamp rather than the first unsorted sample", async () => {
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes("/access/users?")) return Response.json({ success: true, result: [], result_info: { page: 1, total_pages: 1 } });
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    const field = ["r2StorageAdaptiveGroups", "r2OperationsAdaptiveGroups", "workersInvocationsAdaptive"].find((name) => query.includes(`${name}(`));
    if (!field) throw Error("missing dataset");
    if (field === "r2StorageAdaptiveGroups" && (!query.includes("orderBy: [datetime_DESC]") || !query.includes("dimensions { datetime }"))) return Response.json({ errors: [{ message: "missing official sort" }] });
    const rows = field === "r2StorageAdaptiveGroups" ? [
      { max: { payloadSize: 200, metadataSize: 5 }, dimensions: { datetime: "2026-10-01T09:00:00Z" } },
      { max: { payloadSize: 7, metadataSize: 4 }, dimensions: { datetime: "2026-10-28T09:00:00Z" } },
      { max: { payloadSize: null, metadataSize: 0 }, dimensions: { datetime: "2026-10-28T10:00:00Z" } },
    ] : [];
    return Response.json({ data: { viewer: { accounts: [{ [field]: rows }] } } });
  };
  const usage = await readProviderUsage({ CLOUDFLARE_ANALYTICS_API_TOKEN: "storage-fixture", CLOUDFLARE_ANALYTICS_ACCOUNT_ID: "account", CLOUDFLARE_ANALYTICS_BUCKET_NAME: "deployed" }, { now: new Date("2026-10-28T12:00:00Z"), fetcher });
  expect(usage.r2_storage).toMatchObject({ used: 11, status: "observed", period: "2026-10-28T09:00:00Z" });
});

it("does not offer unsupported gauges", () => {
  const source = require("node:fs").readFileSync("src/pages/[...lang]/admin/index.astro", "utf8");
  for (const id of ["quota-workers-ai", "quota-vectorize", "quota-workers-monthly"]) expect(source).not.toContain(`id="${id}"`);
});
