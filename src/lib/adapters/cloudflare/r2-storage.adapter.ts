/// <reference types="@cloudflare/workers-types" />
import type {
  StoragePort,
  StorageItemMetadata,
} from "../../ports/storage.port";

export class CloudflareR2StorageAdapter implements StoragePort {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly publicDomain: string,
    private readonly executionCtx?: ExecutionContext,
  ) {}

  async get(key: string): Promise<{
    data: ReadableStream | Uint8Array;
    metadata: StorageItemMetadata;
  } | null> {
    const cache = (caches as unknown as { default: Cache }).default;
    const cacheKey = new Request(
      `https://${this.publicDomain}/cdn-assets/${key}`,
    );
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse && cachedResponse.body) {
      return {
        data: cachedResponse.body,
        metadata: {
          contentType:
            cachedResponse.headers.get("content-type") ||
            "application/octet-stream",
          sizeBytes: Number(cachedResponse.headers.get("content-length") || 0),
          etag: cachedResponse.headers.get("etag") || undefined,
        },
      };
    }

    const object = await this.bucket.get(key);
    if (!object) return null;

    const response = new Response(object.body, {
      headers: {
        "Content-Type":
          object.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(object.size),
        ETag: object.httpEtag,
        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    });

    if (this.executionCtx) {
      this.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return {
      data: response.body!,
      metadata: {
        contentType:
          object.httpMetadata?.contentType || "application/octet-stream",
        sizeBytes: object.size,
        etag: object.httpEtag,
      },
    };
  }

  async put(
    key: string,
    data: ReadableStream | Uint8Array | string,
    metadata?: Partial<StorageItemMetadata> | undefined,
  ): Promise<void> {
    const httpMetadata: Record<string, string> = {};
    if (metadata?.contentType) httpMetadata.contentType = metadata.contentType;
    if (metadata?.cacheControl)
      httpMetadata.cacheControl = metadata.cacheControl;

    if (Object.keys(httpMetadata).length > 0) {
      await this.bucket.put(key, data, { httpMetadata });
    } else {
      await this.bucket.put(key, data);
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  getPublicUrl(key: string): string {
    return `https://${this.publicDomain}/${key}`;
  }
}
