// Private dashboard-only Cloudflare analytics. Never serialize credentials or raw API errors.
export interface ProviderConfig {
  CLOUDFLARE_ANALYTICS_API_TOKEN?: string;
  CLOUDFLARE_ANALYTICS_ACCOUNT_ID?: string;
  CLOUDFLARE_ANALYTICS_DATABASE_ID?: string;
  CLOUDFLARE_ANALYTICS_BUCKET_NAME?: string;
}
export type Gauge = {
  used: number | null;
  status: "observed" | "setup_required" | "unavailable" | "partial";
  source: string;
  scope: string;
  period: string;
  retrieved_at: string;
  accuracy: string;
};
export type ProviderUsage = Record<"workers_requests" | "d1_rows_read" | "d1_rows_written" | "r2_storage" | "r2_class_a" | "r2_class_b" | "zero_trust_seats", Gauge> & { d1_storage?: Gauge };
const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const MAX_BYTES = 128_000;
const TIMEOUT_MS = 3500;
const TTL_MS = 180_000;
const A = new Set(["ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "LifecycleStorageTierTransition", "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts", "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration"]);
const B = new Set(["HeadBucket", "HeadObject", "GetObject", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"]);
let cache: { key: string; expires: number; value: ProviderUsage } | undefined;
let inflight: { key: string; promise: Promise<ProviderUsage> } | undefined;
const fetcherIds = new WeakMap<typeof fetch, number>();
let nextFetcherId = 0;
const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw Error("unavailable");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw Error("large");
  if (!response.body) throw Error("empty");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BYTES) throw Error("large");
      parts.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const array = (value: unknown): unknown[] | null => Array.isArray(value) && value.length <= 100 ? value : null;

export async function readProviderUsage(config: ProviderConfig, options: { fetcher?: typeof fetch; now?: Date; refresh?: boolean } = {}): Promise<ProviderUsage> {
  const now = options.now ?? new Date();
  const stamp = now.toISOString();
  const day = stamp.slice(0, 10);
  const month = day.slice(0, 7);
  const account = config.CLOUDFLARE_ANALYTICS_ACCOUNT_ID;
  const token = config.CLOUDFLARE_ANALYTICS_API_TOKEN;
  const database = config.CLOUDFLARE_ANALYTICS_DATABASE_ID;
  const bucket = config.CLOUDFLARE_ANALYTICS_BUCKET_NAME;
  // Hash the secret identity; never retain the raw bearer in the cache key.
  const digest = token ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))).map((b) => b.toString(16).padStart(2, "0")).join("") : "missing";
  let fetcherId = 0;
  if (options.fetcher) {
    fetcherId = fetcherIds.get(options.fetcher) ?? ++nextFetcherId;
    fetcherIds.set(options.fetcher, fetcherId);
  }
  const key = JSON.stringify([digest, account, database, bucket, day, month, fetcherId]);
  const clock = now.getTime();
  if (cache?.key === key && cache.expires > clock) return cache.value;
  if (inflight?.key === key) return inflight.promise;
  const work = async (): Promise<ProviderUsage> => {
    const gauge = (scope: string, period: string, source: string, enabled: boolean): Gauge => ({ used: null, status: enabled ? "unavailable" : "setup_required", source, scope, period, retrieved_at: stamp, accuracy: "Observed analytics; adaptive datasets may be sampled and are not invoice quantities." });
    const graphqlReady = !!(token && account);
    const result: ProviderUsage = {
      workers_requests: gauge("account", day + " UTC", "workersInvocationsAdaptive", graphqlReady),
      d1_rows_read: gauge("selected database", day + " UTC", "d1AnalyticsAdaptiveGroups", !!(graphqlReady && database)),
      d1_rows_written: gauge("selected database", day + " UTC", "d1AnalyticsAdaptiveGroups", !!(graphqlReady && database)),
      r2_storage: gauge("selected bucket", "latest sample within 31 days", "r2StorageAdaptiveGroups", !!(graphqlReady && bucket)),
      r2_class_a: gauge("selected bucket", month + " month-to-date UTC", "r2OperationsAdaptiveGroups", !!(graphqlReady && bucket)),
      r2_class_b: gauge("selected bucket", month + " month-to-date UTC", "r2OperationsAdaptiveGroups", !!(graphqlReady && bucket)),
      zero_trust_seats: gauge("account", "current occupied users", "GET /access/users", graphqlReady),
    };
    if (!graphqlReady) return result;
    const fetcher = options.fetcher ?? fetch;
    async function request(url: string, body?: object): Promise<Record<string, unknown>> {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const fetchPromise = fetcher(url, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal }).then(boundedJson);
        const json = record(await Promise.race([fetchPromise, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("timeout")); }, TIMEOUT_MS); })]));
        if (!json || json.success === false || (Array.isArray(json.errors) && json.errors.length)) throw Error("invalid");
        return json;
      } finally { if (timer) clearTimeout(timer); }
    }
    async function query(dataset: "workers" | "d1" | "r2_storage" | "r2_ops"): Promise<unknown[] | null> {
      // Each documented dataset has its own scalar types and only variables it consumes.
      const spec = dataset === "workers" ? {
        field: "workersInvocationsAdaptive",
        declarations: "$accountTag: string!, $start: string!, $end: string!",
        filter: "datetime_geq: $start, datetime_leq: $end",
        selection: "sum { requests }",
        variables: { accountTag: account, start: day + "T00:00:00Z", end: stamp },
        order: "",
      } : dataset === "d1" ? {
        field: "d1AnalyticsAdaptiveGroups",
        declarations: "$accountTag: string!, $start: Date!, $end: Date!, $databaseId: string!",
        filter: "date_geq: $start, date_leq: $end, databaseId: $databaseId",
        selection: "sum { rowsRead rowsWritten }",
        variables: { accountTag: account, start: day, end: day, databaseId: database },
        order: "",
      } : dataset === "r2_storage" ? {
        field: "r2StorageAdaptiveGroups",
        declarations: "$accountTag: string!, $start: Time!, $end: Time!, $bucketName: string!",
        filter: "datetime_geq: $start, datetime_leq: $end, bucketName: $bucketName",
        selection: "max { payloadSize metadataSize } dimensions { datetime }",
        variables: { accountTag: account, start: new Date(clock - 30 * 86400000).toISOString(), end: stamp, bucketName: bucket },
        order: "orderBy: [datetime_DESC],",
      } : {
        field: "r2OperationsAdaptiveGroups",
        declarations: "$accountTag: string!, $start: Time!, $end: Time!, $bucketName: string!",
        filter: "datetime_geq: $start, datetime_leq: $end, bucketName: $bucketName",
        selection: "sum { requests } dimensions { actionType }",
        variables: { accountTag: account, start: month + "-01T00:00:00Z", end: stamp, bucketName: bucket },
        order: "",
      };
      const response = await request(GRAPHQL, { query: `query(${spec.declarations}) { viewer { accounts(filter: { accountTag: $accountTag }) { ${spec.field}(limit: 100, ${spec.order} filter: { ${spec.filter} }) { ${spec.selection} } } } }`, variables: spec.variables });
      const viewer = record(response.data) && record(record(response.data)?.viewer);
      const accounts = array(viewer?.accounts);
      return accounts?.length === 1 ? array(record(accounts[0])?.[spec.field]) : null;
    }
    await Promise.all([
      (async () => { try { const rows = await query("workers"); if (!rows) return; const values = rows.map((r) => record(record(r)?.sum)?.requests); if (!values.every(valid)) return; result.workers_requests.used = values.reduce<number>((a, b) => a + (b as number), 0); result.workers_requests.status = rows.length === 100 ? "partial" : "observed"; } catch { /* product isolated */ } })(),
      (async () => { if (!database) { result.d1_rows_read.status = result.d1_rows_written.status = "setup_required"; return; } try { const rows = await query("d1"); if (!rows) return; for (const [key, field] of [["d1_rows_read", "rowsRead"], ["d1_rows_written", "rowsWritten"]] as const) { const values = rows.map((r) => record(record(r)?.sum)?.[field]); if (!values.every(valid)) continue; result[key].used = values.reduce<number>((a, b) => a + (b as number), 0); result[key].status = rows.length === 100 ? "partial" : "observed"; } } catch { /* product isolated */ } })(),
      (async () => { if (!bucket) return; try { const rows = await query("r2_storage");
        let latest: { timestamp: string; bytes: number; time: number } | undefined;
        for (const row of rows ?? []) {
          const max = record(record(row)?.max);
          const timestamp = record(record(row)?.dimensions)?.datetime;
          if (!valid(max?.payloadSize) || !valid(max?.metadataSize) || typeof timestamp !== "string") continue;
          const time = Date.parse(timestamp);
          if (!Number.isFinite(time) || time < clock - 30 * 86400000 || time > clock) continue;
          if (!latest || time > latest.time) latest = { timestamp, time, bytes: max.payloadSize + max.metadataSize };
        }
        if (latest) { result.r2_storage.used = latest.bytes; result.r2_storage.status = "observed"; result.r2_storage.period = latest.timestamp; } } catch { /* product isolated */ } })(),
      (async () => { if (!bucket) return; try { const rows = await query("r2_ops"); if (!rows) return; let a = 0, b = 0, partial = rows.length === 100; for (const row of rows) { const action = record(record(row)?.dimensions)?.actionType; const requests = record(record(row)?.sum)?.requests; if (!valid(requests) || typeof action !== "string") { partial = true; continue; } if (A.has(action)) a += requests; else if (B.has(action)) b += requests; else if (!["DeleteObject", "DeleteBucket", "AbortMultipartUpload"].includes(action)) partial = true; } result.r2_class_a.used = a; result.r2_class_b.used = b; result.r2_class_a.status = result.r2_class_b.status = partial ? "partial" : "observed"; } catch { /* product isolated */ } })(),
      (async () => { try { const ids = new Set<string>(); for (let page = 1; page <= 5; page++) { const payload = await request(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account!)}/access/users?page=${page}&per_page=100`); const users = array(payload.result); const info = record(payload.result_info); if (!users || !info || !valid(info.total_pages) || !valid(info.page) || info.page !== page) return; for (const user of users) { const u = record(user); if ((u?.access_seat === true || u?.gateway_seat === true) && typeof u.id === "string") ids.add(u.id); } if (page >= info.total_pages) { result.zero_trust_seats.used = ids.size; result.zero_trust_seats.status = "observed"; return; } } result.zero_trust_seats.used = ids.size; result.zero_trust_seats.status = "partial"; } catch { /* product isolated */ } })(),
    ]);
    return result;
  };
  const promise = work();
  inflight = { key, promise };
  try { const value = await promise; cache = { key, value, expires: clock + TTL_MS }; return value; }
  finally { if (inflight?.promise === promise) inflight = undefined; }
}
