import { jest } from "@jest/globals";
import { ProxyServer } from "../src/proxy.js";
import { ClientManager } from "../src/clientManager.js";
import { MockConfigStore, MockSecretStore, MockLogger } from "./mocks.js";

describe("ProxyServer Suite", () => {
    let proxy: any;
    let configStore: MockConfigStore;
    let mockGithubClient: any;

    beforeEach(() => {
        process.env.AI_ID = "test-ai";
        process.env.AI_KEY = "secret";

        const configData: any = {
            aiKeys: {
                "test-ai": {
                    key: "secret",
                    createdAt: new Date().toISOString(),
                    permissions: {
                        allowedServers: ["github", "local-*"],
                        allowedTools: ["github___search_*", "*___read_file"],
                        deniedTools: ["*___delete_*", "github___search_users"]
                    }
                }
            },
            mcpServers: {
                "github": {
                    transport: "stdio",
                    authInjection: { type: "payload", key: "token", value: "githubToken" }
                }
            }
        };

        configStore = new MockConfigStore(configData);
        const clientManager = new ClientManager(configStore, new MockSecretStore(), new MockLogger());
        
        mockGithubClient = {
            listTools: jest.fn<any>().mockResolvedValue({ tools: [{ name: "search_repositories" }] }),
            callTool: jest.fn<any>().mockResolvedValue({ content: [{ type: "text", text: "Success" }] })
        };
        clientManager.getClients().set("github", mockGithubClient);

        proxy = new ProxyServer(
            clientManager,
            configStore,
            new MockSecretStore(),
            new MockLogger()
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
        delete process.env.AI_ID;
        delete process.env.AI_KEY;
    });

    describe("Authentication", () => {
        it("should validate auth dynamically from environment", () => {
            const validateAuth = proxy.validateAuth.bind(proxy);
            const aiid = validateAuth({}, {});
            expect(aiid).toBe("test-ai");
        });

        it("should reject if environment lacks credentials", () => {
            delete process.env.AI_ID;
            const validateAuth = proxy.validateAuth.bind(proxy);
            expect(() => validateAuth({}, {})).toThrow("Authentication required: Please provide AI_ID and AI_KEY in environment variables.");
        });

        it("should reject if key is revoked", () => {
            configStore.getConfig().aiKeys["test-ai"].revoked = true;
            const validateAuth = proxy.validateAuth.bind(proxy);
            expect(() => validateAuth({}, {})).toThrow("Key for AI ID 'test-ai' has been revoked.");
        });

        it("should reject if token is invalid", () => {
            process.env.AI_KEY = "wrong";
            const validateAuth = proxy.validateAuth.bind(proxy);
            expect(() => validateAuth({}, {})).toThrow("Invalid Key for AI ID 'test-ai' provided in environment.");
        });
    });

    describe("Handlers (AuthInjection and Forwarding)", () => {
        it("should parse listTools correctly and apply correct prefixes", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const listHandler = handlers.get("tools/list");
            if (!listHandler) throw new Error("ListTools handler not found");

            proxy.authenticatedAiId = "test-ai"; // Mock pre-authenticated state avoids env checks depending on timing
            
            const req = { method: "tools/list", params: {} };
            const result = await listHandler(req, {});
            expect(mockGithubClient.listTools).toHaveBeenCalled();
            expect(result.tools.length).toBe(1);
            expect(result.tools[0].name).toBe("github___search_repositories");
        });

        it("should perform authInjection on callTool if configured and forward properly", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            if (!callHandler) throw new Error("CallTool handler not found");

            // Proxy validation is done inside the handler via validateAuth -> checks env.
            // env variables are set to valid secrets in beforeEach
            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: { query: "AAG" } } };
            const result = await callHandler(req, {});
            
            expect(mockGithubClient.callTool).toHaveBeenCalledWith({
                name: "search_repositories",
                arguments: { query: "AAG", token: "resolved-githubToken" } // Secret mock resolves `resolved-${ref}`
            });
            expect(result.content[0].text).toBe("Success");
        });

        it("should deny unpermitted callTool requests", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            
            const req = { method: "tools/call", params: { name: "github___search_users", arguments: {} } };
            await expect(callHandler(req, {})).rejects.toThrow("Permission denied: AI ID 'test-ai' is not allowed to use tool 'github___search_users'.");
        });
    });
});
