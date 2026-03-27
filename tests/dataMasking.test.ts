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

    it("should dynamically apply tenant-specific overrides from IConfigStore", async () => {
        const mockConfigStore = {
            getConfig: () => ({
                aiKeys: {
                    "tenant-A": {
                        pluginConfig: {
                            "aag-core-data-masking": {
                                rules: ["TOP_SECRET"],
                                maskString: "[XXX]"
                            }
                        }
                    },
                    "tenant-B": {
                        pluginConfig: {
                            "aag-core-data-masking": {
                                // Missing rules array, falls back to global
                                maskString: "[YYY]"
                            }
                        }
                    }
                }
            })
        } as any;
        
        const masker = new DataMaskingMiddleware([/global_secret/gi], "***", mockConfigStore);
        
        // Tenant A: Should use tenant rules and tenant mask
        const ctxA: any = { aiId: "tenant-A", serverId: "test", toolName: "test" };
        const resultA = { content: [{ type: "text", text: "Global: global_secret. Tenant: TOP_SECRET" }] };
        const processedA = await masker.onResponse(ctxA, resultA) as any;
        expect(processedA.content[0].text).toBe("Global: global_secret. Tenant: [XXX]");
        
        // Tenant B: Should use global rules and tenant mask
        const ctxB: any = { aiId: "tenant-B", serverId: "test", toolName: "test" };
        const resultB = { content: [{ type: "text", text: "Global: global_secret. Tenant: TOP_SECRET" }] };
        const processedB = await masker.onResponse(ctxB, resultB) as any;
        expect(processedB.content[0].text).toBe("Global: [YYY]. Tenant: TOP_SECRET");
    });

    it("should handle undefined configs and fallback securely without crashing", async () => {
        // Test 1: IConfigStore returns completely undefined config
        const mockEmptyStore = { getConfig: () => undefined } as any;
        const masker1 = new DataMaskingMiddleware([/secret/gi], "***", mockEmptyStore);
        const ctx1: any = { aiId: "tenant-X", serverId: "test", toolName: "test" };
        const result1 = { content: [{ type: "text", text: "This is a secret" }] };
        const processed1 = await masker1.onResponse(ctx1, result1) as any;
        expect(processed1.content[0].text).toBe("This is a ***");

        // Test 2: pluginCfg exists but rules/maskString are invalid types (not array / not string)
        const mockInvalidStore = {
            getConfig: () => ({
                aiKeys: {
                    "tenant-Y": {
                        pluginConfig: {
                            "aag-core-data-masking": { rules: "not-an-array", maskString: 12345 }
                        }
                    }
                }
            })
        } as any;
        const masker2 = new DataMaskingMiddleware([/secret/gi], "***", mockInvalidStore);
        const processed2 = await masker2.onResponse({ aiId: "tenant-Y" } as any, result1) as any;
        expect(processed2.content[0].text).toBe("This is a ***"); // Fallbacks to global
    });

    it("should bypass and return early if activeRules array is empty natively resolving multi-tenant logic", async () => {
        const mockStore = {
            getConfig: () => ({
                aiKeys: {
                    "tenant-Z": {
                        pluginConfig: {
                            "aag-core-data-masking": { rules: [] }
                        }
                    }
                }
            })
        } as any;
        // Global rules are empty too.
        const masker = new DataMaskingMiddleware([], "***", mockStore);
        const result = { content: [{ type: "text", text: "Some normal text" }] };
        const processed = await masker.onResponse({ aiId: "tenant-Z" } as any, result) as any;
        expect(processed.content[0].text).toBe("Some normal text"); // Early return at line 41
    });

    it("should process tenant rules containing explicit RegExp instances natively", async () => {
        const mockStore = {
            getConfig: () => ({
                aiKeys: {
                    "tenant-R": {
                        pluginConfig: {
                            "aag-core-data-masking": { rules: ["string_secret", /regex_secret/gi] }
                        }
                    }
                }
            })
        } as any;
        
        const masker = new DataMaskingMiddleware([], "***", mockStore);
        const result = { content: [{ type: "text", text: "I have a string_secret and a ReGeX_SeCrEt." }] };
        const processed = await masker.onResponse({ aiId: "tenant-R" } as any, result) as any;
        
        expect(processed.content[0].text).toBe("I have a *** and a ***.");
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

    it("should skip registering when rules are empty and no configStore is provided", () => {
        const mockProxy: any = { use: jest.fn() };
        const mockLogger: any = { debug: jest.fn() };

        DataMaskingPlugin.register({
            proxyServer: mockProxy,
            configStore: undefined as any,
            logger: mockLogger,
            options: { rules: [] }
        });

        expect(mockProxy.use).not.toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith("DataMaskingPlugin", "DataMaskingPlugin loaded but no rules provided. Middleware will not be active.");
    });

    it("should use default mask string and handle undefined options natively without configStore", () => {
        const mockProxy: any = { use: jest.fn() };
        const mockLogger: any = { debug: jest.fn() };

        DataMaskingPlugin.register({
            proxyServer: mockProxy,
            configStore: undefined as any,
            logger: mockLogger,
            options: undefined
        } as any);

        expect(mockLogger.debug).toHaveBeenCalledWith("DataMaskingPlugin", "DataMaskingPlugin loaded but no rules provided. Middleware will not be active.");
    });
    it("should register middleware when rules are empty but configStore is provided for tenant overrides", () => {
        const mockProxy: any = { use: jest.fn() };
        const mockLogger: any = { info: jest.fn() };

        DataMaskingPlugin.register({
            proxyServer: mockProxy,
            configStore: {} as any,
            logger: mockLogger,
            options: { rules: [] }
        });

        expect(mockProxy.use).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith("DataMaskingPlugin", "Built-in Data Masking plugin registered.");
    });
});
