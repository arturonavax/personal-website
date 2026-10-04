import type {
  StoragePort,
  StorageItemMetadata,
} from "../../ports/storage.port";

export interface S3StorageConfig {
  endpoint: string;
  bucket: string;
  publicUrl?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
}

export class S3CompatibleStorageAdapter implements StoragePort {
  constructor(private readonly config: S3StorageConfig) {}

  async get(key: string): Promise<{
    data: ReadableStream | Uint8Array;
    metadata: StorageItemMetadata;
  } | null> {
    const url = `${this.config.endpoint.replace(/\/+$/, "")}/${this.config.bucket}/${key}`;
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) return null;
      return {
        data: res.body,
        metadata: {
          contentType:
            res.headers.get("content-type") || "application/octet-stream",
          sizeBytes: Number(res.headers.get("content-length") || 0),
          etag: res.headers.get("etag") || undefined,
        },
      };
    } catch {
      return null;
    }
  }

  async put(
    key: string,
    data: ReadableStream | Uint8Array | string,
    metadata?: Partial<StorageItemMetadata> | undefined,
  ): Promise<void> {
    const url = `${this.config.endpoint.replace(/\/+$/, "")}/${this.config.bucket}/${key}`;
    const headers = new Headers();
    if (metadata?.contentType)
      headers.set("Content-Type", metadata.contentType);
    if (metadata?.cacheControl)
      headers.set("Cache-Control", metadata.cacheControl);

    const body =
      typeof data === "string" || data instanceof Uint8Array ? data : data;
    await fetch(url, {
      method: "PUT",
      headers,
      body: body as BodyInit,
    });
  }

  async delete(key: string): Promise<void> {
    const url = `${this.config.endpoint.replace(/\/+$/, "")}/${this.config.bucket}/${key}`;
    await fetch(url, { method: "DELETE" }).catch(() => {});
  }

  getPublicUrl(key: string): string {
    if (this.config.publicUrl) {
      return `${this.config.publicUrl.replace(/\/+$/, "")}/${key}`;
    }
    return `${this.config.endpoint.replace(/\/+$/, "")}/${this.config.bucket}/${key}`;
  }
}
