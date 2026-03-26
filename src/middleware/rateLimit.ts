import { ProxyMiddleware, ProxyContext } from "./types.js";
import { IConfigStore } from "../interfaces/IConfigStore.js";
import { IStateStore } from "../interfaces/IStateStore.js";
import { MemoryStateStore } from "../interfaces/MemoryStateStore.js";

export interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * A basic in-memory rate limiter using the Token Bucket algorithm.
 * Limits requests per AI_ID based on a global or per-user configuration.
 */
export class RateLimitMiddleware implements ProxyMiddleware {
  private maxTokens: number;
  private refillRate: number; // tokens per millisecond
  private configStore?: IConfigStore;
  private stateStore: IStateStore;

  /**
   * @param maxRequests Maximum number of requests allowed in the window (default fallback).
   * @param windowMs The time window in milliseconds (default fallback).
   * @param configStore Optional config store to look up per-AI limits.
   * @param stateStore Optional clustered state store (e.g. Redis). Defaults to Memory.
   */
  constructor(maxRequests: number, windowMs: number, configStore?: IConfigStore, stateStore?: IStateStore) {
    this.maxTokens = maxRequests;
    this.refillRate = maxRequests / windowMs;
    this.configStore = configStore;
    this.stateStore = stateStore || new MemoryStateStore();
  }

  private async getBucket(aiId: string): Promise<TokenBucket> {
    let bucket = await this.stateStore.get(`ratelimit:${aiId}`);
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
      await this.stateStore.set(`ratelimit:${aiId}`, bucket);
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
    const bucket = await this.getBucket(context.aiId);
    this.refill(bucket, context.aiId);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      await this.stateStore.set(`ratelimit:${context.aiId}`, bucket);
      return args;
    } else {
      await this.stateStore.set(`ratelimit:${context.aiId}`, bucket);
      throw new Error(`Rate limit exceeded for AI ID '${context.aiId}'. Please try again later.`);
    }
  }
}
