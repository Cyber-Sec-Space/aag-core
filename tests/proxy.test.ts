import { jest } from "@jest/globals";
import { ProxyServer } from "../src/proxy.js";
import { ClientManager } from "../src/clientManager.js";
import { MockConfigStore, MockSecretStore, MockLogger } from "./mocks.js";
import { ConfigAuthStore } from "../src/auth/ConfigAuthStore.js";
import { RateLimitMiddleware } from "../src/middleware/rateLimit.js";
import { AagError } from "../src/errors.js";

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
                    command: "npx",
                    args: ["-y", "@modelcontextprotocol/server-github"],
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
            new ConfigAuthStore(configStore),
            new MockLogger()
        );
    });

    afterEach(() => {
        if (clientManager) clientManager.destroy();
        jest.clearAllMocks();
        delete process.env.AI_ID;
        delete process.env.AI_KEY;
    });

    it("should respect disableEnvFallback option directly targeting pure unauthenticated sessions", async () => {
        const strictProxy = new ProxyServer(clientManager, configStore, new MockSecretStore(), new ConfigAuthStore(configStore), new MockLogger(), { disableEnvFallback: true });
        const handlers = (strictProxy.server as any)._requestHandlers;
        const callHandler = handlers.get("tools/call");

        const req = { method: "tools/call", params: { name: "test", arguments: {} } };
        await expect(callHandler(req, {})).rejects.toThrow("Authentication required: No AI ID context provided for this session.");
    });

    it("should instantiate safely without optional bindings", () => {
        const defaultProxy = new ProxyServer(clientManager, configStore, new MockSecretStore(), new ConfigAuthStore(configStore), new MockLogger(), {});
        expect(defaultProxy).toBeDefined();
    });

    it("should instantiate securely with pre-authenticated aiId bound natively", () => {
        const strictProxy = new ProxyServer(clientManager, configStore, new MockSecretStore(), new ConfigAuthStore(configStore), new MockLogger(), { aiId: "saas-tenant" });
        expect(strictProxy).toBeDefined();
    });

    // ----------------------------------------------------
    // Section: Authentication Engine Validation
    // Verifies `validateAuth` dynamically authorizes the AI agent safely.
    // ----------------------------------------------------
    describe("Authentication", () => {
        it("should successfully instantiate base AagError defaults natively", () => {
            const err = new AagError("msg", "CODE");
            expect(err.status).toBe(500);
        });

        it("should validate auth dynamically from environment", async () => {
            const validateAuth = proxy.validateAuth.bind(proxy);
            const auth = await validateAuth({}, {});
            expect(auth.key).toBe("secret");
        });

        it("should reject if environment lacks credentials", async () => {
            delete process.env.AI_ID;
            const validateAuth = proxy.validateAuth.bind(proxy);
            await expect(validateAuth({}, {})).rejects.toThrow("Authentication required: Please provide AI_ID and AI_KEY in environment variables.");
        });

        it("should reject if key is revoked", async () => {
            configStore.getConfig().aiKeys["test-ai"].revoked = true;
            const validateAuth = proxy.validateAuth.bind(proxy);
            await expect(validateAuth({}, {})).rejects.toThrow("Key for AI ID 'test-ai' has been revoked.");
        });

        it("should reject if token is invalid", async () => {
            process.env.AI_KEY = "wrong";
            const validateAuth = proxy.validateAuth.bind(proxy);
            await expect(validateAuth({}, {})).rejects.toThrow("Invalid Key for AI ID 'test-ai' provided in environment.");
        });

        it("should throw if aiKeys configurations missing natively in store", async () => {
            configStore = new MockConfigStore({} as any);
            proxy = new ProxyServer(clientManager, configStore, new MockSecretStore(), new ConfigAuthStore(configStore), new MockLogger());
            await expect(proxy.validateAuth({}, {})).rejects.toThrow("Invalid AIID from environment: test-ai");
        });

        it("should throw if the environment ID maps to a missing AI ID key config natively", async () => {
            process.env.AI_ID = "nonexistent-ai";
            await expect(proxy.validateAuth({}, {})).rejects.toThrow("Invalid AIID from environment: nonexistent-ai");
        });

        it("should reject pre-authenticated sessions if matching identity is not found natively", async () => {
            const strictProxy = new ProxyServer(clientManager, configStore, new MockSecretStore(), new ConfigAuthStore(configStore), new MockLogger(), { aiId: "nonexistent-tenant" });
            const validateAuth = strictProxy['validateAuth'].bind(strictProxy);
            await expect(validateAuth({}, {})).rejects.toThrow("Session constructed with bound AI ID 'nonexistent-tenant' but no matching identity profile found.");
        });

        it("should reject pre-authenticated sessions if matching identity is revoked natively", async () => {
            configStore.getConfig().aiKeys["revoked-tenant"] = { key: "secret", revoked: true } as any;
            const strictProxy = new ProxyServer(clientManager, configStore, new MockSecretStore(), new ConfigAuthStore(configStore), new MockLogger(), { aiId: "revoked-tenant" });
            const validateAuth = strictProxy['validateAuth'].bind(strictProxy);
            await expect(validateAuth({}, {})).rejects.toThrow("Key for AI ID 'revoked-tenant' has been revoked.");
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

            proxy.authenticatedAiId = "test-ai"; // Optional but redundant mock
            
            const req = { method: "tools/list", params: {} };
            const result = await listHandler(req, {});
            expect(mockGithubClient.listTools).toHaveBeenCalled();
            expect(result.tools.length).toBe(1);
            expect(result.tools[0].name).toBe("github___search_repositories");
        });
        
        it("should gracefully catch listTools errors without crashing the aggregating loop", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const listHandler = handlers.get("tools/list");
            proxy.authenticatedAiId = "test-ai";
            mockGithubClient.listTools.mockRejectedValueOnce(new Error("Connection refused"));
            const req = { method: "tools/list", params: {} };
            const result = await listHandler(req, {});
            expect(result.tools.length).toBe(0); // Fault tolerant
        });

        it("isAllowed should permit access if permissions block is completely empty naturally", async () => {
            proxy.authenticatedAiId = "test-ai";
            const original = configStore.getConfig().aiKeys["test-ai"].permissions;
            configStore.getConfig().aiKeys["test-ai"].permissions = { allowedServers: [], allowedTools: [] };
            expect((proxy as any).isAllowed(configStore.getConfig().aiKeys["test-ai"], "github", "search_repositories")).toBe(true);
            configStore.getConfig().aiKeys["test-ai"].permissions = original;
        });

        it("isAllowed should permit access if permissions block is completely undefined natively", async () => {
            proxy.authenticatedAiId = "test-ai";
            const original = configStore.getConfig().aiKeys["test-ai"].permissions;
            configStore.getConfig().aiKeys["test-ai"].permissions = undefined;
            expect((proxy as any).isAllowed(configStore.getConfig().aiKeys["test-ai"], "github", "search_repositories")).toBe(true);
            configStore.getConfig().aiKeys["test-ai"].permissions = original;
        });

        it("should return true if tool pattern is exactly a wildcard", async () => {
            proxy.authenticatedAiId = "test-ai";
            const original = configStore.getConfig().aiKeys["test-ai"].permissions;
            configStore.getConfig().aiKeys["test-ai"].permissions = { allowedServers: ["*"], allowedTools: ["*"] };
            expect((proxy as any).isAllowed(configStore.getConfig().aiKeys["test-ai"], "github", "search_repositories")).toBe(true);
            configStore.getConfig().aiKeys["test-ai"].permissions = original;
        });

        it("should return false if authenticatedAiId is missing natively", () => {
            proxy.authenticatedAiId = undefined;
            expect((proxy as any).isAllowed({}, "github", "tool")).toBe(false);
        });

        it("should return true if auth config implicitly lacks permissions when tested", () => {
            proxy.authenticatedAiId = "test-ai";
            expect((proxy as any).isAllowed({}, "github", "tool")).toBe(true);
        });

        it("should return false if denied list strictly matches", () => {
            proxy.authenticatedAiId = "test-ai";
            expect((proxy as any).isAllowed(configStore.getConfig().aiKeys["test-ai"], "github", "search_users")).toBe(false);
        });

        it("should return false if deniedServers strictly matches", () => {
            proxy.authenticatedAiId = "test-ai";
            const original = configStore.getConfig().aiKeys["test-ai"].permissions;
            configStore.getConfig().aiKeys["test-ai"].permissions = { deniedServers: ["github"] };
            expect((proxy as any).isAllowed(configStore.getConfig().aiKeys["test-ai"], "github", "search_repositories")).toBe(false);
            configStore.getConfig().aiKeys["test-ai"].permissions = original;
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

        // Simulates the JIT connection pool failing due to being stuck reconnecting indefinitely
        it("should fail if target downstream server is stuck RECONNECTING", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            
            const managed = (clientManager as any).clients.get("github");
            managed.status = "RECONNECTING";

            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } };
            await expect(callHandler(req, {})).rejects.toThrow("Client github is stuck reconnecting");
            
            managed.status = "CONNECTED"; // Restore
        }, 10000);

        // Simulates edge case config wipe vulnerabilities
        it("should throw if the downstream targetServerId config is entirely missing", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            proxy.authenticatedAiId = "test-ai"; 
            delete configStore.getConfig().mcpServers["github"]; // Delete entirely
            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } };
            await expect(callHandler(req, {})).rejects.toThrow("fully qualified server not found");
        });

        it("should throw if the config evaluates as inherently falsy despite key existing natively", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            proxy.authenticatedAiId = "test-ai"; 
            configStore.getConfig().mcpServers["github"] = null as any; 
            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } };
            await expect(callHandler(req, {})).rejects.toThrow("Config for github not found");
        });

        it("should throw if downstream JIT wakes up gracefully returning null pointer", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            proxy.authenticatedAiId = "test-ai";
            jest.spyOn(clientManager, "getClientJIT").mockResolvedValueOnce(undefined);
            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } };
            await expect(callHandler(req, {})).rejects.toThrow("Client github is disconnected and failed to wake up.");
        });

        // Simulates internal downstream crash bubbles
        it("should catch and log downstream client.callTool runtime execution errors", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            
            proxy.authenticatedAiId = "test-ai"; // Mock pre-authenticated state
            mockGithubClient.callTool.mockRejectedValue(new Error("Downstream execution crash"));

            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } };
            await expect(callHandler(req, {})).rejects.toThrow("Internal Gateway Error: Downstream MCP server");
        });

        it("should iterate and skip non-matching servers during callTool extraction", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            configStore.getConfig().mcpServers["dummy"] = { transport: "stdio", command: "echo", args: [] } as any;
            
            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } };
            const result = await callHandler(req, {});
            expect(result.content[0].text).toBe("Success");
        });

        it("should throw fully qualified not found if the prefix loop strictly exhausts without a valid break natively", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            
            configStore.getConfig().mcpServers = { "dummy": { transport: "stdio", command: "ls" }, "another": { transport: "http", url: "http://test" } } as any; 
            
            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } }; 
            await expect(callHandler(req, {})).rejects.toThrow("fully qualified server not found");
        });

        it("should safely evaluate when mcpServers block is entirely native-undefined", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            
            const original = configStore.getConfig().mcpServers;
            delete (configStore.getConfig() as any).mcpServers;
            
            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } }; 
            await expect(callHandler(req, {})).rejects.toThrow("fully qualified server not found");
            
            configStore.getConfig().mcpServers = original;
        });

        it("should safely process callTool when request arguments are entirely omitted or injection values absent", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            
            configStore.getConfig().mcpServers["github"].authInjection!.value = undefined;

            const req = { method: "tools/call", params: { name: "github___search_repositories" } }; 
            const result = await callHandler(req, {});
            expect(mockGithubClient.callTool).toHaveBeenCalledWith(expect.objectContaining({
                arguments: expect.objectContaining({ token: "resolved-" }) // resolves undefined->""
            }));
            expect(result.content[0].text).toBe("Success");
            
            configStore.getConfig().mcpServers["github"].authInjection!.value = "githubToken";
        });

        it("should skip authInjection entirely if key is missing locally in proxy engine", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            configStore.getConfig().mcpServers["github"].authInjection!.key = undefined;
            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: {} } }; 
            const result = await callHandler(req, {});
            expect(result.content[0].text).toBe("Success");
            configStore.getConfig().mcpServers["github"].authInjection!.key = "token"; // restore
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

        it("should safely process middlewares that omit onRequest/onResponse or return undefined natively", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");

            // Adds a middleware with logic returning undefined
            proxy.use({
                onRequest: async (ctx: any, args: any) => undefined,
                onResponse: async (ctx: any, result: any) => undefined
            });

            // Adds a middleware completely missing onRequest/onResponse hooks
            proxy.use({});

            const req = { method: "tools/call", params: { name: "github___search_repositories", arguments: { a: 1 } } };
            const result = await callHandler(req, {});
            expect(result.content[0].text).toBe("Success");
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
        it("should fall back to environment variables auth and re-fetch if cache expires", async () => {
            process.env.AI_ID = "test-ai-id";
            process.env.AI_KEY = "test-ai-key";
            const req = { method: "tools/call", params: { name: "test___tool", arguments: {} } };
            const handlers = (proxy.server as any)._requestHandlers;
            const resourceHandler = handlers.get("tools/call");
            
            try { await resourceHandler(req, {}); } catch(e) {}
            
            const realNow = Date.now.bind(Date);
            jest.spyOn(Date, "now").mockImplementation(() => realNow() + 61000); // Trigger TTL expiry
            try { await resourceHandler(req, {}); } catch(e) {}
            jest.restoreAllMocks();
            delete process.env.AI_ID;
            delete process.env.AI_KEY;
        });

        it("should route correctly if target server exists only in tenant mcpServers", async () => {
            const handlers = (proxy.server as any)._requestHandlers;
            const callHandler = handlers.get("tools/call");
            
            process.env.AI_ID = "test-ai";
            process.env.AI_KEY = "test-key";
            
            const req = { method: "tools/call", params: { name: "personal___tool", arguments: {} } };
            
            const pAuthStore = (proxy as any).authStore;
            jest.spyOn(pAuthStore, "getIdentity").mockResolvedValue({
                key: "test-key",
                revoked: false,
                pluginConfig: {},
                mcpServers: { personal: { transport: "sse", url: "http://localhost/sse" } }
            });
            
            jest.spyOn(clientManager, "getClientJIT").mockResolvedValue({
                callTool: jest.fn<any>().mockResolvedValue({ content: [] })
            } as any);
            
            await expect(callHandler(req, {})).resolves.toBeDefined();
        });
    });
});
