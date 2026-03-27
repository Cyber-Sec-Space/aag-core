import { jest } from "@jest/globals";
import { DataMaskingMiddleware } from "../src/middleware/dataMasking.js";

describe("DataMaskingMiddleware Suite", () => {
    it("should pass through unmodified if result structure is missing or a non-array", async () => {
        const masker = new DataMaskingMiddleware([/secret/gi]);
        const ctx: any = { aiId: "test", serverId: "test", toolName: "test" };

        expect(await masker.onResponse(ctx, null)).toBe(null);
        expect(await masker.onResponse(ctx, undefined)).toBe(undefined);
        expect(await masker.onResponse(ctx, {})).toEqual({});
        expect(await masker.onResponse(ctx, { content: "string not array" })).toEqual({ content: "string not array" });
    });

    it("should gracefully mask sensitive data using regex globally across block arrays", async () => {
        const masker = new DataMaskingMiddleware([/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, "SECRET_TOKEN"], "[REDACTED]");
        const ctx: any = { aiId: "test", serverId: "test", toolName: "test" };

        const result = {
            content: [
                { type: "text", text: "Contact admin@corp.com or support@corp.com." },
                { type: "image", data: "base64/binary..." },
                { type: "text", text: "Your access key is SECRET_TOKEN. Be careful." },
                { type: "text" } // Edge case handling gracefully for missing text strings
            ]
        };

        const processed = await masker.onResponse(ctx, result) as any;

        expect(processed.content[0].text).toBe("Contact [REDACTED] or [REDACTED].");
        expect(processed.content[1].data).toBe("base64/binary..."); // Should NOT touch other properties or metadata types
        expect(processed.content[1].text).toBeUndefined(); // Verifies isolation
        expect(processed.content[2].text).toBe("Your access key is [REDACTED]. Be careful.");
        expect(processed.content[3]).toEqual({ type: "text" });
    });
});

import { DataMaskingPlugin } from "../src/middleware/dataMasking.js";

describe("DataMaskingPlugin Suite", () => {
    it("should register middleware when rules are provided", () => {
        const mockProxy: any = { use: jest.fn() };
        const mockLogger: any = { info: jest.fn(), debug: jest.fn() };
        
        DataMaskingPlugin.register({
            proxyServer: mockProxy,
            configStore: {} as any,
            logger: mockLogger,
            options: { rules: [/secret/gi] }
        });

        expect(mockProxy.use).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith("DataMaskingPlugin", "Built-in Data Masking plugin registered.");
    });

    it("should skip registering when rules are empty", () => {
        const mockProxy: any = { use: jest.fn() };
        const mockLogger: any = { debug: jest.fn() };

        DataMaskingPlugin.register({
            proxyServer: mockProxy,
            configStore: {} as any,
            logger: mockLogger,
            options: { rules: [] }
        });

        expect(mockProxy.use).not.toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith("DataMaskingPlugin", "DataMaskingPlugin loaded but no rules provided. Middleware will not be active.");
    });
});
