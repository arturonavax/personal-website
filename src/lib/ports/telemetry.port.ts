export interface EdgeTelemetryPayload {
  readonly path: string;
  readonly locale: string;
  readonly visitorHash: string;
  readonly referrer?: string | undefined;
  readonly utmSource?: string | undefined;
  readonly utmMedium?: string | undefined;
  readonly utmCampaign?: string | undefined;
}

export interface TelemetryIngestResult {
  readonly queued: boolean;
  readonly bypassed: boolean;
  readonly reason?: "prefetch" | "bot" | "invalid_payload" | undefined;
}

export interface PageviewEvent {
  path: string;
  locale: string;
  country?: string | undefined;
  referrer?: string | undefined;
  userAgent?: string | undefined;
  timestamp: number;
}

export interface DailySummaryMetric {
  date: string;
  path: string;
  locale: string;
  country: string;
  views: number;
}

export interface TelemetryPort {
  recordPageview(event: PageviewEvent): Promise<void>;
  getAggregatedMetrics(
    startDate: string,
    endDate: string,
  ): Promise<DailySummaryMetric[]>;
}
