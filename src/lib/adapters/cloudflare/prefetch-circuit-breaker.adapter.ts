import type {
  PrefetchCircuitBreakerPort,
  CircuitBreakerStatus,
  CircuitBreakerTripReason,
} from "../../ports/telemetry.port";

export interface CircuitBreakerConfig {
  readonly defaultDailyWriteBudget?: number;
  readonly prefetchBudgetRatio?: number; // Fraction of daily budget allocated to prefetch (e.g., 0.25 = 25%)
  readonly maxPrefetchToVisitRatio?: number; // Max prefetch/visit ratio before tripping (e.g., 3.0)
  readonly minSampleThreshold?: number; // Min requests before applying ratio rule
}

export class PrefetchQuotaCircuitBreaker implements PrefetchCircuitBreakerPort {
  private dailyPrefetchCount = 0;
  private dailyVisitCount = 0;
  private currentDay: string;
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
    this.currentDay = this.getTodayString();
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

  canRecordPrefetch(env?: Record<string, unknown>): boolean {
    this.checkDayRollover();

    // 1. Kill-Switch inmediato vía variable de entorno / secreto
    if (env) {
      const toggle = env.ENABLE_PREFETCH_TELEMETRY;
      if (toggle === false || toggle === "false" || toggle === "0") {
        this.state = "OPEN";
        this.tripReason = "kill_switch";
        return false;
      }
    }

    // 2. Cálculo del presupuesto de escritura diario seguro
    let totalBudget = this.defaultDailyWriteBudget;
    if (env?.D1_DAILY_WRITE_BUDGET) {
      const parsed = Number(env.D1_DAILY_WRITE_BUDGET);
      if (!Number.isNaN(parsed) && parsed > 0) {
        totalBudget = parsed;
      }
    }

    const maxPrefetchBudget = Math.floor(
      totalBudget * this.prefetchBudgetRatio,
    );

    // 3. Verificación de límite de presupuesto absoluto
    if (this.dailyPrefetchCount >= maxPrefetchBudget) {
      this.state = "OPEN";
      this.tripReason = "budget_exhausted";
      return false;
    }

    // 4. Verificación de flujo proporcional de prefetch vs visitas reales
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
    let totalBudget = this.defaultDailyWriteBudget;
    if (env?.D1_DAILY_WRITE_BUDGET) {
      const parsed = Number(env.D1_DAILY_WRITE_BUDGET);
      if (!Number.isNaN(parsed) && parsed > 0) {
        totalBudget = parsed;
      }
    }
    // Hard ceiling: max 65% of daily budget allocated to real visit writes (prevents overage)
    const maxVisitBudget = Math.floor(totalBudget * 0.65);
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

  recordPrefetch(): void {
    this.checkDayRollover();
    this.dailyPrefetchCount++;
  }

  getStatus(): CircuitBreakerStatus {
    this.checkDayRollover();
    const maxPrefetchBudget = Math.floor(
      this.defaultDailyWriteBudget * this.prefetchBudgetRatio,
    );
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
