import { IRateLimitStore } from "./IRateLimitStore.js";

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class MemoryRateLimitStore implements IRateLimitStore {
  private buckets = new Map<string, TokenBucket>();

  async consume(id: string, maxTokens: number, windowMs: number): Promise<boolean> {
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
  }
}
