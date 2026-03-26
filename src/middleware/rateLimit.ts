import { ProxyMiddleware, ProxyContext } from "./types.js";

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * A basic in-memory rate limiter using the Token Bucket algorithm.
 * Limits requests per AI_ID based on a global or per-user configuration.
 */
export class RateLimitMiddleware implements ProxyMiddleware {
  private buckets: Map<string, TokenBucket> = new Map();
  private maxTokens: number;
  private refillRate: number; // tokens per millisecond

  /**
   * @param maxRequests Maximum number of requests allowed in the window.
   * @param windowMs The time window in milliseconds (e.g., 60000 for 1 minute).
   */
  constructor(maxRequests: number, windowMs: number) {
    this.maxTokens = maxRequests;
    this.refillRate = maxRequests / windowMs;
  }

  private getBucket(aiId: string): TokenBucket {
    let bucket = this.buckets.get(aiId);
    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: Date.now() };
      this.buckets.set(aiId, bucket);
    }
    return bucket;
  }

  private refill(bucket: TokenBucket) {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const refillAmount = elapsed * this.refillRate;
    
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + refillAmount);
    bucket.lastRefill = now;
  }

  async onRequest(context: ProxyContext, args: any) {
    const bucket = this.getBucket(context.aiId);
    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return args;
    } else {
      throw new Error(`Rate limit exceeded for AI ID '${context.aiId}'. Please try again later.`);
    }
  }
}
