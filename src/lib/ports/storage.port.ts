export interface StorageItemMetadata {
  contentType: string;
  sizeBytes: number;
  etag?: string | undefined;
  lastModified?: Date | undefined;
  cacheControl?: string | undefined;
}

export interface StoragePort {
  get(key: string): Promise<{
    data: ReadableStream | Uint8Array;
    metadata: StorageItemMetadata;
  } | null>;
  put(
    key: string,
    data: ReadableStream | Uint8Array | string,
    metadata?: Partial<StorageItemMetadata> | undefined,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string;
}
