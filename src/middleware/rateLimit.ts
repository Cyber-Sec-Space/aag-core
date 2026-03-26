import { ProxyMiddleware, ProxyContext } from "./types.js";
import { IConfigStore } from "../interfaces/IConfigStore.js";

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
  private configStore?: IConfigStore;

  /**
   * @param maxRequests Maximum number of requests allowed in the window (default fallback).
   * @param windowMs The time window in milliseconds (default fallback).
   * @param configStore Optional config store to look up per-AI limits.
   */
  constructor(maxRequests: number, windowMs: number, configStore?: IConfigStore) {
    this.maxTokens = maxRequests;
    this.refillRate = maxRequests / windowMs;
    this.configStore = configStore;
  }

  private getBucket(aiId: string): TokenBucket {
    let bucket = this.buckets.get(aiId);
    if (!bucket) {
      let limit = this.maxTokens;
      let window = 60000;
      
      // Try to resolve per-AI limit from config if available
      if (this.configStore) {
        const config = this.configStore.getConfig();
        const aiConfig = config?.aiKeys?.[aiId];
        if (aiConfig?.rateLimit?.rpm) {
          limit = aiConfig.rateLimit.rpm;
          window = 60000;
        } else if (aiConfig?.rateLimit?.rph) {
          limit = aiConfig.rateLimit.rph;
          window = 3600000;
        }
      }

      bucket = { tokens: limit, lastRefill: Date.now() };
      this.buckets.set(aiId, bucket);
    }
    return bucket;
  }

  private refill(bucket: TokenBucket, aiId: string) {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    
    let currentRate = this.refillRate;
    let currentMax = this.maxTokens;

    // Recalculate rate if config exists (for dynamic updates)
    if (this.configStore) {
        const config = this.configStore.getConfig();
        const aiConfig = config?.aiKeys?.[aiId];
        if (aiConfig?.rateLimit?.rpm) {
            currentMax = aiConfig.rateLimit.rpm;
            currentRate = aiConfig.rateLimit.rpm / 60000;
        } else if (aiConfig?.rateLimit?.rph) {
            currentMax = aiConfig.rateLimit.rph;
            currentRate = aiConfig.rateLimit.rph / 3600000;
        }
    }

    const refillAmount = elapsed * currentRate;
    
    bucket.tokens = Math.min(currentMax, bucket.tokens + refillAmount);
    bucket.lastRefill = now;
  }

  async onRequest(context: ProxyContext, args: any) {
    const bucket = this.getBucket(context.aiId);
    this.refill(bucket, context.aiId);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return args;
    } else {
      throw new Error(`Rate limit exceeded for AI ID '${context.aiId}'. Please try again later.`);
    }
  }
}
