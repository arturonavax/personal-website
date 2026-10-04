import type { StoragePort } from "../ports/storage.port";
import type { SearchEnginePort } from "../ports/search.port";
import type { TelemetryPort } from "../ports/telemetry.port";
import type { CaptchaVerifierPort } from "../ports/captcha.port";

import { CloudflareR2StorageAdapter } from "./cloudflare/r2-storage.adapter";
import { LocalFileSystemStorageAdapter } from "./fallback/local-filesystem-storage.adapter";
import { S3CompatibleStorageAdapter } from "./fallback/s3-storage.adapter";

import {
  CloudflareVectorizeSearchAdapter,
  type CloudflareAiBinding,
  type CloudflareVectorizeBinding,
} from "./cloudflare/vectorize-search.adapter";
import { StaticMemorySearchAdapter } from "./fallback/static-memory-search.adapter";

import { D1TelemetryAdapter } from "./cloudflare/d1-telemetry.adapter";
import { SQLiteTelemetryAdapter } from "./fallback/sqlite-telemetry.adapter";

import { TurnstileCaptchaAdapter } from "./cloudflare/turnstile-captcha.adapter";
import { HoneypotCaptchaAdapter } from "./fallback/honeypot-captcha.adapter";

export interface AdapterContext {
  env?:
    | {
        APP_STORAGE_DRIVER?: string | undefined;
        APP_SEARCH_DRIVER?: string | undefined;
        APP_TELEMETRY_DRIVER?: string | undefined;
        APP_CAPTCHA_DRIVER?: string | undefined;

        // Cloudflare bindings
        STORAGE_BUCKET?: R2Bucket | undefined;
        AI?: CloudflareAiBinding | undefined;
        VECTORIZE_INDEX?: CloudflareVectorizeBinding | undefined;
        DB?: D1Database | undefined;
        TURNSTILE_SECRET_KEY?: string | undefined;

        // Fallback configs
        LOCAL_STORAGE_DIR?: string | undefined;
        PUBLIC_URL?: string | undefined;
        S3_ENDPOINT?: string | undefined;
        S3_BUCKET?: string | undefined;
      }
    | undefined;
  executionCtx?: ExecutionContext | undefined;
}

export function createStorageAdapter(
  ctx?: AdapterContext | undefined,
): StoragePort {
  const driver =
    ctx?.env?.APP_STORAGE_DRIVER ||
    (typeof process !== "undefined" && process.env?.APP_STORAGE_DRIVER) ||
    "cloudflare-r2";

  if (driver === "cloudflare-r2" && ctx?.env?.STORAGE_BUCKET) {
    const domain = ctx.env.PUBLIC_URL || "arturonavax.dev";
    return new CloudflareR2StorageAdapter(
      ctx.env.STORAGE_BUCKET,
      domain,
      ctx.executionCtx,
    );
  }

  if (driver === "s3-compatible" && ctx?.env?.S3_ENDPOINT) {
    return new S3CompatibleStorageAdapter({
      endpoint: ctx.env.S3_ENDPOINT,
      bucket: ctx.env.S3_BUCKET || "assets",
      publicUrl: ctx.env.PUBLIC_URL,
    });
  }

  const baseDir = ctx?.env?.LOCAL_STORAGE_DIR || "./dist/assets";
  const baseUrl = ctx?.env?.PUBLIC_URL || "http://localhost:4321/assets";
  return new LocalFileSystemStorageAdapter(baseDir, baseUrl);
}

export function createSearchAdapter(
  ctx?: AdapterContext | undefined,
): SearchEnginePort {
  const driver =
    ctx?.env?.APP_SEARCH_DRIVER ||
    (typeof process !== "undefined" && process.env?.APP_SEARCH_DRIVER) ||
    "cloudflare-vectorize";

  if (
    driver === "cloudflare-vectorize" &&
    ctx?.env?.AI &&
    ctx?.env?.VECTORIZE_INDEX
  ) {
    return new CloudflareVectorizeSearchAdapter(
      ctx.env.AI,
      ctx.env.VECTORIZE_INDEX,
    );
  }

  return new StaticMemorySearchAdapter();
}

export function createTelemetryAdapter(
  ctx?: AdapterContext | undefined,
): TelemetryPort {
  const driver =
    ctx?.env?.APP_TELEMETRY_DRIVER ||
    (typeof process !== "undefined" && process.env?.APP_TELEMETRY_DRIVER) ||
    "cloudflare-d1";

  if (driver === "cloudflare-d1" && ctx?.env?.DB) {
    return new D1TelemetryAdapter(ctx.env.DB);
  }

  return new SQLiteTelemetryAdapter();
}

export function createCaptchaAdapter(
  ctx?: AdapterContext | undefined,
): CaptchaVerifierPort {
  const driver =
    ctx?.env?.APP_CAPTCHA_DRIVER ||
    (typeof process !== "undefined" && process.env?.APP_CAPTCHA_DRIVER) ||
    "cloudflare-turnstile";

  if (driver === "cloudflare-turnstile" && ctx?.env?.TURNSTILE_SECRET_KEY) {
    return new TurnstileCaptchaAdapter(ctx.env.TURNSTILE_SECRET_KEY);
  }

  return new HoneypotCaptchaAdapter();
}
