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

export interface TelemetryIngestionResult {
  recorded: boolean;
  deduped: boolean;
  deduplicated?: boolean | undefined;
  degradationTier?:
    | "NOMINAL"
    | "CONSERVATIVE"
    | "COMPACT_ROLLUP"
    | "CRITICAL_SURVIVAL"
    | "R2_WAL_FALLBACK"
    | undefined;
  storageTier:
    | "L1_CACHE"
    | "D1"
    | "D1_BATCH"
    | "D1_ROLLUP_ONLY"
    | "R2_WAL"
    | "ANALYTICS_ENGINE_AND_R2_WAL";
  storageTarget?:
    | "L1_CACHE"
    | "D1_RAW_AND_ROLLUP"
    | "D1_ROLLUP_ONLY"
    | "ANALYTICS_ENGINE_AND_R2_WAL"
    | undefined;
}

export interface PrefetchTelemetryEvent {
  path: string;
  visitorHash: string;
  country?: string | undefined;
  referrer?: string | undefined;
  purpose: string;
}

export type CircuitBreakerTripReason =
  "budget_exhausted" | "proportional_storm" | "kill_switch" | "none";

export interface CircuitBreakerIncident {
  readonly id?: number;
  readonly subsystem: string;
  readonly date: string;
  readonly trippedAt: string;
  readonly reason: CircuitBreakerTripReason;
  readonly shedCount: number;
  readonly dataCompleteness: "complete" | "partial";
  readonly notes?: string;
}

export interface PrefetchDailySummaryWithQuality {
  readonly summaryDate: string;
  readonly path: string;
  readonly recordedPrefetches: number;
  readonly dataCompleteness: "complete" | "partial";
  readonly estimatedShedCount: number;
  readonly circuitBreakerReason?: string | null;
}

export interface CircuitBreakerStatus {
  readonly state: "CLOSED" | "OPEN" | "HALF_OPEN";
  readonly dailyPrefetchCount: number;
  readonly dailyVisitCount: number;
  readonly maxPrefetchBudget: number;
  readonly tripReason: CircuitBreakerTripReason;
}

export interface BotCircuitBreakerStatus {
  readonly state: "CLOSED" | "OPEN" | "HALF_OPEN";
  readonly dailyBotCount: number;
  readonly maxBotBudget: number;
  readonly tripReason: CircuitBreakerTripReason;
}

export interface PrefetchCircuitBreakerPort {
  canRecordPrefetch(env?: Record<string, unknown>): boolean;
  canRecordVisit?(env?: Record<string, unknown>): boolean;
  getTripReason(): CircuitBreakerTripReason;
  shouldLogIncident(dateString: string): boolean;
  markIncidentLogged(dateString: string): void;
  recordVisit(): void;
  recordPrefetch(): void;
  getStatus(env?: Record<string, unknown>): CircuitBreakerStatus;
  reset(): void;
}

export interface BotCircuitBreakerPort {
  canRecordBot(
    env?: Record<string, unknown>,
    userAgentOrVerified?: string | boolean,
    classification?: string,
  ): boolean;
  getTripReason(): CircuitBreakerTripReason;
  shouldLogIncident(dateString: string): boolean;
  markIncidentLogged(dateString: string): void;
  recordBot(): void;
  getStatus(env?: Record<string, unknown>): BotCircuitBreakerStatus;
  reset(): void;
}

export interface TelemetryPort {
  recordPrefetch?(event: PrefetchTelemetryEvent): Promise<void>;
  getCircuitBreakerIncidents?(
    subsystem?: string,
  ): Promise<CircuitBreakerIncident[]>;
  getPrefetchSummaryWithQuality?(
    startDate: string,
    endDate: string,
  ): Promise<PrefetchDailySummaryWithQuality[]>;
}
