import { jest } from "@jest/globals";
import { RateLimitMiddleware } from "../src/middleware/rateLimit.js";

describe("RateLimitMiddleware Suite", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should allow requests under the limit", async () => {
    const limiter = new RateLimitMiddleware(2, 60000); // 2 per minute
    const ctx: any = { aiId: "user-1", serverId: "test", toolName: "test", auth: {} };

    await expect(limiter.onRequest(ctx, { a: 1 })).resolves.toEqual({ a: 1 });
    await expect(limiter.onRequest(ctx, { a: 2 })).resolves.toEqual({ a: 2 });
  });

  it("should block requests exceeding the limit using Token Bucket", async () => {
    const limiter = new RateLimitMiddleware(2, 60000);
    const ctx: any = { aiId: "user-1", serverId: "test", toolName: "test", auth: {} };

    await limiter.onRequest(ctx, {});
    await limiter.onRequest(ctx, {});
    
    await expect(limiter.onRequest(ctx, {})).rejects.toThrow("Rate limit exceeded for AI ID 'user-1'. Please try again later.");
  });

  it("should refill tokens over time uniformly", async () => {
    const limiter = new RateLimitMiddleware(2, 60000);
    const ctx: any = { aiId: "user-1", serverId: "test", toolName: "test", auth: {} };

    await limiter.onRequest(ctx, {});
    await limiter.onRequest(ctx, {});
    
    await expect(limiter.onRequest(ctx, {})).rejects.toThrow();

    // Advance 30s. Rate is 2/60000 = 0.0000333 per ms. 30000 * (2/60000) = 1 token.
    jest.advanceTimersByTime(30000);

    // Should now be allowed precisely 1 request
    await expect(limiter.onRequest(ctx, {})).resolves.toEqual({});
    await expect(limiter.onRequest(ctx, {})).rejects.toThrow();
  });

  it("should map dynamic limits from ProxyContext.auth per AI ID properly", async () => {
    // Default 2 per minute mapping
    const limiter = new RateLimitMiddleware(2, 60000);
    
    const premiumCtx: any = { aiId: "premium-user", serverId: "test", toolName: "test", auth: { rateLimit: { rpm: 10 } } };
    const freeCtx: any = { aiId: "free-user", serverId: "test", toolName: "test", auth: { rateLimit: { rpm: 1 } } };

    // Premium gets 10 bursts
    for(let i=0; i<10; i++) {
        await expect(limiter.onRequest(premiumCtx, {})).resolves.toEqual({});
    }
    await expect(limiter.onRequest(premiumCtx, {})).rejects.toThrow();

    // Free gets 1 bounce
    await expect(limiter.onRequest(freeCtx, {})).resolves.toEqual({});
    await expect(limiter.onRequest(freeCtx, {})).rejects.toThrow();

    // Unknown gets base fallback bounds (2)
    const unknownCtx: any = { aiId: "unknown", serverId: "test", toolName: "test" };
    await limiter.onRequest(unknownCtx, {});
    await limiter.onRequest(unknownCtx, {});
    await expect(limiter.onRequest(unknownCtx, {})).rejects.toThrow();

    // Slow user gets rph boundary
    const slowCtx: any = { aiId: "slow-user", serverId: "test", toolName: "test", auth: { rateLimit: { rph: 60 } } };
    for(let i=0; i<60; i++) {
        await expect(limiter.onRequest(slowCtx, {})).resolves.toEqual({});
    }
    await expect(limiter.onRequest(slowCtx, {})).rejects.toThrow();
  });
});

import { RateLimitPlugin } from "../src/middleware/rateLimit.js";

describe("RateLimitPlugin Suite", () => {
    it("should register middleware successfully with options", () => {
        const mockProxy: any = { use: jest.fn() };
        const mockLogger: any = { info: jest.fn() };
        
        RateLimitPlugin.register({
            proxyServer: mockProxy,
            configStore: {} as any,
            logger: mockLogger,
            options: { maxRequests: 100, windowMs: 1000 }
        });

        expect(mockProxy.use).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith("RateLimitPlugin", "Built-in Rate Limiting plugin registered.");
    });

    it("should register middleware with defaults if no options are present", () => {
        const mockProxy: any = { use: jest.fn() };
        const mockLogger: any = { info: jest.fn() };

        RateLimitPlugin.register({
            proxyServer: mockProxy,
            configStore: {} as any,
            logger: mockLogger
        });

        expect(mockProxy.use).toHaveBeenCalled();
    });
});
