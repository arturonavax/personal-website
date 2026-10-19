import type { FailOpenCircuitBreakerPort } from "../../ports/edge-delivery.port";

export enum QuotaDegradationTier {
  NOMINAL = 0, // < 50% D1 quota: Full telemetry + 10% prefetch sampling
  CONSERVATIVE = 1, // 50% - 70%: Drop prefetch D1 writes & generic bot raw logs
  COMPACT_ROLLUP = 2, // 70% - 85%: Stop raw telemetry_events; batch-upsert analytics_rollups only
  CRITICAL_SURVIVAL = 3, // 85% - 95%: Reserve D1 exclusively for contact_leads; telemetry -> R2 WAL + Analytics Engine
  R2_WAL_FALLBACK = 4, // >= 95% or D1 quota error: 100% R2 WAL persistence for leads & visits; Cron replay at 00:05 UTC
}

export type DegradationTierName =
  | "NOMINAL"
  | "CONSERVATIVE"
  | "COMPACT_ROLLUP"
  | "CRITICAL_SURVIVAL"
  | "R2_WAL_FALLBACK";

export function degradationTierToName(
  tier: QuotaDegradationTier,
): DegradationTierName {
  switch (tier) {
    case QuotaDegradationTier.NOMINAL:
      return "NOMINAL";
    case QuotaDegradationTier.CONSERVATIVE:
      return "CONSERVATIVE";
    case QuotaDegradationTier.COMPACT_ROLLUP:
      return "COMPACT_ROLLUP";
    case QuotaDegradationTier.CRITICAL_SURVIVAL:
      return "CRITICAL_SURVIVAL";
    case QuotaDegradationTier.R2_WAL_FALLBACK:
      return "R2_WAL_FALLBACK";
    default:
      return "NOMINAL";
  }
}

export type CloudflarePlanTier = "free" | "paid" | "unlimited";

export interface QuotaStrategyConfig {
  readonly planTier: CloudflarePlanTier;
  readonly dailyWriteBudget: number;
  readonly dailyReadBudget: number;
  readonly workersDailyBudget: number;
  readonly conservativeRatio: number;
  readonly compactRatio: number;
  readonly survivalRatio: number;
  readonly walRatio: number;
  readonly botBudgetRatio: number;
  readonly prefetchBudgetRatio: number;
  readonly visitBudgetRatio: number;
  readonly prefetchSampleRate: number;
}

function parsePositiveNumber(val: unknown, fallback: number): number {
  if (val === undefined || val === null || val === "") return fallback;
  if (val === "Infinity" || val === Infinity) return Infinity;
  const parsed = Number(val);
  return !Number.isNaN(parsed) && parsed > 0 ? parsed : fallback;
}

