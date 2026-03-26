import { jest } from "@jest/globals";
import { ProxyServer } from "../src/proxy.js";
import { ClientManager } from "../src/clientManager.js";
import { MockConfigStore, MockSecretStore, MockLogger } from "./mocks.js";
import { RateLimitMiddleware } from "../src/middleware/rateLimit.js";

describe("ProxyServer Suite", () => {
    let proxy: any;
    let configStore: MockConfigStore;
    let mockGithubClient: any;
    let clientManager: any;

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
        clientManager = new ClientManager(configStore, new MockSecretStore(), new MockLogger());
        
        mockGithubClient = {
            listTools: jest.fn<any>().mockResolvedValue({ tools: [{ name: "search_repositories" }] }),
            callTool: jest.fn<any>().mockResolvedValue({ content: [{ type: "text", text: "Success" }] })
        };
        (clientManager as any).clients.set("github", {
            client: mockGithubClient,
            config: configData.mcpServers["github"],
            status: "CONNECTED",
            reconnectAttempts: 0
        });

        proxy = new ProxyServer(
            clientManager,
            configStore,
            new MockSecretStore(),
            new MockLogger()
        );
    });

    afterEach(() => {
        if (clientManager) clientManager.destroy();
        jest.clearAllMocks();
        delete process.env.AI_ID;
        delete process.env.AI_KEY;
    });

    // ----------------------------------------------------
    // Section: Authentication Engine Validation
    // Verifies `validateAuth` dynamically authorizes the AI agent safely.
    // ----------------------------------------------------
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

    // ----------------------------------------------------
    // Section: Request Handlers (MCP Core Routing & Injection)
    // Evaluates Proxy Tool List namespacing, CallTool routing, RBAC tests, and multiplex failing resilience.
    // ----------------------------------------------------
    describe("Handlers (AuthInjection and Forwarding)", () => {
        
        // Verifies the ListTools response maps accurately by prefixing components (e.g. server___target).
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

        // Verifies `ProxyServer` handles dynamic injection mappings into the raw downstream `arguments`
        // without allowing the end-user (AI) to ever see or possess the injected secret token directly.
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

        // Simulates the Multiplex Keep-Alive optimization failing fast upon disconnected downstream servers.
        it("should fail-fast if target downstream server is RECONNECTING", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            
            const managed = (clientManager as any).clients.get("github");
            managed.status = "RECONNECTING";

            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } };
            await expect(callHandler(req, {})).rejects.toThrow("Downstream server 'github' is currently unavailable and reconnecting.");
            
            managed.status = "CONNECTED"; // Restore
        });
    });

    // ----------------------------------------------------
    // Section: Middlewares (Response & Request Interceptors)
    // Evaluates ProxyMiddleware's ability to mutate args and results inline securely.
    // ----------------------------------------------------
    describe("Middlewares", () => {
        it("should intercept and mutate args and results effectively", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");

            // Mock downstream result just for this test
            mockGithubClient.callTool.mockResolvedValueOnce({ 
                content: [{ type: "text", text: "Admin: root@secret.com" }] 
            });

            // Register a custom middleware payload mutating logic
            proxy.use({
                onRequest: (ctx: any, args: any) => ({ ...args, query: args.query + "_intercepted" }),
                onResponse: (ctx: any, result: any) => {
                    const masked = result.content[0].text.replace("root@secret.com", "***");
                    return { content: [{ type: "text", text: masked }] };
                }
            });

            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: { query: "aag" } } };
            const result = await callHandler(req, {});

            // Verify onRequest mutation took place before sending to github
            expect(mockGithubClient.callTool).toHaveBeenCalledWith(expect.objectContaining({
                arguments: expect.objectContaining({ query: "aag_intercepted" })
            }));

            // Verify onResponse mutation masked the PII securely
            expect(result.content[0].text).toBe("Admin: ***");
        });
    });

    // ----------------------------------------------------
    // Section: Rate Limiting
    // Verifies the Token Bucket rate limiter correctly blocks excessive requests.
    // ----------------------------------------------------
    describe("Rate Limiting", () => {
        it("should allow requests under the limit and block those exceeding it", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");

            // Limit: 2 requests per minute (60000ms)
            const limiter = new RateLimitMiddleware(2, 60000);
            proxy.use(limiter);

            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: { query: "1" } } };
            
            // 1st request - OK
            await callHandler(req, {});
            // 2nd request - OK
            await callHandler(req, {});
            
            // 3rd request - Fail
            await expect(callHandler(req, {})).rejects.toThrow("Rate limit exceeded for AI ID 'test-ai'. Please try again later.");
        });
    });
});
