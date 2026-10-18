/// <reference types="@cloudflare/workers-types" />
import type {
  TelemetryPort,
  PageviewEvent,
  DailySummaryMetric,
  TelemetryIngestionResult,
} from "../../ports/telemetry.port";
import {
  QuotaDegradationTier,
  edgeQuotaTracker,
  isD1QuotaException,
} from "./circuit-breaker.adapter";

export const VISIT_DEDUPE_WINDOW_MS = 1_800_000; // 30 minutes

const MAX_L1_MEMORY_DEDUPE_ENTRIES = 4_096;
const l1DedupeMemoryCache = new Map<string, number>();
const l1CacheApiKeys = new Set<string>();

let cachedIsolateId: string | null = null;
export function getIsolateId(): string {
  if (!cachedIsolateId) {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      cachedIsolateId = crypto.randomUUID().slice(0, 8);
    } else {
      cachedIsolateId = Math.random().toString(36).slice(2, 10);
    }
  }
  return cachedIsolateId;
}

export interface CompactRollupEntry {
  date: string;
  path: string;
  views: number;
  uniques: number;
  botViews: number;
  humanViews: number;
}

const compactRollupBuffer = new Map<string, CompactRollupEntry>();
let lastCompactRollupFlushMs = 0;
let bufferedVisitCount = 0;
export const COMPACT_ROLLUP_FLUSH_INTERVAL_MS = 15_000;
const COMPACT_ROLLUP_MAX_BUFFERED_VISITS = 25;

export interface TelemetryVisitEvent {
  path: string;
  visitorHash: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  dailySalt?: string | undefined;
  dedupeKey?: string | undefined;
  skipL1Check?: boolean | undefined;
  eventType?: "pageview" | "spa_transition" | "bfcache" | "beacon" | undefined;
  isBot?: boolean | undefined;
  botName?: string | null | undefined;
  country?: string | undefined;
  deviceType?: string | undefined;
  referrerHost?: string | undefined;
  statusCode?: number | undefined;
  nowMs?: number | undefined;
}

export interface TelemetryWalEnv {
  ANALYTICS?:
    | {
        writeDataPoint(event: {
          blobs?: string[];
          doubles?: number[];
          indexes?: string[];
        }): void;
      }
    | undefined;
  ANALYTICS_ENGINE?:
    | {
        writeDataPoint(event: {
          blobs?: string[];
          doubles?: number[];
          indexes?: string[];
        }): void;
      }
    | undefined;
  STORAGE_BUCKET?: R2Bucket | undefined;
  R2_BUCKET?: R2Bucket | undefined;
  CONTENT_BUCKET?: R2Bucket | undefined;
}

/**
 * Normalizes a URL or path into a canonical lowercase path without query/hash or trailing slash.
 */
export function normalizeTelemetryPath(rawPath: string): string {
  return (
    (rawPath || "/")
      .split("?")[0]!
      .split("#")[0]!
      .toLowerCase()
      .replace(/\/+$/, "") || "/"
  );
}

/**
 * Deterministic 30-minute bucket SHA-256 (32-hex-char) deduplication key for human and bot visits.
 * Supports both:
 *  - `computeVisitDedupeKey(ip, userAgent, canonicalPath, timestampMs, dailySalt)` (5-arg ODD spec)
 *  - `computeVisitDedupeKey(visitorHash, canonicalPath, timestampMs)` (3-arg shorthand)
 */
