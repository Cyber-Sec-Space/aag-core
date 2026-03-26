import { jest } from "@jest/globals";
import { ClientManager } from "../src/clientManager.js";
import { MockConfigStore, MockSecretStore, MockLogger } from "./mocks.js";

jest.unstable_mockModule("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    connect = jest.fn<any>().mockResolvedValue(undefined);
    close = jest.fn<any>().mockResolvedValue(undefined);
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should add and remove clients correctly during syncConfig", async () => {
    const { ClientManager: CM } = await import("../src/clientManager.js");
    
    const initialConfig: any = {
      mcpServers: {
        "server-1": { transport: "stdio", command: "echo" }
      }
    };
    
    const configStore = new MockConfigStore(initialConfig);
    const clientManager = new CM(configStore, new MockSecretStore(), new MockLogger());
    
    await clientManager.syncConfig(initialConfig);
    expect(clientManager.getClients().has("server-1")).toBe(true);
    
    const newConfig: any = {
      mcpServers: {
        "server-2": { transport: "sse", url: "http://example.com" }
      }
    };
    
    await clientManager.syncConfig(newConfig);
    
    expect(clientManager.getClients().has("server-1")).toBe(false);
    expect(clientManager.getClients().has("server-2")).toBe(true);
  });
});
