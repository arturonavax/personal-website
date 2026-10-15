import type {
  BotCircuitBreakerPort,
  BotCircuitBreakerStatus,
  CircuitBreakerTripReason,
} from "../../ports/telemetry.port";

export interface BotCircuitBreakerConfig {
  readonly defaultDailyWriteBudget?: number;
  readonly botBudgetRatio?: number; // Fraction of daily budget allocated to bots (e.g., 0.15 = 15%)
}

export class BotQuotaCircuitBreaker implements BotCircuitBreakerPort {
  private dailyBotCount = 0;
  private currentDay: string;
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private tripReason: CircuitBreakerTripReason = "none";
  private loggedIncidentDays = new Set<string>();

  private readonly defaultDailyWriteBudget: number;
  private readonly botBudgetRatio: number;

  constructor(config?: BotCircuitBreakerConfig) {
    this.defaultDailyWriteBudget = config?.defaultDailyWriteBudget ?? 100_000;
    this.botBudgetRatio = config?.botBudgetRatio ?? 0.15;
    this.currentDay = this.getTodayString();
  }

  private getTodayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private checkDayRollover(): void {
    const today = this.getTodayString();
    if (today !== this.currentDay) {
      this.currentDay = today;
      this.dailyBotCount = 0;
      this.state = "CLOSED";
      this.tripReason = "none";
      this.loggedIncidentDays.clear();
    }
  }

  canRecordBot(env?: Record<string, unknown>): boolean {
    this.checkDayRollover();

    // 1. Kill-Switch inmediato vía variable de entorno / secreto
    if (env) {
      const toggle = env.ENABLE_BOT_TELEMETRY;
      if (toggle === false || toggle === "false" || toggle === "0") {
        this.state = "OPEN";
        this.tripReason = "kill_switch";
        return false;
      }
    }

    // 2. Simulación o señal de cuota baja en la DB (para preservar escrituras para visitas humanas P0)
    if (env) {
      const lowQuotaFlag = env.SIMULATE_LOW_DB_QUOTA;
      if (
        lowQuotaFlag === true ||
        lowQuotaFlag === "true" ||
        lowQuotaFlag === "1"
      ) {
        this.state = "OPEN";
        this.tripReason = "budget_exhausted";
        return false;
      }
    }

    // 3. Cálculo de presupuesto de bots a partir del presupuesto diario de D1
    let totalBudget = this.defaultDailyWriteBudget;
    if (env?.D1_DAILY_WRITE_BUDGET) {
      const parsed = Number(env.D1_DAILY_WRITE_BUDGET);
      if (!Number.isNaN(parsed) && parsed > 0) {
        totalBudget = parsed;
      }
    }

    const maxBotBudget = Math.floor(totalBudget * this.botBudgetRatio);

    // 4. Verificación de límite de presupuesto de bots
    if (this.dailyBotCount >= maxBotBudget) {
      this.state = "OPEN";
      this.tripReason = "budget_exhausted";
      return false;
    }

    this.state = "CLOSED";
    this.tripReason = "none";
    return true;
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

  recordBot(): void {
    this.checkDayRollover();
    this.dailyBotCount++;
  }

  getStatus(): BotCircuitBreakerStatus {
    this.checkDayRollover();
    const maxBotBudget = Math.floor(
      this.defaultDailyWriteBudget * this.botBudgetRatio,
    );
    return {
      state: this.state,
      dailyBotCount: this.dailyBotCount,
      maxBotBudget,
      tripReason: this.tripReason,
    };
  }

  reset(): void {
    this.dailyBotCount = 0;
    this.state = "CLOSED";
    this.tripReason = "none";
    this.loggedIncidentDays.clear();
    this.currentDay = this.getTodayString();
  }
}
