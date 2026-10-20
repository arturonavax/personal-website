import type {
  PrefetchCircuitBreakerPort,
  CircuitBreakerStatus,
  CircuitBreakerTripReason,
} from "../../ports/telemetry.port";
import {
  edgeQuotaTracker,
  QuotaDegradationTier,
  resolveQuotaConfig,
} from "./circuit-breaker.adapter";

export interface CircuitBreakerConfig {
  readonly defaultDailyWriteBudget?: number;
  readonly prefetchBudgetRatio?: number; // Fraction of daily budget allocated to prefetch (e.g., 0.25 = 25%)
  readonly maxPrefetchToVisitRatio?: number; // Max prefetch/visit ratio before tripping (e.g., 3.0)
  readonly minSampleThreshold?: number; // Min requests before applying ratio rule
}

export class PrefetchQuotaCircuitBreaker implements PrefetchCircuitBreakerPort {
  private dailyPrefetchCount = 0;
  private dailyVisitCount = 0;
  private currentDay: string = "";
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private tripReason: CircuitBreakerTripReason = "none";
  private loggedIncidentDays = new Set<string>();

  private readonly defaultDailyWriteBudget: number;
  private readonly prefetchBudgetRatio: number;
  private readonly maxPrefetchToVisitRatio: number;
  private readonly minSampleThreshold: number;

  constructor(config?: CircuitBreakerConfig) {
    this.defaultDailyWriteBudget = config?.defaultDailyWriteBudget ?? 100_000;
    this.prefetchBudgetRatio = config?.prefetchBudgetRatio ?? 0.25;
    this.maxPrefetchToVisitRatio = config?.maxPrefetchToVisitRatio ?? 3.0;
    this.minSampleThreshold = config?.minSampleThreshold ?? 100;
  }

  private getTodayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private checkDayRollover(): void {
    const today = this.getTodayString();
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailyPrefetchCount = 0;
      this.dailyVisitCount = 0;
      this.state = "CLOSED";
      this.tripReason = "none";
      this.loggedIncidentDays.clear();
    }
  }

  private computeBudgets(env?: Record<string, unknown>): {
    maxPrefetchBudget: number;
    maxVisitBudget: number;
  } {
    if (!env) {
      return {
        maxPrefetchBudget: Math.floor(
          this.defaultDailyWriteBudget * this.prefetchBudgetRatio,
        ),
        maxVisitBudget: Math.floor(this.defaultDailyWriteBudget * 0.65),
      };
    }
    const resolved = resolveQuotaConfig(env);
    const hasEnvBudget =
      env.D1_DAILY_WRITE_BUDGET !== undefined ||
      env.CLOUDFLARE_PLAN_TIER !== undefined;
    const totalBudget = hasEnvBudget
      ? resolved.dailyWriteBudget
      : this.defaultDailyWriteBudget;
    const prefetchRatio =
      env.D1_PREFETCH_BUDGET_RATIO !== undefined
        ? resolved.prefetchBudgetRatio
        : this.prefetchBudgetRatio;
    const visitRatio =
      env.D1_VISIT_BUDGET_RATIO !== undefined
        ? resolved.visitBudgetRatio
        : 0.65;

    if (!Number.isFinite(totalBudget)) {
      return {
        maxPrefetchBudget: Number.MAX_SAFE_INTEGER,
        maxVisitBudget: Number.MAX_SAFE_INTEGER,
      };
    }
    return {
      maxPrefetchBudget: Math.floor(totalBudget * prefetchRatio),
      maxVisitBudget: Math.floor(totalBudget * visitRatio),
    };
  }

  canRecordPrefetch(env?: Record<string, unknown>, bypass = false): boolean {
    if (bypass) {
      return false;
    }
    this.checkDayRollover();

    // 1. Immediate kill-switch via environment variable / secret
    if (env) {
      const toggle = env.ENABLE_PREFETCH_TELEMETRY;
      if (toggle === false || toggle === "false" || toggle === "0") {
        this.state = "OPEN";
        this.tripReason = "kill_switch";
        return false;
      }
    }

    // 1b. Progressive Degradation Tier >= CONSERVATIVE (50% quota): 100% shutoff of prefetch D1 writes
    if (edgeQuotaTracker.getTier() >= QuotaDegradationTier.CONSERVATIVE) {
      this.state = "OPEN";
      this.tripReason = "budget_exhausted";
      return false;
    }

    // 2. Compute safe daily write budget
    const { maxPrefetchBudget } = this.computeBudgets(env);

    // 3. Absolute prefetch budget cap check
    if (this.dailyPrefetchCount >= maxPrefetchBudget) {
      this.state = "OPEN";
      this.tripReason = "budget_exhausted";
      return false;
    }

    // 4. Proportional prefetch vs real visits ratio check
    if (
      this.dailyPrefetchCount > this.minSampleThreshold &&
      this.dailyPrefetchCount >
        this.dailyVisitCount * this.maxPrefetchToVisitRatio
    ) {
      this.state = "OPEN";
      this.tripReason = "proportional_storm";
      return false;
    }

    this.state = "CLOSED";
    this.tripReason = "none";
    return true;
  }

  canRecordVisit(env?: Record<string, unknown>): boolean {
    this.checkDayRollover();
    const { maxVisitBudget } = this.computeBudgets(env);
    return this.dailyVisitCount < maxVisitBudget;
  }

  getTripReason(): CircuitBreakerTripReason {
    return this.tripReason;
  }

  shouldLogIncident(dateString: string): boolean {
    return !this.loggedIncidentDays.has(dateString);
  }

  markIncidentLogged(dateString: string): void {
    this.loggedIncidentDays.add(dateString);
  }

  recordVisit(): void {
    this.checkDayRollover();
    this.dailyVisitCount++;
    if (
      this.state === "OPEN" &&
      this.dailyPrefetchCount > 0 &&
      this.tripReason === "proportional_storm"
    ) {
      if (
        this.dailyPrefetchCount <=
        this.dailyVisitCount * this.maxPrefetchToVisitRatio
      ) {
        this.state = "CLOSED";
        this.tripReason = "none";
      }
    }
  }

  recordPrefetch(bypass = false): void {
    if (bypass) return;
    this.checkDayRollover();
    this.dailyPrefetchCount++;
  }

  getStatus(env?: Record<string, unknown>): CircuitBreakerStatus {
    this.checkDayRollover();
    const { maxPrefetchBudget } = this.computeBudgets(env);
    return {
      state: this.state,
      dailyPrefetchCount: this.dailyPrefetchCount,
      dailyVisitCount: this.dailyVisitCount,
      maxPrefetchBudget,
      tripReason: this.tripReason,
    };
  }

  reset(): void {
    this.dailyPrefetchCount = 0;
    this.dailyVisitCount = 0;
    this.state = "CLOSED";
    this.tripReason = "none";
    this.loggedIncidentDays.clear();
    this.currentDay = this.getTodayString();
  }
}
