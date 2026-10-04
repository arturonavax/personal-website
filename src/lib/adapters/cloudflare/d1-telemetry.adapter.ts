/// <reference types="@cloudflare/workers-types" />
import type {
  TelemetryPort,
  PageviewEvent,
  DailySummaryMetric,
} from "../../ports/telemetry.port";

export class D1TelemetryAdapter implements TelemetryPort {
  constructor(private readonly db: D1Database) {}

  async recordPageview(event: PageviewEvent): Promise<void> {
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
}
