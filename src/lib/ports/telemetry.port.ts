export interface EdgeTelemetryPayload {
  readonly path: string;
  readonly locale: string;
  readonly visitorHash: string;
  readonly referrer?: string;
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
}

export interface TelemetryIngestResult {
  readonly queued: boolean;
  readonly bypassed: boolean;
  readonly reason?: "prefetch" | "bot" | "invalid_payload";
}
