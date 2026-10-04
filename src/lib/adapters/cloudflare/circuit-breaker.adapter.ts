import type { FailOpenCircuitBreakerPort } from "../../ports/edge-delivery.port";

export class FailOpenCircuitBreaker implements FailOpenCircuitBreakerPort {
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallbackValue: T,
    timeoutMs = 350,
    operationName = "circuit-breaker-operation",
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `[CircuitBreaker] Operation '${operationName}' exceeded timeout of ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });

    try {
      const opPromise = operation();
      // Shield against unhandled floating rejection if timeout fires first
      opPromise.catch(() => {});
      return await Promise.race([opPromise, timeoutPromise]);
    } catch (err) {
      console.warn(
        `[CircuitBreaker: Fail-Open] Fallback triggered for '${operationName}':`,
        err instanceof Error ? err.message : err,
      );
      return fallbackValue;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