export async function computeVisitDedupeKey(
  ipOrVisitorHash: string,
  userAgentOrPath: string,
  canonicalPathOrTimestamp?: string | number,
  timestampMs?: number,
  dailySalt = "",
): Promise<string> {
  let ip: string;
  let userAgent: string;
  let rawPath: string;
  let ts: number;
  let salt: string;

  if (
    typeof canonicalPathOrTimestamp === "number" ||
    canonicalPathOrTimestamp === undefined
  ) {
    ip = ipOrVisitorHash || "anon";
    userAgent = "";
    rawPath = userAgentOrPath || "/";
    ts =
      typeof canonicalPathOrTimestamp === "number"
        ? canonicalPathOrTimestamp
        : Date.now();
    salt = "";
  } else {
    ip = ipOrVisitorHash || "127.0.0.1";
    userAgent = userAgentOrPath || "";
    rawPath = canonicalPathOrTimestamp || "/";
    ts = typeof timestampMs === "number" ? timestampMs : Date.now();
    salt = dailySalt || "";
  }

  const bucket30m = Math.floor(ts / VISIT_DEDUPE_WINDOW_MS);
  const normPath = normalizeTelemetryPath(rawPath);
  const raw = `${ip}|${userAgent.slice(0, 120)}|${normPath}|${bucket30m}|${salt}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Checks L1 Edge Cache (`caches.default`) and isolate memory shield before touching D1.
 * Returns true if the visit was already recorded within the 30-minute window (L1 HIT).
 */
export async function checkAndSetL1DedupeCache(
  dedupeKey: string,
  nowMsOrCtx?: number | { waitUntil?: (promise: Promise<unknown>) => void },
  executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void },
): Promise<boolean> {
  const nowMs = typeof nowMsOrCtx === "number" ? nowMsOrCtx : Date.now();
  const ctx =
    typeof nowMsOrCtx === "object" && nowMsOrCtx !== null
      ? nowMsOrCtx
      : executionCtx;

  // 1. Check isolate memory map first (ultra-fast & works in non-Cache API environments)
  const memExpiry = l1DedupeMemoryCache.get(dedupeKey);
  if (memExpiry !== undefined) {
    if (nowMs < memExpiry) {
      return true;
    }
    l1DedupeMemoryCache.delete(dedupeKey);
  }

  // 2. Check Cloudflare Edge Cache API (`caches.default`)
  const cache =
    typeof caches !== "undefined"
      ? (caches as unknown as { default?: Cache })?.default
      : undefined;
  const cacheUrl = `https://telemetry.internal/dedupe/${encodeURIComponent(dedupeKey)}`;

  if (cache && typeof cache.match === "function") {
    try {
      const cacheKey = new Request(cacheUrl);
      const hit = await cache.match(cacheKey);
      if (hit) {
        l1DedupeMemoryCache.set(dedupeKey, nowMs + VISIT_DEDUPE_WINDOW_MS);
        return true;
      }
    } catch {
      // Fail-open on Cache API error
    }
  }

  // 3. L1 Miss: populate isolate memory map + Edge Cache API (HTTP 204, max-age=1800)
  if (l1DedupeMemoryCache.size >= MAX_L1_MEMORY_DEDUPE_ENTRIES) {
    for (const [k, exp] of l1DedupeMemoryCache.entries()) {
      if (nowMs >= exp) l1DedupeMemoryCache.delete(k);
    }
    if (l1DedupeMemoryCache.size >= MAX_L1_MEMORY_DEDUPE_ENTRIES) {
      const oldest = l1DedupeMemoryCache.keys().next().value;
      if (oldest !== undefined) l1DedupeMemoryCache.delete(oldest);
    }
  }
  l1DedupeMemoryCache.set(dedupeKey, nowMs + VISIT_DEDUPE_WINDOW_MS);

  if (cache && typeof cache.put === "function") {
    try {
      const cacheKey = new Request(cacheUrl);
      const response = new Response(null, {
        status: 204,
        headers: {
          "Cache-Control": "public, max-age=1800",
        },
      });
      l1CacheApiKeys.add(cacheUrl);
      const putPromise = cache.put(cacheKey, response);
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(putPromise);
      } else {
        await putPromise;
      }
    } catch {
      // Ignore Cache API write errors
    }
  }

  return false;
}

/**
 * Clears Tier 2 compact rollup buffer (used by test suites).
 */
export function clearCompactRollupBuffer(): void {
  compactRollupBuffer.clear();
  bufferedVisitCount = 0;
  lastCompactRollupFlushMs = 0;
}

/**
 * Clears L1 deduplication caches without wiping the Tier 2 compact rollup buffer.
 */
export function clearL1DedupeCache(): void {
  l1DedupeMemoryCache.clear();

  const cache =
    typeof caches !== "undefined"
      ? (caches as unknown as { default?: Cache })?.default
      : undefined;
  if (cache && typeof cache.delete === "function") {
    for (const url of l1CacheApiKeys) {
      try {
        void cache.delete(new Request(url));
      } catch {
        // Ignore
      }
    }
  }
  l1CacheApiKeys.clear();
}

