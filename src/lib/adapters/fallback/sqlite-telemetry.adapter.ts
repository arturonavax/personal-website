import type {
  TelemetryPort,
  PageviewEvent,
  DailySummaryMetric,
} from "../../ports/telemetry.port";

export class SQLiteTelemetryAdapter implements TelemetryPort {
  private events: PageviewEvent[] = [];
  private summaries: Map<string, DailySummaryMetric> = new Map();

  constructor(private readonly connectionString?: string | undefined) {}

  getConnectionString(): string | undefined {
    return this.connectionString;
  }

  async recordPageview(event: PageviewEvent): Promise<void> {
    this.events.push(event);
    const date = new Date(event.timestamp).toISOString().slice(0, 10);
    const key = `${date}:${event.path}:${event.locale}:${event.country || "XX"}`;
    const existing = this.summaries.get(key);
    if (existing) {
      existing.views += 1;
    } else {
      this.summaries.set(key, {
        date,
        path: event.path,
        locale: event.locale,
        country: event.country || "XX",
        views: 1,
      });
    }
  }

  async getAggregatedMetrics(
    startDate: string,
    endDate: string,
  ): Promise<DailySummaryMetric[]> {
    return Array.from(this.summaries.values())
      .filter((metric) => metric.date >= startDate && metric.date <= endDate)
      .sort((a, b) => b.views - a.views);
  }
}
