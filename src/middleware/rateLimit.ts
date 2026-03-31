import { ProxyMiddleware, ProxyContext } from "./types.js";
import { IConfigStore } from "../interfaces/IConfigStore.js";
import { IRateLimitStore } from "../interfaces/IRateLimitStore.js";
import { RateLimitExceededError } from "../errors.js";
import { MemoryRateLimitStore } from "../interfaces/MemoryRateLimitStore.js";
import { IPlugin, PluginContext } from "../interfaces/IPlugin.js";

/**
 * A rate limiter using the Token Bucket algorithm.
 * Limits requests per AI_ID based on a global or per-user configuration.
 */
export class RateLimitMiddleware implements ProxyMiddleware {
  private maxTokens: number;
  private windowMs: number;
  private configStore?: IConfigStore;
  private rateLimitStore: IRateLimitStore;

  /**
   * @param maxRequests Maximum number of requests allowed in the window (default fallback).
   * @param windowMs The time window in milliseconds (default fallback).
   * @param configStore Optional config store to look up per-AI limits.
   * @param rateLimitStore Optional distributed rate limit store (e.g. Redis). Defaults to Memory.
   */
  constructor(maxRequests: number, windowMs: number, configStore?: IConfigStore, rateLimitStore?: IRateLimitStore) {
    this.maxTokens = maxRequests;
    this.windowMs = windowMs;
    this.configStore = configStore;
    this.rateLimitStore = rateLimitStore || new MemoryRateLimitStore();
  }

  async onRequest(context: ProxyContext, args: any) {
    let currentMax = this.maxTokens;
    let currentWindowMs = this.windowMs;

    // Recalculate rate if config exists explicitly for this identity
    const pluginCfg = context.auth?.pluginConfig?.["aag-core-rate-limit"];
    if (pluginCfg) {
      if (pluginCfg.maxRequests !== undefined) currentMax = pluginCfg.maxRequests;
      if (pluginCfg.windowMs !== undefined) currentWindowMs = pluginCfg.windowMs;
    } else if (context.auth?.rateLimit?.rpm !== undefined) {
      currentMax = context.auth.rateLimit.rpm;
      currentWindowMs = 60000;
    } else if (context.auth?.rateLimit?.rph !== undefined) {
      currentMax = context.auth.rateLimit.rph;
      currentWindowMs = 3600000;
    }

    const permitted = await this.rateLimitStore.consume(context.aiId, currentMax, currentWindowMs);
    
    if (permitted) {
      return args;
    } else {
      throw new RateLimitExceededError(`Rate limit exceeded for AI ID '${context.aiId}'. Please try again later.`);
    }
  }
}

export const RateLimitPlugin: IPlugin = {
    name: "aag-core-rate-limit",
    version: "1.0.0",
    register: (context: PluginContext) => {
        const { maxRequests = 600, windowMs = 60000, rateLimitStore } = context.options || {};
        const middleware = new RateLimitMiddleware(
            maxRequests,
            windowMs,
            context.configStore,
            rateLimitStore
        );
        context.proxyServer.use(middleware);
        context.logger.info("RateLimitPlugin", "Built-in Rate Limiting plugin registered.");
    }
};
