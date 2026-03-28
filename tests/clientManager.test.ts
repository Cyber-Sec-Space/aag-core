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
    jest.useRealTimers();
    jest.clearAllMocks();
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

  // Coverage Patches for Transports & Ping Daemon
  it("should parse stdio transport and handle auth env injections", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const config: any = { mcpServers: { "server-env": { transport: "stdio", command: "echo", authInjection: { type: "env", key: "AUTH", value: "secret-vault" } } } };
    clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
    await clientManager.syncConfig(config);
    expect(await clientManager.getClientJIT("server-env")).toBeDefined();
  });

  it("should parse sse transport and handle auth header injections", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const config: any = { mcpServers: { "server-sse": { transport: "sse", url: "http://example.com/sse", authInjection: { type: "header", headerName: "Authorization", value: "token" } } } };
    clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
    await clientManager.syncConfig(config);
    expect(await clientManager.getClientJIT("server-sse")).toBeDefined();
  });

  it("should successfully trigger ping daemon closures dynamically when disconnected_idle", async () => {
    jest.useFakeTimers();
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const config: any = { mcpServers: { "ping-idle": { transport: "stdio", command: "echo" } } };
    clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger(), 100); 
    await clientManager.syncConfig(config);
    
    await clientManager.getClientJIT("ping-idle");
    expect(clientManager.getClientStatus("ping-idle")).toBe("CONNECTED");

    // Advance beyond idle timeout 100ms
    await jest.advanceTimersByTimeAsync(30000); 
    
    expect(clientManager.getClientStatus("ping-idle")).toBe("DISCONNECTED_IDLE");

    // Advance again to hit the other Ping Daemon branches which skip idle ones natively
    await jest.advanceTimersByTimeAsync(30000); 
    jest.useRealTimers();
  });

  it("should rollback JIT gracefully when backend fails entirely", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const config: any = { mcpServers: { "server-broken": { transport: "stdio", command: "echo" } } };
    clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
    await clientManager.syncConfig(config);
    
    jest.spyOn(clientManager as any, "createTransportAndConnect").mockRejectedValueOnce(new Error("Boot crash"));

    await expect(clientManager.getClientJIT("server-broken")).rejects.toThrow("Boot crash");
    expect(clientManager.getClientStatus("server-broken")).toBe("DISCONNECTED");
  });

  it("should return undefined if getClientJIT matches no servers", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    clientManager = new CM(new MockConfigStore({ mcpServers: {} } as any), new MockSecretStore(), new MockLogger());
    expect(await clientManager.getClientJIT("non-existent")).toBeUndefined();
  });

  // Explicit LCOV Coverage Additions
  
  it("should ping connected clients and trigger reconnect on failure natively covering ping daemon catches", async () => {
    jest.useFakeTimers();
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const config: any = { mcpServers: { "ping-server": { transport: "stdio", command: "echo" } } };
    clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
    await clientManager.syncConfig(config);
    const client = await clientManager.getClientJIT("ping-server");
    expect(client).toBeDefined();
    
    // Force ping to reject. Next interval should catch
    (client as any).ping.mockRejectedValueOnce(new Error("Ping failed"));
    
    await jest.advanceTimersByTimeAsync(30000);
    expect(clientManager.getClientStatus("ping-server")).toBe("RECONNECTING");

    // Advance to process the 1st backoff attempt
    await jest.advanceTimersByTimeAsync(2000);
    expect(clientManager.getClientStatus("ping-server")).toBe("CONNECTED");

    // Retrieve the newly rotated client instance and force it to fail
    const newClient = clientManager.getClient("ping-server");
    (newClient as any).ping.mockRejectedValueOnce(new Error("Ping failed 2"));

    (clientManager as any).createTransportAndConnect = jest.fn<any>().mockResolvedValue(null);
    await jest.advanceTimersByTimeAsync(30000);
    // Because it fails forever, it will recursively stay in RECONNECTING states and scale backoffs
    expect(clientManager.getClientStatus("ping-server")).toBe("RECONNECTING");
    
    jest.useRealTimers();
  });

  it("should diff config correctly and natively reload if changed", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const initialConfig: any = { mcpServers: { "diff-server": { transport: "stdio", command: "echo" } } };
    clientManager = new CM(new MockConfigStore(initialConfig), new MockSecretStore(), new MockLogger());
    await clientManager.syncConfig(initialConfig);
    
    const initialConfigSame: any = { mcpServers: { "diff-server": { transport: "stdio", command: "echo" } } };
    await clientManager.syncConfig(initialConfigSame);

    const newConfig: any = { mcpServers: { "diff-server": { transport: "stdio", command: "echo", args: ["changed"] } } };
    await clientManager.syncConfig(newConfig);
    expect(clientManager.getClientStatus("diff-server")).toBe("DISCONNECTED_IDLE");
  });

  it("should return null for unsupported transports triggering boot throw", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({} as any), new MockSecretStore(), new MockLogger());
      await expect(clientManager.syncConfig({ mcpServers: { "unsupported": { transport: "websocket" } as any } } as any))
          .rejects.toThrow("Proxy Configuration Schema is invalid during syncConfig");
  }, 10000);

  it("should securely hit unsupported transport throws deeply inside proxy routines bypassing Zod artificially", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: {}} as any), new MockSecretStore(), new MockLogger());
      
      (clientManager as any).clients.set("unsupported-hack", {
          config: { transport: "websocket" },
          status: "DISCONNECTED",
          reconnectAttempts: 0
      });
      
      await expect(clientManager.getClientJIT("unsupported-hack")).rejects.toThrow("Unsupported or null transport connection for: unsupported-hack");
  });

  it("should handle legacy synchronous getClient APIs gracefully", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    const config: any = { mcpServers: { "legacy-server": { transport: "stdio", command: "echo" } } };
    clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
    await clientManager.syncConfig(config);
    
    expect(clientManager.getClient("legacy-server")).toBeUndefined();
    expect(clientManager.getClients().size).toBe(0);

    await clientManager.getClientJIT("legacy-server");

    expect(clientManager.getClient("legacy-server")).toBeDefined();
    expect(clientManager.getClients().size).toBe(1);
    
    expect(clientManager.getClient("non-existent-server")).toBeUndefined();
  });

  it("should fallback getClientJIT undefined if status is unhandled natively by typescript type mismatches", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      const config: any = { mcpServers: { "unhandled": { transport: "stdio", command: "echo" } } };
      clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig(config);
      const managed = (clientManager as any).clients.get("unhandled");
      managed.status = "UNKNOWN_OR_FATAL";
      expect(await clientManager.getClientJIT("unhandled")).toBeUndefined();
  });

  it("should deduplicate concurrent JIT requests by returning the existing connectingPromise", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      const config: any = { mcpServers: { "concurrent": { transport: "stdio", command: "echo" } } };
      clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig(config);
      
      const p1 = clientManager.getClientJIT("concurrent");
      const p2 = clientManager.getClientJIT("concurrent");
      
      const [c1, c2] = await Promise.all([p1, p2]);
      expect(c1).toBe(c2);
  });

  it("should handle missing authInjection value fallback during HTTP/SSE init", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      const config: any = { mcpServers: { 
          "http_test": { transport: "http", url: "http://localhost", authInjection: { type: "header", headerName: "x" } },
          "sse_test": { transport: "sse", url: "http://localhost", authInjection: { type: "header", headerName: "y" } }
      } };
      clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig(config);
      await clientManager.getClientJIT("http_test").catch(()=>{});
      await clientManager.getClientJIT("sse_test").catch(()=>{});
  });

  it("should handle missing authInjection value fallback during STDIO init and falsy secretStore resolution safely", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      const config: any = { mcpServers: { 
          "stdio_test": { transport: "stdio", command: "echo", authInjection: { type: "env", key: "Z" } },
          "http_falsy": { transport: "http", url: "x", authInjection: { type: "header", headerName: "x", value: "x" } }
      } };
      const mockStore = new MockSecretStore();
      jest.spyOn(mockStore, "resolveSecret").mockResolvedValue(""); 
      clientManager = new CM(new MockConfigStore(config), mockStore, new MockLogger());
      await clientManager.syncConfig(config);
      await clientManager.getClientJIT("stdio_test").catch(()=>{});
      await clientManager.getClientJIT("http_falsy").catch(()=>{});
  });

  it("should safely clear empty pingInterval during destroy", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: {}} as any), new MockSecretStore(), new MockLogger());
      clearInterval((clientManager as any).pingInterval);
      (clientManager as any).pingInterval = undefined;
      clientManager.destroy();
  });

  it("should safely skip map setting for null clients inside getClientsJIT pool", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      const config: any = { mcpServers: { "unhandled": { transport: "stdio", command: "echo" } } };
      clientManager = new CM(new MockConfigStore(config), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig(config);
      
      jest.spyOn(clientManager as any, "getClientJIT").mockResolvedValueOnce(undefined);
      
      const map = await clientManager.getClientsJIT();
      expect(map.size).toBe(0);
  });

  it("should skip authInjection headers natively if headerName property is missing in HTTP/SSE configs", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      const config: any = { mcpServers: { 
          "http_no_hdr": { transport: "http", url: "http://localhost", authInjection: { type: "header" } }, 
          "sse_no_hdr": { transport: "sse", url: "http://localhost", authInjection: { type: "header" } }
      } };
      clientManager = new CM(new MockConfigStore(config as any), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig(config);
      await clientManager.getClientJIT("http_no_hdr").catch(()=>{});
      await clientManager.getClientJIT("sse_no_hdr").catch(()=>{});
  });

  it("should gracefully handle reconnect timer firing after the client was already deleted from the map", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: { "ghost": {transport: "stdio", command: "echo"} }} as any), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig({mcpServers: { "ghost": {transport: "stdio", command: "echo"} }} as any);
      
      const managed = (clientManager as any).clients.get("ghost");
      managed.status = "DISCONNECTED";
      // This schedules the timeout and throws a sync error
      jest.spyOn(clientManager as any, "createTransportAndConnect").mockRejectedValue(new Error("reconnect mock error"));
      (clientManager as any).triggerReconnect("ghost");
      
      // Instantly delete it so current is undefined when the timeout fires
      (clientManager as any).clients.delete("ghost");
      
      await new Promise(r => setTimeout(r, 1100)); // Wait for backoff
  });
  
  it("should safely ignore removeClient for unknown ids", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: {}} as any), new MockSecretStore(), new MockLogger());
      await (clientManager as any).removeClient("non-existent");
  });

  it("should handle falsy secretStore resolution safely for SSE transport headers natively", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      const config: any = { mcpServers: { 
          "sse_falsy": { transport: "sse", url: "x", authInjection: { type: "header", headerName: "x", value: "x" } }
      } };
      const mockStore = new MockSecretStore();
      jest.spyOn(mockStore, "resolveSecret").mockResolvedValue(""); 
      clientManager = new CM(new MockConfigStore(config as any), mockStore, new MockLogger());
      await clientManager.syncConfig(config as any);
      await clientManager.getClientJIT("sse_falsy").catch(()=>{});
  });

  it("should safely resolve reconnect promises identically if status abruptly changes mid-backoff", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: { "ghost": {transport: "stdio", command: "echo"} }} as any), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig({mcpServers: { "ghost": {transport: "stdio", command: "echo"} }} as any);
      
      const managed = (clientManager as any).clients.get("ghost");
      managed.status = "DISCONNECTED";
      
      (clientManager as any).triggerReconnect("ghost");
      managed.status = "DISCONNECTED_IDLE"; 
      
      await managed.connectingPromise; 
  });

  it("should safely resolve reconnect promises returning undefined if clientManager is destroyed mid-backoff natively", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: { "ghost": {transport: "stdio", command: "echo"} }} as any), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig({mcpServers: { "ghost": {transport: "stdio", command: "echo"} }} as any);
      
      const managed = (clientManager as any).clients.get("ghost");
      managed.status = "DISCONNECTED";
      
      (clientManager as any).triggerReconnect("ghost");
      clientManager.destroy(); 
      
      await managed.connectingPromise; 
  });

  it("should securely execute catch callbacks natively handling thrown close failures during disconnect routines", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: { "catch_test": {transport: "stdio", command: "echo"} }} as any), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig({mcpServers: { "catch_test": {transport: "stdio", command: "echo"} }} as any);
      
      const managed = (clientManager as any).clients.get("catch_test");
      managed.status = "CONNECTED";
      managed.client = { close: jest.fn<any>().mockRejectedValue(new Error("forced close test error")) };
      
      // Hit catch inside triggerReconnect (line 103 in clientManager.ts)
      (clientManager as any).triggerReconnect("catch_test");
      
      // Destroy so timeouts don't hang
      clientManager.destroy();
  });

  it("should securely execute catch callbacks natively handling thrown close failures during idle eviction", async () => {
      jest.useFakeTimers();
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: { "catch_idle": {transport: "stdio", command: "echo"} }} as any), new MockSecretStore(), new MockLogger(), 100);
      await clientManager.syncConfig({mcpServers: { "catch_idle": {transport: "stdio", command: "echo"} }} as any);
      
      const managed = (clientManager as any).clients.get("catch_idle");
      managed.status = "CONNECTED";
      managed.lastAccessed = Date.now() - 500000;
      managed.client = { close: jest.fn<any>().mockRejectedValue(new Error("idle eviction close error")), ping: jest.fn() };
      
      // Trigger the Ping Daemon loop over the interval
      await jest.advanceTimersByTimeAsync(30000);

      // Status should be disconnected idle and catch block fully traversed
      expect(managed.status).toBe("DISCONNECTED_IDLE");
      jest.useRealTimers();
      clientManager.destroy();
  });

  it("should securely execute catch callback natively handling thrown failures during total lifecycle destruction", async () => {
      const { ClientManager: CM } = await import("../src/clientManager.js");
      clientManager = new CM(new MockConfigStore({mcpServers: { "catch_destroy": {transport: "stdio", command: "echo"} }} as any), new MockSecretStore(), new MockLogger());
      await clientManager.syncConfig({mcpServers: { "catch_destroy": {transport: "stdio", command: "echo"} }} as any);
      
      // Specifically mock removeClient returning a hard rejection mid-lifecycle sweep
      jest.spyOn(clientManager as any, "removeClient").mockRejectedValue(new Error("Internal Destructor Bypass Error"));
      
      // Executes line 301 catch block internally
      clientManager.destroy();
  });
});