/**
 * Flushes accumulated Tier 2 compact rollup increments into `analytics_rollups` via a single `db.batch()`.
 */
export async function flushCompactRollupBuffer(
  db: D1Database,
): Promise<number> {
  if (compactRollupBuffer.size === 0) return 0;
  const entries = Array.from(compactRollupBuffer.values());
  compactRollupBuffer.clear();
  bufferedVisitCount = 0;
  lastCompactRollupFlushMs = Date.now();

  const statements = entries.map((entry) =>
    db
      .prepare(
        `INSERT INTO analytics_rollups (date, path, views, uniques, bot_views, human_views)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(date, path) DO UPDATE SET
           views = views + excluded.views,
           uniques = uniques + excluded.uniques,
           bot_views = bot_views + excluded.bot_views,
           human_views = human_views + excluded.human_views`,
      )
      .bind(
        entry.date,
        entry.path,
        entry.views,
        entry.uniques,
        entry.botViews,
        entry.humanViews,
      ),
  );

  if (typeof db.batch === "function") {
    const batchRes = await db.batch(statements);
    let metaRecorded = false;
    if (Array.isArray(batchRes)) {
      for (const item of batchRes) {
        if (
          (item as { meta?: { rows_written?: number; rows_read?: number } })
            ?.meta
        ) {
          edgeQuotaTracker.recordD1Meta(
            (item as { meta?: { rows_written?: number; rows_read?: number } })
              .meta,
          );
          metaRecorded = true;
        }
      }
    }
    if (!metaRecorded) {
      edgeQuotaTracker.recordWrite(statements.length);
    }
  } else {
    for (const stmt of statements) {
      const res = await stmt.run();
      edgeQuotaTracker.recordD1Meta(
        (res as { meta?: { rows_written?: number; rows_read?: number } })?.meta,
        1,
        0,
      );
    }
  }
  return statements.length;
}

/**
 * Resolves the active R2 bucket binding from environment bindings.
 */
export function resolveR2Bucket(env?: TelemetryWalEnv): R2Bucket | undefined {
  if (!env) return undefined;
  return env.R2_BUCKET ?? env.CONTENT_BUCKET ?? env.STORAGE_BUCKET;
}

/**
 * Writes a telemetry event to Cloudflare Analytics Engine (if bound) and R2 WAL NDJSON key.
 */
export async function writeTelemetryWalToR2(
  record: {
    dedupe_key: string;
    path: string;
    event_type: string;
    visitor_hash: string;
    is_bot: number;
    bot_name: string | null;
    country: string;
    device_type: string;
    referrer_host: string;
    status_code: number;
    created_at: string;
  },
  env?: TelemetryWalEnv,
  nowMs: number = Date.now(),
): Promise<string | null> {
  try {
    const analyticsEngine = env?.ANALYTICS ?? env?.ANALYTICS_ENGINE;
    if (
      analyticsEngine &&
      typeof analyticsEngine.writeDataPoint === "function"
    ) {
      analyticsEngine.writeDataPoint({
        blobs: [
          record.path,
          record.event_type,
          record.country,
          record.device_type,
          record.referrer_host,
          record.bot_name || "",
        ],
        doubles: [1, record.is_bot, record.status_code],
        indexes: [record.visitor_hash.slice(0, 32)],
      });
    }
  } catch {
    // Ignore Analytics Engine error
  }

  const bucket = resolveR2Bucket(env);
  if (!bucket || typeof bucket.put !== "function") {
    return null;
  }

  try {
    const dateUtc = record.created_at.slice(0, 10);
    const suffix =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 8);
    const uniqueSuffix = `${nowMs}-${suffix}`;
    const walKey = `wal/telemetry/${dateUtc}/${getIsolateId()}-${uniqueSuffix}.ndjson`;
    const ndjson = `${JSON.stringify(record)}\n`;
    await bucket.put(walKey, ndjson, {
      httpMetadata: { contentType: "application/x-ndjson" },
    });
    return walKey;
  } catch (err) {
    console.error("[D1TelemetryAdapter:writeTelemetryWalToR2 Error]", err);
    return null;
  }
}

