// Per-isolate resolved-value cache. Expiration and capacity are enforced on access;
// insertion order evicts the oldest entry when all live slots are occupied.
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
  ) {}

  get(key: K, now = Date.now()): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, now = Date.now()): void {
    for (const [candidate, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(candidate);
    }
    this.entries.delete(key);
    if (this.entries.size >= this.capacity) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  // Security-sensitive admission must not evict an active IP's fixed window.
  admit(key: K, value: V, now = Date.now()): boolean {
    for (const [candidate, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(candidate);
    }
    if (!this.entries.has(key) && this.entries.size >= this.capacity) return false;
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    return true;
  }

  clear(): void {
    this.entries.clear();
  }
}
