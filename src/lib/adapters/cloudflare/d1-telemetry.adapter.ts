/// <reference types="@cloudflare/workers-types" />
import type {
  TelemetryPort,
  PageviewEvent,
  DailySummaryMetric,
} from "../../ports/telemetry.port";

export class D1TelemetryAdapter implements TelemetryPort {
  constructor(private readonly db: D1Database) {}

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
    } catch (err) {
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
    } catch (err) {
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
