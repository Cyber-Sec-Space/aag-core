import { IRateLimitStore } from "./IRateLimitStore.js";

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class MemoryRateLimitStore implements IRateLimitStore {
  private buckets = new Map<string, TokenBucket>();
  private gcInterval: ReturnType<typeof setInterval>;
  private maxBuckets: number;

  constructor(maxBuckets: number = 150000) {
    this.maxBuckets = maxBuckets;
    this.gcInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, bucket] of this.buckets.entries()) {
        if (now - bucket.lastRefill > 3600000) { // 1 hour inactivity threshold
          this.buckets.delete(id);
        }
      }
    }, 300000); // 5 mins
    this.gcInterval.unref(); // Prevent blocking process exit natively
  }

  public destroy() {
    clearInterval(this.gcInterval);
  }

  /**
   * Synchronous arithmetic on Node's main thread makes lock chains unnecessary.
   */
  async consume(id: string, maxTokens: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    let bucket = this.buckets.get(id);

    if (!bucket) {
      if (this.buckets.size >= this.maxBuckets) {
        // Emergency clear first key
        const firstKey = this.buckets.keys().next().value;
        if (firstKey) this.buckets.delete(firstKey);
      }
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
  }
}
