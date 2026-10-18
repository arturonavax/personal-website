import type {
  BotCircuitBreakerPort,
  BotCircuitBreakerStatus,
  CircuitBreakerTripReason,
} from "../../ports/telemetry.port";
import {
  edgeQuotaTracker,
  QuotaDegradationTier,
  resolveQuotaConfig,
} from "./circuit-breaker.adapter";

export const VERIFIED_SEO_OR_AI_BOT_REGEX =
  /\b(?:googlebot|bingbot|bingpreview|duckduckbot|yandexbot|baiduspider|applebot|gptbot|chatgpt-user|claudebot|claude-web|anthropic-ai|perplexitybot|perplexity|cohere-ai|google-extended)\b/i;

export function isVerifiedSeoOrAiBot(
  userAgent = "",
  classification = "",
): boolean {
  if (
    classification === "verified_bot" ||
    classification === "search_crawler" ||
    classification === "ai_scraper"
  ) {
    return true;
  }
  return VERIFIED_SEO_OR_AI_BOT_REGEX.test(userAgent);
}

export interface BotCircuitBreakerConfig {
  readonly defaultDailyWriteBudget?: number;
  readonly botBudgetRatio?: number; // Fraction of daily budget allocated to bots (e.g., 0.15 = 15%)
}

export class BotQuotaCircuitBreaker implements BotCircuitBreakerPort {
  private dailyBotCount = 0;
  private currentDay: string = "";
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private tripReason: CircuitBreakerTripReason = "none";
  private loggedIncidentDays = new Set<string>();

  private readonly defaultDailyWriteBudget: number;
  private readonly botBudgetRatio: number;

  constructor(config?: BotCircuitBreakerConfig) {
    this.defaultDailyWriteBudget = config?.defaultDailyWriteBudget ?? 100_000;
    this.botBudgetRatio = config?.botBudgetRatio ?? 0.15;
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

  private computeMaxBotBudget(env?: Record<string, unknown>): number {
    if (!env) {
      return Math.floor(this.defaultDailyWriteBudget * this.botBudgetRatio);
    }
    const resolved = resolveQuotaConfig(env);
    const hasEnvBudget =
      env.D1_DAILY_WRITE_BUDGET !== undefined ||
      env.CLOUDFLARE_PLAN_TIER !== undefined;
    const totalBudget = hasEnvBudget
      ? resolved.dailyWriteBudget
      : this.defaultDailyWriteBudget;
    const ratio =
      env.D1_BOT_BUDGET_RATIO !== undefined
        ? resolved.botBudgetRatio
        : this.botBudgetRatio;
    if (!Number.isFinite(totalBudget)) {
      return Number.MAX_SAFE_INTEGER;
    }
    return Math.floor(totalBudget * ratio);
  }

  canRecordBot(
    env?: Record<string, unknown>,
    userAgentOrVerified: string | boolean = true,
    classification = "",
  ): boolean {
    this.checkDayRollover();

    const isVerifiedCrawler =
      typeof userAgentOrVerified === "boolean"
        ? userAgentOrVerified
        : isVerifiedSeoOrAiBot(userAgentOrVerified, classification);

    // 1. Immediate kill-switch via environment variable / secret
    if (env) {
      const toggle = env.ENABLE_BOT_TELEMETRY;
      if (toggle === false || toggle === "false" || toggle === "0") {
        this.state = "OPEN";
        this.tripReason = "kill_switch";
        return false;
      }
    }

    // 2. Simulated or signaled low DB quota (preserves write quota for P0 human visits)
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

    // 2b. Progressive Degradation Tier checks:
    // Tier >= CRITICAL_SURVIVAL (85%): freeze all bot D1 writes
    // Tier >= CONSERVATIVE (50%): drop generic bots/scanners, allow only verified SEO/AI crawlers in rollups
    const currentTier = edgeQuotaTracker.getTier();
    if (currentTier >= QuotaDegradationTier.CRITICAL_SURVIVAL) {
      this.state = "OPEN";
      this.tripReason = "budget_exhausted";
      return false;
    }
    if (
      currentTier >= QuotaDegradationTier.CONSERVATIVE &&
      !isVerifiedCrawler
    ) {
      this.state = "OPEN";
      this.tripReason = "budget_exhausted";
      return false;
    }

    // 3. Compute bot budget from daily D1 write budget & strategy config
    const maxBotBudget = this.computeMaxBotBudget(env);

    // 4. Bot budget cap check
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

  getStatus(env?: Record<string, unknown>): BotCircuitBreakerStatus {
    this.checkDayRollover();
    const maxBotBudget = this.computeMaxBotBudget(env);
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
