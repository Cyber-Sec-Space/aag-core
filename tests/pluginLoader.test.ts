import { PluginLoader } from "../src/pluginLoader.js";
import { ProxyServer } from "../src/proxy.js";
import { IConfigStore } from "../src/interfaces/IConfigStore.js";
import { IAuditLogger } from "../src/interfaces/IAuditLogger.js";
import { jest } from "@jest/globals";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("PluginLoader", () => {
    let mockLogger: jest.Mocked<IAuditLogger>;
    let mockConfigStore: jest.Mocked<IConfigStore>;
    let mockProxyServer: jest.Mocked<ProxyServer>;

    beforeEach(() => {
        mockLogger = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            audit: jest.fn()
        } as any;

        mockConfigStore = {
            getConfig: jest.fn(),
            saveConfig: jest.fn(),
            on: jest.fn()
        } as any;

        mockProxyServer = {
            use: jest.fn()
        } as any;
    });

    it("should load a valid plugin from a local file", async () => {
        const loader = new PluginLoader(mockLogger);
        
        const fixturePath = path.resolve(__dirname, "dummyPlugin.cjs");
        fs.writeFileSync(fixturePath, `
            module.exports = {
                name: "test-plugin",
                version: "1.0.0",
                register: (context) => {
                    if (context.options) {
                        context.options.wasCalled = true;
                    }
                }
            };
        `);

        const pluginOptions = { wasCalled: false };
        await loader.loadPlugins(mockProxyServer, mockConfigStore, [
            { name: fixturePath, options: pluginOptions }
        ]);

        expect(pluginOptions.wasCalled).toBe(true);
        expect(mockLogger.info).toHaveBeenCalledWith(
            "PluginLoader",
            "Successfully registered plugin: test-plugin (v1.0.0)"
        );

        fs.unlinkSync(fixturePath);
    });

    it("should throw an error when loading an invalid plugin", async () => {
        const loader = new PluginLoader(mockLogger);
        
        const fixturePath = path.resolve(__dirname, "invalidPlugin.cjs");
        fs.writeFileSync(fixturePath, `
            module.exports = {
                name: "invalid-plugin",
                // missing register function
            };
        `);

        await expect(
            loader.loadPlugins(mockProxyServer, mockConfigStore, [
                { name: fixturePath, options: {} }
            ])
        ).rejects.toThrow("Module");

        fs.unlinkSync(fixturePath);
    });

    it("should handle empty or null plugin config gracefully", async () => {
        const loader = new PluginLoader(mockLogger);
        await loader.loadPlugins(mockProxyServer, mockConfigStore, []);
        expect(mockLogger.debug).toHaveBeenCalledWith("PluginLoader", "No plugins configured to load.");
    });
    
    it("should resolve and load a local plugin using a relative path", async () => {
        const loader = new PluginLoader(mockLogger);
        
        const fixturePath = path.resolve(__dirname, "localRelativePlugin.cjs");
        fs.writeFileSync(fixturePath, `
            module.exports = {
                name: "local-relative-plugin",
                version: "1.0.0",
                register: (context) => {
                    if (context.options) {
                        context.options.wasCalled = true;
                    }
                }
            };
        `);

        const relativePath = "./tests/localRelativePlugin.cjs";
        const pluginOptions = { wasCalled: false };
        
        await loader.loadPlugins(mockProxyServer, mockConfigStore, [
            { name: relativePath, options: pluginOptions }
        ]);

        expect(pluginOptions.wasCalled).toBe(true);
        expect(mockLogger.info).toHaveBeenCalledWith(
            "PluginLoader",
            "Successfully registered plugin: local-relative-plugin (v1.0.0)"
        );

        fs.unlinkSync(fixturePath);
    });
});