export class D1TelemetryAdapter implements TelemetryPort {
  constructor(
    private readonly db: D1Database,
    private readonly env?: TelemetryWalEnv,
    private readonly executionCtx?: {
      waitUntil?: (promise: Promise<unknown>) => void;
    },
  ) {}

  /**
   * Quota-aware, L1-deduplicated visit ingestion pipeline (Tasks 1 & 2).
   */
  async ingestVisit(
    event: TelemetryVisitEvent,
  ): Promise<TelemetryIngestionResult> {
    const nowMs = event.nowMs ?? Date.now();
    const cleanPath = normalizeTelemetryPath(event.path).slice(0, 255);
    const visitorHash = (event.visitorHash || "anon").slice(0, 64);
    const dedupeKey =
      event.dedupeKey ??
      (await computeVisitDedupeKey(
        event.ip ?? visitorHash,
        event.userAgent ?? "",
        cleanPath,
        nowMs,
        event.dailySalt ?? "",
      ));

    // 1. L1 Edge Cache Dedupe Shield
    if (!event.skipL1Check) {
      const isDup = await checkAndSetL1DedupeCache(
        dedupeKey,
        nowMs,
        this.executionCtx,
      );
      if (isDup) {
        return {
          recorded: false,
          deduped: true,
          deduplicated: true,
          degradationTier: edgeQuotaTracker.getTierName(nowMs),
          storageTier: "L1_CACHE",
          storageTarget: "L1_CACHE",
        };
      }
    }

    const createdAtIso = new Date(nowMs).toISOString();
    const dateUtc = createdAtIso.slice(0, 10);
    const isBotInt = event.isBot ? 1 : 0;
    const humanViewsInc = isBotInt === 0 ? 1 : 0;
    const eventType = event.eventType ?? "pageview";
    const botName = event.botName ? event.botName.slice(0, 64) : null;
    const country = (event.country || "XX").slice(0, 10);
    const deviceType = (event.deviceType || "desktop").slice(0, 32);
    const referrerHost = (event.referrerHost || "").slice(0, 255);
    const statusCode = event.statusCode ?? 200;

    const walRecord = {
      dedupe_key: dedupeKey,
      path: cleanPath,
      event_type: eventType,
      visitor_hash: visitorHash,
      is_bot: isBotInt,
      bot_name: botName,
      country,
      device_type: deviceType,
      referrer_host: referrerHost,
      status_code: statusCode,
      created_at: createdAtIso,
    };

    const tier = edgeQuotaTracker.getTier(nowMs);

    // Tier 3 (CRITICAL_SURVIVAL) & Tier 4 (R2_WAL_FALLBACK): Zero D1 writes
    if (tier >= QuotaDegradationTier.CRITICAL_SURVIVAL) {
      const walPromise = writeTelemetryWalToR2(walRecord, this.env, nowMs);
      if (this.executionCtx?.waitUntil) {
        this.executionCtx.waitUntil(walPromise);
      } else {
        await walPromise;
      }
      return {
        recorded: true,
        deduped: false,
        deduplicated: false,
        degradationTier: edgeQuotaTracker.getTierName(nowMs),
        storageTier: "R2_WAL",
        storageTarget: "ANALYTICS_ENGINE_AND_R2_WAL",
      };
    }

    // Tier 2 (COMPACT_ROLLUP): Skip raw telemetry_events, buffer rollup increments
    if (tier === QuotaDegradationTier.COMPACT_ROLLUP) {
      const rollupKey = `${dateUtc}:${cleanPath}`;
      const existing = compactRollupBuffer.get(rollupKey);
      if (existing) {
        existing.views += 1;
        existing.uniques += 1;
        existing.botViews += isBotInt;
        existing.humanViews += humanViewsInc;
      } else {
        compactRollupBuffer.set(rollupKey, {
          date: dateUtc,
          path: cleanPath,
          views: 1,
          uniques: 1,
          botViews: isBotInt,
          humanViews: humanViewsInc,
        });
      }
      bufferedVisitCount += 1;

      const shouldFlush =
        bufferedVisitCount >= COMPACT_ROLLUP_MAX_BUFFERED_VISITS ||
        nowMs - lastCompactRollupFlushMs >= COMPACT_ROLLUP_FLUSH_INTERVAL_MS;

      if (shouldFlush) {
        try {
          await flushCompactRollupBuffer(this.db);
        } catch (err) {
          if (isD1QuotaException(err)) {
            edgeQuotaTracker.tripCircuitBreaker(
              String(err),
              nowMs,
              this.executionCtx as ExecutionContext | undefined,
            );
            await writeTelemetryWalToR2(walRecord, this.env, nowMs);
            return {
              recorded: true,
              deduped: false,
              deduplicated: false,
              degradationTier: edgeQuotaTracker.getTierName(nowMs),
              storageTier: "R2_WAL",
              storageTarget: "ANALYTICS_ENGINE_AND_R2_WAL",
            };
          }
          console.error(
            "[D1TelemetryAdapter:flushCompactRollupBuffer Error]",
            err,
          );
        }
      }

      return {
        recorded: true,
        deduped: false,
        deduplicated: false,
        degradationTier: edgeQuotaTracker.getTierName(nowMs),
        storageTier: "D1",
        storageTarget: "D1_ROLLUP_ONLY",
      };
    }

    // Tier 0 (NOMINAL) & Tier 1 (CONSERVATIVE): Single atomic db.batch()
    try {
      const telemetryStmt = this.db
        .prepare(
          `INSERT OR IGNORE INTO telemetry_events (
            dedupe_key, path, event_type, visitor_hash, is_bot, bot_name,
            country, device_type, referrer_host, status_code, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          dedupeKey,
          cleanPath,
          eventType,
          visitorHash,
          isBotInt,
          botName,
          country,
          deviceType,
          referrerHost,
          statusCode,
          createdAtIso,
        );

      const rollupStmt = this.db
        .prepare(
          `INSERT INTO analytics_rollups (date, path, views, uniques, bot_views, human_views)
           VALUES (?, ?, 1, 1, ?, ?)
           ON CONFLICT(date, path) DO UPDATE SET
             views = views + 1,
             uniques = uniques + 1,
             bot_views = bot_views + excluded.bot_views,
             human_views = human_views + excluded.human_views`,
        )
        .bind(dateUtc, cleanPath, isBotInt, humanViewsInc);

      let batchMeta: { rows_written?: number; rows_read?: number } | null =
        null;
      if (typeof this.db.batch === "function") {
        const results = await this.db.batch([telemetryStmt, rollupStmt]);
        const totalWritten = results.reduce(
          (acc, r) =>
            acc +
            (typeof r?.meta?.rows_written === "number"
              ? r.meta.rows_written
              : 1),
          0,
        );
        const totalRead = results.reduce(
          (acc, r) =>
            acc +
            (typeof r?.meta?.rows_read === "number" ? r.meta.rows_read : 0),
          0,
        );
        batchMeta = { rows_written: totalWritten || 2, rows_read: totalRead };
      } else {
        await telemetryStmt.run();
        await rollupStmt.run();
      }
      edgeQuotaTracker.recordD1Meta(batchMeta, 2, 0, nowMs);
      await edgeQuotaTracker.tickAndMaybeSync(
        this.db,
        this.executionCtx as ExecutionContext | undefined,
      );

      return {
        recorded: true,
        deduped: false,
        deduplicated: false,
        degradationTier: edgeQuotaTracker.getTierName(nowMs),
        storageTier: "D1",
        storageTarget: "D1_RAW_AND_ROLLUP",
      };
    } catch (err) {
      if (isD1QuotaException(err)) {
        edgeQuotaTracker.tripCircuitBreaker(
          String(err),
          nowMs,
          this.executionCtx as ExecutionContext | undefined,
        );
        await writeTelemetryWalToR2(walRecord, this.env, nowMs);
        return {
          recorded: true,
          deduped: false,
          deduplicated: false,
          degradationTier: edgeQuotaTracker.getTierName(nowMs),
          storageTier: "R2_WAL",
          storageTarget: "ANALYTICS_ENGINE_AND_R2_WAL",
        };
      }
      console.error("[D1TelemetryAdapter:ingestVisit Error]", err);
      return {
        recorded: false,
        deduped: false,
        deduplicated: false,
        degradationTier: edgeQuotaTracker.getTierName(nowMs),
        storageTier: "D1",
        storageTarget: "D1_RAW_AND_ROLLUP",
      };
    }
  }

  async recordPageview(event: PageviewEvent): Promise<void> {
    try {
      await this.db
        .prepare(
          `INSERT INTO pageview_events (path, locale, country, referrer, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          event.path.slice(0, 255),
          event.locale.slice(0, 10),
          (event.country || "XX").slice(0, 10),
          (event.referrer || "").slice(0, 255),
          event.timestamp,
        )
        .run();
      edgeQuotaTracker.recordWrite(1);
    } catch (err) {
      if (isD1QuotaException(err)) {
        edgeQuotaTracker.tripCircuitBreaker(String(err));
      }
      // Fail-open: discard telemetry errors defensively without breaking caller
      console.error("[D1TelemetryAdapter:recordPageview Error]", err);
    }
  }

  async recordPrefetch(
    event: import("../../ports/telemetry.port").PrefetchTelemetryEvent,
  ): Promise<void> {
    try {
      await this.db
        .prepare(
          `INSERT INTO prefetch_analytics_events (path, visitor_hash, referrer, country, purpose)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          event.path.slice(0, 255),
          event.visitorHash.slice(0, 64),
          (event.referrer || "").slice(0, 255),
          (event.country || "XX").slice(0, 10),
          event.purpose.slice(0, 50),
        )
        .run();
      edgeQuotaTracker.recordWrite(1);
    } catch (err) {
      if (isD1QuotaException(err)) {
        edgeQuotaTracker.tripCircuitBreaker(String(err));
      }
      // Fail-open: discard telemetry errors defensively without breaking caller
      console.error("[D1TelemetryAdapter:recordPrefetch Error]", err);
    }
  }

  async getAggregatedMetrics(
    startDate: string,
    endDate: string,
  ): Promise<DailySummaryMetric[]> {
    const results = await this.db
      .prepare(
        `SELECT summary_date as date, path, locale, country, total_views as views
         FROM pageviews_daily_summary
         WHERE summary_date >= ? AND summary_date <= ?
         ORDER BY summary_date DESC, total_views DESC`,
      )
      .bind(startDate, endDate)
      .all<DailySummaryMetric>();
    edgeQuotaTracker.recordRead((results.results || []).length || 1);

    return results.results || [];
  }

  async getCircuitBreakerIncidents(
    subsystem = "prefetch_telemetry",
  ): Promise<import("../../ports/telemetry.port").CircuitBreakerIncident[]> {
    try {
      const results = await this.db
        .prepare(
          `SELECT id, subsystem, date, tripped_at as trippedAt, reason, 
                  shed_count as shedCount, data_completeness as dataCompleteness, notes
           FROM circuit_breaker_incidents
           WHERE subsystem = ?
           ORDER BY date DESC`,
        )
        .bind(subsystem)
        .all<import("../../ports/telemetry.port").CircuitBreakerIncident>();
      edgeQuotaTracker.recordRead((results.results || []).length || 1);
      return results.results || [];
    } catch (err) {
      console.error(
        "[D1TelemetryAdapter:getCircuitBreakerIncidents Error]",
        err,
      );
      return [];
    }
  }

  async getPrefetchSummaryWithQuality(
    startDate: string,
    endDate: string,
  ): Promise<
    import("../../ports/telemetry.port").PrefetchDailySummaryWithQuality[]
  > {
    try {
      const results = await this.db
        .prepare(
          `SELECT summary_date as summaryDate, path, recorded_prefetches as recordedPrefetches,
                  data_completeness as dataCompleteness, estimated_shed_count as estimatedShedCount,
                  circuit_breaker_reason as circuitBreakerReason
           FROM v_prefetch_daily_summary
           WHERE summary_date >= ? AND summary_date <= ?
           ORDER BY summary_date DESC, recorded_prefetches DESC`,
        )
        .bind(startDate, endDate)
        .all<
          import("../../ports/telemetry.port").PrefetchDailySummaryWithQuality
        >();
      edgeQuotaTracker.recordRead((results.results || []).length || 1);
      return results.results || [];
    } catch (err) {
      console.error(
        "[D1TelemetryAdapter:getPrefetchSummaryWithQuality Error]",
        err,
      );
      return [];
    }
  }
}
