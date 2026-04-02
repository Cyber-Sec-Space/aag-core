import { jest } from "@jest/globals";
import { SessionManager } from "../src/session/SessionManager.js";
import { RateLimitExceededError } from "../src/errors.js";
import { MockConfigStore, MockLogger } from "./mocks.js";

describe("SessionManager", () => {
    let configStore: MockConfigStore;
    let logger: MockLogger;
    let configChangedListener: (config: any) => void;

    beforeEach(() => {
        configStore = new MockConfigStore({ mcpServers: {} } as any);
        // configStore mock setup maintained for backward compatibility in constructor tests

        logger = new MockLogger();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should instantiate without throwing", () => {
        const manager = new SessionManager(configStore, logger);
        expect(manager).toBeDefined();
    });

    it("should throw RateLimitExceededError when maxConcurrentSessions is exceeded", () => {
        const boundConfigStore = new MockConfigStore({ system: { maxConcurrentSessions: 10 }, mcpServers: {} } as any);
        const manager = new SessionManager(boundConfigStore, logger);
        const aiId = "ai_flood";
        const fns: (() => void)[] = [];
        
        for (let i = 0; i < 10; i++) {
            fns.push(manager.registerSession(aiId, () => {}));
        }

        expect(() => {
            manager.registerSession(aiId, () => {});
        }).toThrow(RateLimitExceededError);

        // Cleanup
        fns.forEach(unreg => unreg());
    });

    it("should allow registering and unregistering sessions", async () => {
        const manager = new SessionManager(configStore, logger);
        const disconnectFn = jest.fn();

        const unregister = manager.registerSession("ai-id-1", disconnectFn);
        await manager.disconnectAll("ai-id-1");
        expect(disconnectFn).toHaveBeenCalledTimes(1);

        disconnectFn.mockClear();

        // Registration after unregister
        const unregister2 = manager.registerSession("ai-id-1", disconnectFn);
        unregister2(); // Remove it cleanly
        await manager.disconnectAll("ai-id-1");
        expect(disconnectFn).not.toHaveBeenCalled();
        
        // Unregister multiple times safely
        unregister2();
    });

    it("should execute multiple disconnect functions on disconnectAll", async () => {
        const manager = new SessionManager(configStore, logger);
        const disconnect1 = jest.fn();
        const disconnect2 = jest.fn();

        manager.registerSession("ai-id-2", disconnect1);
        manager.registerSession("ai-id-2", disconnect2);

        await manager.disconnectAll("ai-id-2");

        expect(disconnect1).toHaveBeenCalledTimes(1);
        expect(disconnect2).toHaveBeenCalledTimes(1);
        
        // Calling again should do nothing since it's deleted
        await manager.disconnectAll("ai-id-2");
        expect(disconnect1).toHaveBeenCalledTimes(1);
    });

    it("should gracefully handle errors thrown by disconnect callbacks", async () => {
        const manager = new SessionManager(configStore, logger);
        const disconnectFail = jest.fn().mockImplementation(() => {
            throw new Error("Test disconnect error");
        });
        const disconnectSuccess = jest.fn();
        const warnSpy = jest.spyOn(logger, "warn");

        manager.registerSession("ai-id-3", disconnectFail);
        manager.registerSession("ai-id-3", disconnectSuccess);

        await manager.disconnectAll("ai-id-3");

        expect(disconnectFail).toHaveBeenCalledTimes(1);
        expect(disconnectSuccess).toHaveBeenCalledTimes(1); // Should still execute the rest
        expect(warnSpy).toHaveBeenCalledWith("SessionManager", "Error executing disconnect callback for 'ai-id-3': Test disconnect error");
    });



    it("should completely delete the map entry when the final registered session unregisters naturally", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnectFn = jest.fn();
        const unregister = manager.registerSession("ai-id-final-test", disconnectFn);
        unregister();
        expect((manager as any).activeSessions.has("ai-id-final-test")).toBe(false);
    });

    it("should NOT delete the map entry when one session unregisters but others remain", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnectFn1 = jest.fn();
        const disconnectFn2 = jest.fn();
        const unregister1 = manager.registerSession("multi-session", disconnectFn1);
        const unregister2 = manager.registerSession("multi-session", disconnectFn2);
        
        unregister1(); 
        expect((manager as any).activeSessions.has("multi-session")).toBe(true);
        unregister2(); 
        expect((manager as any).activeSessions.has("multi-session")).toBe(false);
    });

    it("should safely handle unregistering a session after disconnectAll has wiped the map natively", async () => {
        const manager = new SessionManager(configStore, logger);
        const disconnectFn = jest.fn();
        const unregister = manager.registerSession("ai-id-wiped", disconnectFn);
        await manager.disconnectAll("ai-id-wiped"); 
        unregister();  
        expect((manager as any).activeSessions.has("ai-id-wiped")).toBe(false);
    });
});
