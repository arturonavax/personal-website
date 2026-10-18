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
    const cache =
      typeof caches !== "undefined"
        ? (caches as unknown as { default?: Cache })?.default
        : undefined;
    const cacheKey = new Request(
      `https://${this.publicDomain}/cdn-assets/${key}`,
    );
    const cachedResponse = cache ? await cache.match(cacheKey) : null;

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
          "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });

    if (cache && this.executionCtx) {
      this.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    } else if (cache) {
      await cache.put(cacheKey, response.clone());
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

  async getObject(key: string): Promise<{
    data: ReadableStream | Uint8Array;
    metadata: StorageItemMetadata;
  } | null> {
    return this.get(key);
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

  async putObject(
    key: string,
    body: ReadableStream | Uint8Array | string,
    metadata?: Partial<StorageItemMetadata> | undefined,
  ): Promise<void> {
    await this.put(key, body, metadata);
  }

  async delete(key: string | string[]): Promise<void> {
    await this.bucket.delete(key as any);
  }

  async deleteObject(key: string): Promise<void> {
    await this.delete(key);
  }

  async deleteObjects(keys: string[]): Promise<void> {
    await this.bucket.delete(keys);
  }

  async listObjects(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const listOptions: R2ListOptions = cursor
        ? { prefix, cursor }
        : { prefix };
      const listed = await this.bucket.list(listOptions);
      for (const obj of listed.objects || []) {
        keys.push(obj.key);
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return keys;
  }

  getPublicUrl(key: string): string {
    return `https://${this.publicDomain}/${key}`;
  }
}
