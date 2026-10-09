import { describe, expect, it, beforeEach } from "bun:test";
import worker, {
  type Env,
  prefetchCircuitBreaker,
} from "../../cloudflare/worker";
import {
  PrefetchQuotaCircuitBreaker,
  D1TelemetryAdapter,
} from "../../src/lib/adapters";

const dummyAssets: Fetcher = {
  fetch: async () => {
    return new Response("<html><body>Fast-Path Content</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
} as unknown as Fetcher;

const createMockCtx = () => {
  const promises: Promise<any>[] = [];
  return {
    waitUntil: (p: Promise<any>) => promises.push(p),
    passThroughOnException: () => {},
    promises,
  } as unknown as ExecutionContext & { promises: Promise<any>[] };
};

const createMockDb = () => {
  const executedQueries: { sql: string; params: any[] }[] = [];
  return {
    prepare: (sql: string) => ({
      bind: (...params: any[]) => ({
        run: async () => {
          executedQueries.push({ sql, params });
          return { success: true };
        },
      }),
    }),
    executedQueries,
  } as unknown as D1Database & {
    executedQueries: { sql: string; params: any[] }[];
  };
};

describe("PrefetchQuotaCircuitBreaker Unit Tests", () => {
  let breaker: PrefetchQuotaCircuitBreaker;

  beforeEach(() => {
    breaker = new PrefetchQuotaCircuitBreaker({
      defaultDailyWriteBudget: 1000,
      prefetchBudgetRatio: 0.25, // 250 writes max for prefetch
      maxPrefetchToVisitRatio: 2.0,
      minSampleThreshold: 10,
    });
  });

  it("permits prefetch under normal operating conditions (state CLOSED)", () => {
    expect(breaker.canRecordPrefetch()).toBe(true);
    expect(breaker.getStatus().state).toBe("CLOSED");
  });

  it("acts as immediate kill-switch when ENABLE_PREFETCH_TELEMETRY is false", () => {
    expect(
      breaker.canRecordPrefetch({ ENABLE_PREFETCH_TELEMETRY: "false" }),
    ).toBe(false);
    expect(breaker.getStatus().state).toBe("OPEN");

    expect(
      breaker.canRecordPrefetch({ ENABLE_PREFETCH_TELEMETRY: false }),
    ).toBe(false);
  });

  it("trips to OPEN when absolute prefetch budget is exhausted", () => {
    // Budget is 250
    for (let i = 0; i < 250; i++) {
      breaker.recordPrefetch();
    }
    expect(breaker.canRecordPrefetch()).toBe(false);
    expect(breaker.getStatus().state).toBe("OPEN");
  });

  it("trips to OPEN when prefetch flow is disproportionate to real visits", () => {
    // 0 visits, 25 prefetches (exceeds minSampleThreshold 10 and 0 * 2.0)
    for (let i = 0; i < 25; i++) {
      breaker.recordPrefetch();
    }
    expect(breaker.canRecordPrefetch()).toBe(false);
    expect(breaker.getStatus().state).toBe("OPEN");

    // Real visits arrive and restore ratio balance
    for (let i = 0; i < 20; i++) {
      breaker.recordVisit();
    }
    expect(breaker.canRecordPrefetch()).toBe(true);
    expect(breaker.getStatus().state).toBe("CLOSED");
  });

  it("enforces visit budget protection when daily visits approach ceiling", () => {
    expect(breaker.canRecordVisit()).toBe(true);
    for (let i = 0; i < 650; i++) {
      breaker.recordVisit();
    }
    expect(breaker.canRecordVisit()).toBe(false);
  });
});

describe("Edge Worker Prefetch Telemetry Integration", () => {
  beforeEach(() => {
    prefetchCircuitBreaker.reset();
  });

  it("records prefetch in prefetch_analytics_events when circuit breaker is CLOSED", async () => {
    const ctx = createMockCtx();
    const db = createMockDb();
    const env: Env = { ASSETS: dummyAssets, DB: db };

    const req = new Request("https://arturonavax.dev/blog/", {
      headers: {
        accept: "text/html",
        purpose: "prefetch",
      },
    });

    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    // Prefetch telemetry enqueued asynchronously via ctx.waitUntil
    expect(ctx.promises.length).toBe(1);
    await Promise.all(ctx.promises);

    expect(db.executedQueries.length).toBe(1);
    expect(db.executedQueries[0].sql).toContain("prefetch_analytics_events");
  });

  it("drops prefetch telemetry when kill-switch is active and records incident warning", async () => {
    const ctx = createMockCtx();
    const db = createMockDb();
    const env: Env = {
      ASSETS: dummyAssets,
      DB: db,
      ENABLE_PREFETCH_TELEMETRY: "false",
    };

    const req = new Request("https://arturonavax.dev/blog/", {
      headers: {
        accept: "text/html",
        purpose: "prefetch",
      },
    });

    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    // Logs incident once per day to circuit_breaker_incidents
    expect(ctx.promises.length).toBe(1);
    await Promise.all(ctx.promises);
    expect(db.executedQueries.length).toBe(1);
    expect(db.executedQueries[0].sql).toContain("circuit_breaker_incidents");
    expect(db.executedQueries[0].params[2]).toBe("kill_switch");

    // Subsequent prefetch on same day does not duplicate incident logging
    const ctx2 = createMockCtx();
    const res2 = await worker.fetch(req, env, ctx2);
    expect(res2.status).toBe(200);
    expect(ctx2.promises.length).toBe(0);
  });

  it("exposes data quality warnings on /api/metrics when incidents exist", async () => {
    const ctx = createMockCtx();
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => {
            if (sql.includes("circuit_breaker_incidents")) {
              return {
                results: [
                  {
                    id: 1,
                    subsystem: "prefetch_telemetry",
                    date: "2026-10-08",
                    reason: "proportional_storm",
                    shed_count: 55,
                    data_completeness: "partial",
                  },
                ],
              };
            }
            return { results: [] };
          },
        }),
        all: async () => {
          if (sql.includes("circuit_breaker_incidents")) {
            return {
              results: [
                {
                  id: 1,
                  subsystem: "prefetch_telemetry",
                  date: "2026-10-08",
                  reason: "proportional_storm",
                  shed_count: 55,
                  data_completeness: "partial",
                },
              ],
            };
          }
          return { results: [] };
        },
      }),
    } as unknown as D1Database;

    const env: Env = { ASSETS: dummyAssets, DB: db };
    const req = new Request("https://admin.arturonavax.dev/api/metrics");
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);

    const data = (await res.json()) as any;
    expect(data.data_quality_warnings).toBeDefined();
    expect(data.data_quality_warnings.length).toBe(1);
    expect(data.data_quality_warnings[0].data_completeness).toBe("partial");
    expect(data.data_quality_warnings[0].warning).toContain(
      "proportional_storm",
    );
  });

  it("always prioritizes real visits in pageviews table (P0)", async () => {
    const ctx = createMockCtx();
    const db = createMockDb();
    const env: Env = {
      ASSETS: dummyAssets,
      DB: db,
      ENABLE_PREFETCH_TELEMETRY: "false", // Even if prefetch is off
    };

    const req = new Request("https://arturonavax.dev/blog/", {
      headers: {
        accept: "text/html",
      },
    });

    const res = await worker.fetch(req, env, ctx);

    expect(res.status).toBe(200);

    // Real visit is enqueued
    expect(ctx.promises.length).toBe(1);
    await Promise.all(ctx.promises);

    expect(db.executedQueries.length).toBe(2); // pageviews + pageview_events
    expect(db.executedQueries[0].sql).toContain("pageviews");
  });
});

