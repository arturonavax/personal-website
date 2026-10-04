import type {
  StoragePort,
  StorageItemMetadata,
} from "../../ports/storage.port";
import fs from "node:fs/promises";
import path from "node:path";

export class LocalFileSystemStorageAdapter implements StoragePort {
  constructor(
    private readonly baseDirectory: string,
    private readonly baseUrl: string,
  ) {}

  async get(key: string): Promise<{
    data: ReadableStream | Uint8Array;
    metadata: StorageItemMetadata;
  } | null> {
    const fullPath = path.join(this.baseDirectory, key);
    try {
      const buffer = await fs.readFile(fullPath);
      const stat = await fs.stat(fullPath);
      return {
        data: buffer,
        metadata: {
          contentType: "application/octet-stream",
          sizeBytes: stat.size,
          lastModified: stat.mtime,
        },
      };
    } catch {
      return null;
    }
  }

  async put(
    key: string,
    data: ReadableStream | Uint8Array | string,
  ): Promise<void> {
    const fullPath = path.join(this.baseDirectory, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    if (typeof data === "string" || data instanceof Uint8Array) {
      await fs.writeFile(fullPath, data);
    } else {
      const arrayBuffer = await new Response(data).arrayBuffer();
      await fs.writeFile(fullPath, Buffer.from(arrayBuffer));
    }
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(path.join(this.baseDirectory, key)).catch(() => {});
  }

  getPublicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}
