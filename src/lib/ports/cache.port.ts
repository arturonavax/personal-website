export interface CacheStoragePort {
  get(key: string | Request): Promise<Response | null>;
  put(key: string | Request, response: Response): Promise<void>;
  delete(key: string | Request): Promise<boolean>;
}
