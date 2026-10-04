import type { CacheStoragePort } from "../../ports/cache.port";

export class MemoryCacheStorageAdapter implements CacheStoragePort {
  private cache = new Map<string, Response>();

  private getKey(key: string | Request): string {
    return typeof key === "string" ? key : key.url;
  }

  async get(key: string | Request): Promise<Response | null> {
    const res = this.cache.get(this.getKey(key));
    return res ? res.clone() : null;
  }

  async put(key: string | Request, response: Response): Promise<void> {
    this.cache.set(this.getKey(key), response.clone());
  }

  async delete(key: string | Request): Promise<boolean> {
    return this.cache.delete(this.getKey(key));
  }
}