describe("D1TelemetryAdapter Quality Query Methods", () => {
  it("queries circuit breaker incidents and prefetch completeness views", async () => {
    const mockDb = {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => {
            if (sql.includes("circuit_breaker_incidents")) {
              return {
                results: [
                  {
                    id: 1,
                    subsystem: "prefetch_telemetry",
                    date: "2026-10-08",
                    trippedAt: "2026-10-08 12:00:00",
                    reason: "budget_exhausted",
                    shedCount: 150,
                    dataCompleteness: "partial",
                  },
                ],
              };
            }
            if (sql.includes("v_prefetch_daily_summary")) {
              return {
                results: [
                  {
                    summaryDate: "2026-10-08",
                    path: "/blog",
                    recordedPrefetches: 400,
                    dataCompleteness: "partial",
                    estimatedShedCount: 150,
                    circuitBreakerReason: "budget_exhausted",
                  },
                ],
              };
            }
            return { results: [] };
          },
        }),
      }),
    } as unknown as D1Database;

    const adapter = new D1TelemetryAdapter(mockDb);
    const incidents =
      await adapter.getCircuitBreakerIncidents("prefetch_telemetry");
    expect(incidents.length).toBe(1);
    expect(incidents[0].reason).toBe("budget_exhausted");
    expect(incidents[0].dataCompleteness).toBe("partial");

    const prefetchSummary = await adapter.getPrefetchSummaryWithQuality(
      "2026-10-01",
      "2026-10-08",
    );
    expect(prefetchSummary.length).toBe(1);
    expect(prefetchSummary[0].dataCompleteness).toBe("partial");
    expect(prefetchSummary[0].estimatedShedCount).toBe(150);
  });
});
