import { IRateLimitStore } from "./IRateLimitStore.js";

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class MemoryRateLimitStore implements IRateLimitStore {
  private buckets = new Map<string, TokenBucket>();
  private locks = new Map<string, Promise<void>>();

  async consume(id: string, maxTokens: number, windowMs: number): Promise<boolean> {
    const prevLock = this.locks.get(id) || Promise.resolve();
    let release!: () => void;
    const nextLock = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(id, prevLock.then(() => nextLock));

    await prevLock;
    try {
      const now = Date.now();
      let bucket = this.buckets.get(id);

      if (!bucket) {
        bucket = { tokens: maxTokens, lastRefill: now };
        this.buckets.set(id, bucket);
      }

      const elapsed = now - bucket.lastRefill;
      const refillRate = maxTokens / windowMs;
      const refillAmount = elapsed * refillRate;

      bucket.tokens = Math.min(maxTokens, bucket.tokens + refillAmount);
      bucket.lastRefill = now;

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
      }

      return false;
    } finally {
      release();
    }
  }
}
