/**
 * SPEC-005: Edge Content Delivery & Zero Latency Infrastructure Isolation Ports
 * Hexagonal architecture ports for Cloudflare Edge routing, circuit breaker, and fail-open resilience.
 */

export type RequestClassification =
  | "STATIC_ASSET"
  | "PUBLIC_DOCUMENT"
  | "ADMIN_SURFACE"
  | "SUBDOMAIN_ALIAS"
  | "DYNAMIC_API"
  | "TELEMETRY_INGESTION"
  | "PASSTHROUGH";

export interface CanonicalRedirectResult {
  shouldRedirect: boolean;
  targetUrl?: string | undefined;
  statusCode: 308 | 301;
}

export interface EdgeRoutingPolicyPort {
  /**
   * Classify incoming request in < 0.2ms CPU compute time.
   */
  classify(url: URL, request: Request): RequestClassification;

  /**
   * Resolve whether the request requires an immediate edge canonical redirect.
   */
  resolveCanonicalRedirect(url: URL): CanonicalRedirectResult;

  /**
   * Determine if classification is eligible for Fast-Path execution without blocking I/O.
   */
  isFastPathCandidate(classification: RequestClassification): boolean;
}

export interface FailOpenCircuitBreakerPort {
  /**
   * Execute an infrastructure operation (D1, Vectorize, Workers AI, Turnstile) with strict timeout.
   * If the operation exceeds the timeout or throws, returns fallbackValue without failing the request.
   */
  executeWithFallback<T>(
    operation: () => Promise<T>,
    fallbackValue: T,
    timeoutMs: number,
    operationName: string,
  ): Promise<T>;
}
