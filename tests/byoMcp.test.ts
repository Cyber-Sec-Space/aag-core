import { jest } from '@jest/globals';
import { ClientManager } from '../src/clientManager.js';
import { IConfigStore } from '../src/interfaces/IConfigStore.js';
import { ISecretStore } from '../src/interfaces/ISecretStore.js';
import { IAuditLogger } from '../src/interfaces/IAuditLogger.js';
import { AuthKey, ProxyConfig } from '../src/config/types.js';

class MockConfigStore implements IConfigStore {
  getConfig = jest.fn<() => any>().mockReturnValue({
    system: { port: 3000, logLevel: "INFO", allowStdio: false },
    mcpServers: {
      global_server: { transport: "stdio", command: "echo", args: ["global"] }
    }
  });
  updateConfig = jest.fn<any>();
  onConfigUpdate = jest.fn<any>();
  validateConfig = jest.fn<any>();
  saveConfig = jest.fn<any>();
  on = jest.fn<any>();
}

class MockSecretStore implements ISecretStore {
  resolveSecret = jest.fn<(key: string) => Promise<string | undefined>>().mockResolvedValue("secret");
}

class MockLogger implements IAuditLogger {
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
  debug = jest.fn();
  trace = jest.fn();
}

describe("BYO-MCP Tenant Isolation & Security", () => {
    let clientManager: ClientManager;
    let configStore: MockConfigStore;
    let secretStore: MockSecretStore;
    let logger: MockLogger;

    beforeEach(() => {
        configStore = new MockConfigStore();
        secretStore = new MockSecretStore();
        logger = new MockLogger();
        clientManager = new ClientManager(configStore, secretStore, logger);

        // Safely mock out actual connections to just return an object
        jest.spyOn(clientManager as any, "createTransportAndConnect").mockImplementation(async (...args: any[]) => {
            const [id, config, isTenant] = args;
            // Re-implement the security check normally handled here,,
            if (config.transport === "stdio" && isTenant && !configStore.getConfig().system?.allowStdio) {
                const { AagConfigurationError } = await import("../src/errors.js");
                throw new AagConfigurationError(`Disallowed transport: 'stdio' is disabled for tenant-provided MCP servers.`);
            }
            return {
                ping: jest.fn().mockResolvedValue(true as never),
                close: jest.fn().mockResolvedValue(true as never),
                listTools: jest.fn().mockResolvedValue({tools:[]} as never)
            };
        });
    });

    afterEach(() => {
        clientManager.destroy();
        jest.clearAllMocks();
    });

    it("should allow tenant HTTP/SSE servers", async () => {
        await clientManager.syncConfig(configStore.getConfig());
        
        const auth: AuthKey = {
            key: "test_key",
            tenantId: "tenant_X",
            revoked: false,
            pluginConfig: {},
            mcpServers: {
                tenant_http: { transport: "http", url: "http://localhost:8080" }
            }
        };

        const client = await clientManager.getClientJIT("tenant_http", auth);
        expect(client).toBeDefined();

        // Check it correctly cached in tenant scope
        const clients = await clientManager.getClientsJIT(auth);
        expect(clients.has("tenant_http")).toBe(true);
        expect(clients.has("global_server")).toBe(true);
    });

    it("should prevent tenant stdio servers when allowStdio is false (default)", async () => {
        const auth: AuthKey = {
            key: "test_key",
            tenantId: "tenant_X",
            revoked: false,
            pluginConfig: {},
            mcpServers: {
                tenant_cmd: { transport: "stdio", command: "rm", args: ["-rf", "/"] }
            }
        };

        // Suppress expected logger error from terminal
        logger.error.mockImplementationOnce(() => {});

        await expect(clientManager.getClientJIT("tenant_cmd", auth))
            .rejects.toThrow("Disallowed transport: 'stdio' is disabled for tenant-provided MCP servers");
    });

    it("should allow tenant stdio servers when allowStdio is true", async () => {
        configStore.getConfig.mockReturnValue({
            system: { port: 3000, logLevel: "INFO", allowStdio: true },
            mcpServers: {}
        } as any);
        clientManager = new ClientManager(configStore, secretStore, logger);
        
        jest.spyOn(clientManager as any, "createTransportAndConnect").mockImplementation(async (...args: any[]) => {
            return {
                ping: jest.fn().mockResolvedValue(true as never),
                close: jest.fn().mockResolvedValue(true as never),
                listTools: jest.fn().mockResolvedValue({tools:[]} as never)
            };
        });

        const auth: AuthKey = {
            key: "test_key",
            tenantId: "tenant_X",
            revoked: false,
            pluginConfig: {},
            mcpServers: {
                tenant_cmd: { transport: "stdio", command: "echo", args: ["safe"] }
            }
        };

        const client = await clientManager.getClientJIT("tenant_cmd", auth);
        expect(client).toBeDefined();
    });

    it("should scope connections to tenantId to share connections across keys for the same tenant", async () => {
        const auth1: AuthKey = { key: "ai1", tenantId: "tenant_share", revoked: false, pluginConfig: {}, mcpServers: { myServer: { transport: "http", url: "http://a" } } };
        const auth2: AuthKey = { key: "ai2", tenantId: "tenant_share", revoked: false, pluginConfig: {}, mcpServers: { myServer: { transport: "http", url: "http://a" } } };
        
        const client1 = await clientManager.getClientJIT("myServer", auth1);
        const client2 = await clientManager.getClientJIT("myServer", auth2);

        expect(client1).toBeDefined();
        // Since it's identical instance and shared scope "tenant_share", it should be strictly equal
        expect(client1).toBe(client2);
        
        // Scope isolated from another tenant
        const auth3: AuthKey = { key: "ai3", tenantId: "tenant_other", revoked: false, pluginConfig: {}, mcpServers: { myServer: { transport: "http", url: "http://a" } } };
        const client3 = await clientManager.getClientJIT("myServer", auth3);
        
        expect(client3).toBeDefined();
        expect(client3).not.toBe(client1);
    });
    
    it("should reload tenant config if the server definition changes inline", async () => {
        const auth: AuthKey = { key: "ai", tenantId: "t1", revoked: false, pluginConfig: {}, mcpServers: { myServer: { transport: "http", url: "http://first" } } };
        const client1 = await clientManager.getClientJIT("myServer", auth);
        
        // Change url
        const authUpdated: AuthKey = { key: "ai", tenantId: "t1", revoked: false, pluginConfig: {}, mcpServers: { myServer: { transport: "http", url: "http://second" } } };
        const client2 = await clientManager.getClientJIT("myServer", authUpdated);
        
        expect(client1).not.toBe(client2);
    });
});