function parseRatio(val: unknown, fallback: number): number {
  if (val === undefined || val === null || val === "") return fallback;
  const parsed = Number(val);
  return !Number.isNaN(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback;
}

export function resolveQuotaConfig(
  env?: Record<string, unknown>,
): QuotaStrategyConfig {
  const rawTier =
    typeof env?.CLOUDFLARE_PLAN_TIER === "string"
      ? env.CLOUDFLARE_PLAN_TIER.trim().toLowerCase()
      : "free";
  const planTier: CloudflarePlanTier =
    rawTier === "paid" || rawTier === "unlimited" ? rawTier : "free";

  const defaultWriteBudget =
    planTier === "unlimited"
      ? Infinity
      : planTier === "paid"
        ? 50_000_000
        : 100_000;
  const defaultReadBudget =
    planTier === "unlimited"
      ? Infinity
      : planTier === "paid"
        ? 250_000_000
        : 5_000_000;
  const defaultWorkersBudget =
    planTier === "unlimited"
      ? Infinity
      : planTier === "paid"
        ? 10_000_000
        : 100_000;
  const defaultPrefetchSampleRate = planTier === "free" ? 0.1 : 1.0;

  return {
    planTier,
    dailyWriteBudget: parsePositiveNumber(
      env?.D1_DAILY_WRITE_BUDGET,
      defaultWriteBudget,
    ),
    dailyReadBudget: parsePositiveNumber(
      env?.D1_DAILY_READ_BUDGET,
      defaultReadBudget,
    ),
    workersDailyBudget: parsePositiveNumber(
      env?.WORKERS_DAILY_REQUEST_BUDGET,
      defaultWorkersBudget,
    ),
    conservativeRatio: parseRatio(env?.D1_TIER_CONSERVATIVE_RATIO, 0.5),
    compactRatio: parseRatio(env?.D1_TIER_COMPACT_RATIO, 0.7),
    survivalRatio: parseRatio(env?.D1_TIER_SURVIVAL_RATIO, 0.85),
    walRatio: parseRatio(env?.D1_TIER_WAL_RATIO, 0.95),
    botBudgetRatio: parseRatio(env?.D1_BOT_BUDGET_RATIO, 0.15),
    prefetchBudgetRatio: parseRatio(env?.D1_PREFETCH_BUDGET_RATIO, 0.25),
    visitBudgetRatio: parseRatio(env?.D1_VISIT_BUDGET_RATIO, 0.65),
    prefetchSampleRate: parseRatio(
      env?.D1_PREFETCH_SAMPLE_RATE,
      defaultPrefetchSampleRate,
    ),
  };
}

export function resolveDegradationTier(
  rowsWritten: number,
  rowsRead: number,
  d1HardBlocked: boolean,
  config?: Partial<QuotaStrategyConfig>,
): QuotaDegradationTier {
  if (d1HardBlocked) return QuotaDegradationTier.R2_WAL_FALLBACK;

  const dailyWriteBudget = config?.dailyWriteBudget ?? 100_000;
  const dailyReadBudget = config?.dailyReadBudget ?? 5_000_000;
  const conservativeRatio = config?.conservativeRatio ?? 0.5;
  const compactRatio = config?.compactRatio ?? 0.7;
  const survivalRatio = config?.survivalRatio ?? 0.85;
  const walRatio = config?.walRatio ?? 0.95;

  if (
    config?.planTier === "unlimited" &&
    !Number.isFinite(dailyWriteBudget) &&
    !Number.isFinite(dailyReadBudget)
  ) {
    return QuotaDegradationTier.NOMINAL;
  }

  const writeRatio =
    Number.isFinite(dailyWriteBudget) && dailyWriteBudget > 0
      ? rowsWritten / dailyWriteBudget
      : 0;
  const readRatio =
    Number.isFinite(dailyReadBudget) && dailyReadBudget > 0
      ? rowsRead / dailyReadBudget
      : 0;
  const maxRatio = Math.max(writeRatio, readRatio);

  if (maxRatio >= walRatio) return QuotaDegradationTier.R2_WAL_FALLBACK;
  if (maxRatio >= survivalRatio) return QuotaDegradationTier.CRITICAL_SURVIVAL;
  if (maxRatio >= compactRatio) return QuotaDegradationTier.COMPACT_ROLLUP;
  if (maxRatio >= conservativeRatio) return QuotaDegradationTier.CONSERVATIVE;
  return QuotaDegradationTier.NOMINAL;
}

export function isD1QuotaException(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const cleanMsg = msg.replace(/quota_state_daily/g, "");
  return (
    cleanMsg.includes("d1_error") ||
    cleanMsg.includes("rows written") ||
    cleanMsg.includes("rows read") ||
    cleanMsg.includes("quota") ||
    cleanMsg.includes("daily limit") ||
    cleanMsg.includes("too many requests") ||
    cleanMsg.includes("rate limit")
  );
}

export interface QuotaStateSnapshot {
  readonly dateUtc: string;
  readonly estimatedRowsWritten: number;
  readonly estimatedRowsRead: number;
  readonly dailyWrites: number;
  readonly dailyReads: number;
  readonly d1HardBlocked: boolean;
  readonly tripReason: string | null;
  readonly tier: QuotaDegradationTier;
  readonly tierName: DegradationTierName;
  readonly planTier?: CloudflarePlanTier | undefined;
  readonly updatedAt: number;
}

export class EdgeQuotaTracker {
  private currentDay: string = "";
  private estimatedRowsWritten = 0;
  private estimatedRowsRead = 0;
  private d1HardBlocked = false;
  private lastTripReason: string | null = null;
  private requestCounter = 0;
  private quotaConfig: QuotaStrategyConfig = resolveQuotaConfig();

  private getTodayString(nowMs?: number): string {
    return new Date(nowMs ?? Date.now()).toISOString().slice(0, 10);
  }

  private checkDayRollover(nowMs?: number): void {
    const today = this.getTodayString(nowMs);
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.estimatedRowsWritten = 0;
      this.estimatedRowsRead = 0;
      this.d1HardBlocked = false;
      this.lastTripReason = null;
      this.requestCounter = 0;
    }
  }

  configureFromEnv(env?: Record<string, unknown>): QuotaStrategyConfig {
    this.quotaConfig = resolveQuotaConfig(env);
    return this.quotaConfig;
  }

  getConfig(): QuotaStrategyConfig {
    return this.quotaConfig;
  }

  getTier(nowMs?: number): QuotaDegradationTier {
    this.checkDayRollover(nowMs);
    return resolveDegradationTier(
      this.estimatedRowsWritten,
      this.estimatedRowsRead,
      this.d1HardBlocked,
      this.quotaConfig,
    );
  }

  getTierName(nowMs?: number): DegradationTierName {
    return degradationTierToName(this.getTier(nowMs));
  }

  recordWrite(count = 1, nowMs?: number): QuotaDegradationTier {
    this.checkDayRollover(nowMs);
    this.requestCounter++;
    this.estimatedRowsWritten += Math.max(0, count);
    return this.getTier(nowMs);
  }

  recordRead(count = 1, nowMs?: number): QuotaDegradationTier {
    this.checkDayRollover(nowMs);
    this.estimatedRowsRead += Math.max(0, count);
    return this.getTier(nowMs);
  }

  shouldSyncD1(): boolean {
    return this.requestCounter > 0 && this.requestCounter % 25 === 0;
  }

  shouldSyncCache(): boolean {
    return this.requestCounter > 0 && this.requestCounter % 50 === 0;
  }

  tripCircuitBreaker(
    reason = "d1_quota_exception",
    nowMs?: number,
    ctx?: ExecutionContext,
  ): QuotaDegradationTier {
    this.checkDayRollover(nowMs);
    this.d1HardBlocked = true;
    this.lastTripReason = reason;
    const syncPromise = this.syncToCacheOnly();
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(syncPromise);
    }
    return QuotaDegradationTier.R2_WAL_FALLBACK;
  }

  setCountsForTesting(
    rowsWritten: number,
    rowsRead: number,
    d1HardBlocked = false,
  ): QuotaDegradationTier {
    return this.setQuotaState(rowsWritten, rowsRead, d1HardBlocked);
  }

  setQuotaState(
    rowsWritten: number,
    rowsRead: number,
    d1HardBlocked = false,
  ): QuotaDegradationTier {
    this.checkDayRollover();
    this.estimatedRowsWritten = Math.max(0, rowsWritten);
    this.estimatedRowsRead = Math.max(0, rowsRead);
    this.d1HardBlocked = d1HardBlocked;
    return this.getTier();
  }

  recordD1Meta(
    meta?: { rows_written?: number; rows_read?: number } | null,
    fallbackWrites = 0,
    fallbackReads = 0,
    nowMs?: number,
  ): QuotaDegradationTier {
    this.checkDayRollover(nowMs);
    const writes =
      typeof meta?.rows_written === "number"
        ? meta.rows_written
        : fallbackWrites;
    const reads =
      typeof meta?.rows_read === "number" ? meta.rows_read : fallbackReads;
    this.estimatedRowsWritten += Math.max(0, writes);
    this.estimatedRowsRead += Math.max(0, reads);
    return this.getTier(nowMs);
  }

  markD1QuotaError(
    err?: unknown,
    ctx?: ExecutionContext,
  ): QuotaDegradationTier {
    return this.tripCircuitBreaker(
      err ? String(err) : "d1_quota_error",
      undefined,
      ctx,
    );
  }

  async syncToCacheOnly(): Promise<void> {
    const cache =
      typeof caches !== "undefined"
        ? (caches as unknown as { default?: Cache })?.default
        : undefined;
    if (!cache) return;
    try {
      const snapshot = this.getSnapshot();
      const now = new Date();
      const tomorrowUtc = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        0,
        0,
        0,
      );
      const ttlSeconds = Math.max(
        60,
        Math.floor((tomorrowUtc - now.getTime()) / 1000),
      );
      await cache.put(
        new Request(
          `https://arturonavax.dev/__cf_edge_quota_state/${snapshot.dateUtc}`,
          { method: "GET" },
        ),
        new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${ttlSeconds}`,
          },
        }),
      );
    } catch {
      // Fail-open
    }
  }

  buildQuotaUpsertStatement(
    db: D1Database,
    nowMs?: number,
  ): D1PreparedStatement | null {
    this.checkDayRollover(nowMs);
    if (this.d1HardBlocked) return null;
    const snapshot = this.getSnapshot(nowMs);
    return db
      .prepare(
        `INSERT INTO quota_state_daily (date_utc, estimated_rows_written, estimated_rows_read, degradation_tier, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date_utc) DO UPDATE SET
           estimated_rows_written = MAX(quota_state_daily.estimated_rows_written, excluded.estimated_rows_written),
           estimated_rows_read = MAX(quota_state_daily.estimated_rows_read, excluded.estimated_rows_read),
           degradation_tier = MAX(quota_state_daily.degradation_tier, excluded.degradation_tier),
           updated_at = excluded.updated_at`,
      )
      .bind(
        snapshot.dateUtc,
        snapshot.estimatedRowsWritten,
        snapshot.estimatedRowsRead,
        snapshot.tier,
        snapshot.updatedAt,
      );
  }

  async syncFromD1AndCache(
    db?: D1Database,
    nowMs?: number,
  ): Promise<QuotaStateSnapshot> {
    this.checkDayRollover(nowMs);
    const today = this.currentDay;
    const cache =
      typeof caches !== "undefined"
        ? (caches as unknown as { default?: Cache })?.default
        : undefined;
    const cacheUrl = `https://arturonavax.dev/__cf_edge_quota_state/${today}`;
    const req = new Request(cacheUrl, { method: "GET" });

    if (cache) {
      try {
        const cached = await cache.match(req);
        if (cached) {
          const data = (await cached.json()) as Partial<QuotaStateSnapshot>;
          if (typeof data.estimatedRowsWritten === "number") {
            this.estimatedRowsWritten = Math.max(
              this.estimatedRowsWritten,
              data.estimatedRowsWritten,
            );
          }
          if (typeof data.estimatedRowsRead === "number") {
            this.estimatedRowsRead = Math.max(
              this.estimatedRowsRead,
              data.estimatedRowsRead,
            );
          }
          if (data.d1HardBlocked === true) {
            this.d1HardBlocked = true;
          }
          return this.getSnapshot(nowMs);
        }
      } catch {
        // Fail-open
      }
    }

    if (db && !this.d1HardBlocked) {
      try {
        const stmt = db
          .prepare(
            `SELECT estimated_rows_written, estimated_rows_read, degradation_tier
             FROM quota_state_daily WHERE date_utc = ?`,
          )
          .bind(today);

        let row:
          | {
              estimated_rows_written?: number;
              estimated_rows_read?: number;
              degradation_tier?: number;
            }
          | null
          | undefined = null;

        if (typeof (stmt as any).first === "function") {
          row = await (stmt as any).first();
        } else if (typeof (stmt as any).all === "function") {
          const res = await (stmt as any).all();
          row = (res?.results?.[0] as typeof row) || null;
        }

        if (row) {
          if (typeof row.estimated_rows_written === "number") {
            this.estimatedRowsWritten = Math.max(
              this.estimatedRowsWritten,
              row.estimated_rows_written,
            );
          }
          if (typeof row.estimated_rows_read === "number") {
            this.estimatedRowsRead = Math.max(
              this.estimatedRowsRead,
              row.estimated_rows_read,
            );
          }
          if (
            typeof row.degradation_tier === "number" &&
            row.degradation_tier === QuotaDegradationTier.R2_WAL_FALLBACK
          ) {
            this.d1HardBlocked = true;
          }
        }
      } catch (err) {
        if (isD1QuotaException(err)) {
          this.d1HardBlocked = true;
        }
      }
    }

    const snapshot = this.getSnapshot(nowMs);

    if (cache) {
      try {
        await cache.put(
          req,
          new Response(JSON.stringify(snapshot), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=300",
            },
          }),
        );
      } catch {
        // Fail-open
      }
    }

    return snapshot;
  }

  async tickAndMaybeSync(
    _db?: D1Database,
    ctx?: ExecutionContext,
  ): Promise<QuotaDegradationTier> {
    this.checkDayRollover();
    this.requestCounter++;
    if (this.requestCounter % 50 === 0) {
      const syncPromise = this.syncToCacheOnly();
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(syncPromise);
      } else {
        await syncPromise;
      }
    }
    return this.getTier();
  }

  async syncToCacheAndD1(db?: D1Database): Promise<void> {
    this.checkDayRollover();
    await this.syncFromD1AndCache(db);
  }

  getSnapshot(nowMs?: number): QuotaStateSnapshot {
    this.checkDayRollover(nowMs);
    const tier = this.getTier(nowMs);
    return {
      dateUtc: this.currentDay,
      estimatedRowsWritten: this.estimatedRowsWritten,
      estimatedRowsRead: this.estimatedRowsRead,
      dailyWrites: this.estimatedRowsWritten,
      dailyReads: this.estimatedRowsRead,
      d1HardBlocked: this.d1HardBlocked,
      tripReason: this.lastTripReason,
      tier,
      tierName: degradationTierToName(tier),
      planTier: this.quotaConfig.planTier,
      updatedAt: nowMs ?? Date.now(),
    };
  }

  reset(): void {
    this.currentDay = this.getTodayString();
    this.estimatedRowsWritten = 0;
    this.estimatedRowsRead = 0;
    this.d1HardBlocked = false;
    this.lastTripReason = null;
    this.requestCounter = 0;
    this.quotaConfig = resolveQuotaConfig();
  }
}

export const edgeQuotaTracker = new EdgeQuotaTracker();

export class FailOpenCircuitBreaker implements FailOpenCircuitBreakerPort {
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallbackValue: T | (() => Promise<T> | T),
    timeoutMs = 350,
    operationName = "circuit-breaker-operation",
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `[CircuitBreaker] Operation '${operationName}' exceeded timeout of ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });

    try {
      const opPromise = operation();
      // Shield against unhandled floating rejection if timeout fires first
      opPromise.catch(() => {});
      return await Promise.race([opPromise, timeoutPromise]);
    } catch (err) {
      console.warn(
        `[CircuitBreaker: Fail-Open] Fallback triggered for '${operationName}':`,
        err instanceof Error ? err.message : err,
      );
      if (typeof fallbackValue === "function") {
        return await (fallbackValue as () => Promise<T> | T)();
      }
      return fallbackValue;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
