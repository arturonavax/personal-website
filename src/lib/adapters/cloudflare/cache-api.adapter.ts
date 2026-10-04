/// <reference types="@cloudflare/workers-types" />
import type { CacheStoragePort } from "../../ports/cache.port";

export class CloudflareCacheApiAdapter implements CacheStoragePort {
  private getCache(): Cache {
    return (caches as unknown as { default: Cache }).default;
  }

  async get(key: string | Request): Promise<Response | null> {
    const cache = this.getCache();
    const req = typeof key === "string" ? new Request(key) : key;
    const match = await cache.match(req);
    return match || null;
  }

  async put(key: string | Request, response: Response): Promise<void> {
    const cache = this.getCache();
    const req = typeof key === "string" ? new Request(key) : key;
    await cache.put(req, response);
  }

  async delete(key: string | Request): Promise<boolean> {
    const cache = this.getCache();
    const req = typeof key === "string" ? new Request(key) : key;
    return await cache.delete(req);
  }
}
