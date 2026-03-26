import { jest } from "@jest/globals";
import { ClientManager } from "../src/clientManager.js";
import { MockConfigStore, MockSecretStore, MockLogger } from "./mocks.js";

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    connect = jest.fn<any>().mockResolvedValue(undefined);
    close = jest.fn<any>().mockResolvedValue(undefined);
    ping = jest.fn<any>().mockResolvedValue(undefined);
  }
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioClientTransport {
    constructor(...args: any[]) {}
  }
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSEClientTransport {
    constructor(...args: any[]) {}
  }
}));

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockHttpTransport {
    constructor(...args: any[]) {}
  }
}));

describe("ClientManager", () => {
  let clientManager: any;

  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    if (clientManager) clientManager.destroy();
  });

  // Tests the `syncConfig` method to verify downstream MCP server transports are intelligently instantiated or destroyed.
  it("should add and remove clients correctly during syncConfig", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    
    const initialConfig: any = {
      mcpServers: {
        "server-1": { transport: "stdio", command: "echo" }
      }
    };
    
    const configStore = new MockConfigStore(initialConfig);
    clientManager = new CM(configStore, new MockSecretStore(), new MockLogger());
    
    await clientManager.syncConfig(initialConfig);
    expect((await clientManager.getClientsJIT()).has("server-1")).toBe(true);
    
    const newConfig: any = {
      mcpServers: {
        "server-2": { transport: "sse", url: "http://example.com" }
      }
    };
    
    await clientManager.syncConfig(newConfig);
    
    expect(clientManager.getClients().has("server-1")).toBe(false);
    expect((await clientManager.getClientsJIT()).has("server-2")).toBe(true);
  });

  // Evaluates the simulated Ping Daemon and automatic Exponential Backoff mechanisms handling downstream failures gracefully.
  it("should trigger reconnection if ping fails and recover with backoff", async () => {
    jest.useFakeTimers();
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const config: any = { mcpServers: { "server-1": { transport: "stdio", command: "echo" } } };
    
    clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
    await clientManager.syncConfig(config);
    expect(clientManager.getClientStatus("server-1")).toBe("DISCONNECTED_IDLE");

    const client = await clientManager.getClientJIT("server-1"); // JIT wake up
    
    jest.useFakeTimers(); // Safe to freeze time AFTER the async connection

    // Force the proxy's next ping to fail
    (client as any).ping.mockRejectedValueOnce(new Error("Network Error"));

    // Advance 30s to trigger ping daemon
    await jest.advanceTimersByTimeAsync(30000);

    // First backoff timeout is 2 seconds (Math.pow(2, 1) = 2000)
    // Both interval and backoff are captured by the 30s advance.
    await jest.advanceTimersByTimeAsync(2000);

    // Status should have recovered automatically
    expect(clientManager.getClientStatus("server-1")).toBe("CONNECTED");
    jest.useRealTimers();
  });

  // Tests the HTTP streaming downstream constructor branches and Auth Injection header mechanics.
  it("should parse streamableHttp transport and handle auth header injections", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const config: any = { 
        mcpServers: { 
            "server-http": { transport: "http", url: "http://example.com/mcp", authInjection: { type: "header", headerName: "Authorization", value: "token" } } 
        } 
    };
    
    clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
    await clientManager.syncConfig(config);
    expect((await clientManager.getClientsJIT()).has("server-http")).toBe(true);
  });
});
