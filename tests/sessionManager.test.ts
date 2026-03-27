import { jest } from "@jest/globals";
import { SessionManager } from "../src/session/SessionManager.js";
import { MockConfigStore, MockLogger } from "./mocks.js";

describe("SessionManager", () => {
    let configStore: MockConfigStore;
    let logger: MockLogger;
    let configChangedListener: (config: any) => void;

    beforeEach(() => {
        configStore = new MockConfigStore({ mcpServers: {} } as any);
        
        // Spy on the configStore's 'on' method to capture the configChanged listener
        jest.spyOn(configStore, "on").mockImplementation((event: string, listener: any) => {
            if (event === "configChanged") {
                configChangedListener = listener;
            }
            return configStore as any;
        });

        logger = new MockLogger();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should instantiate and register config change listener", () => {
        const manager = new SessionManager(configStore, logger);
        expect(configStore.on).toHaveBeenCalledWith("configChanged", expect.any(Function));
        expect(configChangedListener).toBeDefined();
    });

    it("should allow registering and unregistering sessions", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnectFn = jest.fn();

        const unregister = manager.registerSession("ai-id-1", disconnectFn);
        manager.disconnectAll("ai-id-1");
        expect(disconnectFn).toHaveBeenCalledTimes(1);

        disconnectFn.mockClear();

        // Registration after unregister
        const unregister2 = manager.registerSession("ai-id-1", disconnectFn);
        unregister2(); // Remove it cleanly
        manager.disconnectAll("ai-id-1");
        expect(disconnectFn).not.toHaveBeenCalled();
        
        // Unregister multiple times safely
        unregister2();
    });

    it("should execute multiple disconnect functions on disconnectAll", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnect1 = jest.fn();
        const disconnect2 = jest.fn();

        manager.registerSession("ai-id-2", disconnect1);
        manager.registerSession("ai-id-2", disconnect2);

        manager.disconnectAll("ai-id-2");

        expect(disconnect1).toHaveBeenCalledTimes(1);
        expect(disconnect2).toHaveBeenCalledTimes(1);
        
        // Calling again should do nothing since it's deleted
        manager.disconnectAll("ai-id-2");
        expect(disconnect1).toHaveBeenCalledTimes(1);
    });

    it("should gracefully handle errors thrown by disconnect callbacks", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnectFail = jest.fn().mockImplementation(() => {
            throw new Error("Test disconnect error");
        });
        const disconnectSuccess = jest.fn();
        const warnSpy = jest.spyOn(logger, "warn");

        manager.registerSession("ai-id-3", disconnectFail);
        manager.registerSession("ai-id-3", disconnectSuccess);

        manager.disconnectAll("ai-id-3");

        expect(disconnectFail).toHaveBeenCalledTimes(1);
        expect(disconnectSuccess).toHaveBeenCalledTimes(1); // Should still execute the rest
        expect(warnSpy).toHaveBeenCalledWith("SessionManager", "Error executing disconnect callback for 'ai-id-3': Test disconnect error");
    });

    it("should forcibly terminate sessions when configChanged signals a missing AI ID or no full aiKeys object", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnect = jest.fn();
        manager.registerSession("revoked-id", disconnect);

        // Missing aiKeys completely
        configChangedListener({});
        expect(disconnect).not.toHaveBeenCalled();

        // Object exists but missing id
        configChangedListener({ aiKeys: {} });
        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("should forcefully terminate sessions when configChanged signals revocation", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnect = jest.fn();
        manager.registerSession("revoked-id-2", disconnect);

        const newConfig = {
            aiKeys: {
                "revoked-id-2": {
                    revoked: true,
                    key: "old-key"
                }
            }
        };

        const infoSpy = jest.spyOn(logger, "info");
        configChangedListener(newConfig);

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(infoSpy).toHaveBeenCalledWith("SessionManager", "AI ID 'revoked-id-2' was revoked or removed. Forcibly terminating 1 active session(s).");
    });

    it("should not terminate valid, unrevoked sessions on config changes", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnect = jest.fn();
        manager.registerSession("valid-id", disconnect);

        const newConfig = {
            aiKeys: {
                "valid-id": {
                    revoked: false,
                    key: "valid-key"
                }
            }
        };

        configChangedListener(newConfig);
        expect(disconnect).not.toHaveBeenCalled();
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

    it("should safely handle unregistering a session after disconnectAll has wiped the map natively", () => {
        const manager = new SessionManager(configStore, logger);
        const disconnectFn = jest.fn();
        const unregister = manager.registerSession("ai-id-wiped", disconnectFn);
        manager.disconnectAll("ai-id-wiped"); 
        unregister();  
        expect((manager as any).activeSessions.has("ai-id-wiped")).toBe(false);
    });
});
