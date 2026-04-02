import { IConfigStore } from "../interfaces/IConfigStore.js";
import { IAuditLogger } from "../interfaces/IAuditLogger.js";

import { RateLimitExceededError } from "../errors.js";

export class SessionManager {
    /**
     * Map of AI_ID to a Set of disconnect callbacks.
     * Each Active Session registers a callback to forcibly close its transport/connection.
     */
    private activeSessions: Map<string, Set<() => void>> = new Map();

    private get maxConcurrentSessions(): number {
        return this.configStore?.getConfig()?.system?.maxConcurrentSessions ?? 10000;
    }

    /**
     * @param configStore Optional ConfigStore. Overrides maxConcurrentSessions dynamically.
     * @param logger The audit logger instance.
     */
    constructor(private configStore: IConfigStore | null, private logger: IAuditLogger) {
        // AI Keys dynamic revocation is now entirely delegated 
        // to explicit external SaaS calls via disconnectAll()
    }

    /**
     * Register an active session for an AI_ID.
     * 
     * @warning **Memory Leak Prevention**: The returned `unregister` function MUST be invoked 
     *          when the host transport (e.g. Express Response) naturally closes or errors out.
     *          Failure to do so will accumulate dangling callbacks infinitely.
     * 
     * @param aiId The authenticated AI_ID for this session.
     * @param disconnectFn A callback that reliably terminates the session transport/process.
     * @returns A function to unregister the session when it naturally closes.
     */
    public registerSession(aiId: string, disconnectFn: () => void): () => void {
        let set = this.activeSessions.get(aiId);
        if (!set) {
            set = new Set();
            this.activeSessions.set(aiId, set);
        }

        if (set.size >= this.maxConcurrentSessions) {
            throw new RateLimitExceededError(`Maximum concurrent sessions (${this.maxConcurrentSessions}) exceeded for AI ID '${aiId}'.`);
        }

        set.add(disconnectFn);

        return () => {
             const fns = this.activeSessions.get(aiId);
             if (fns) {
                 fns.delete(disconnectFn);
                 if (fns.size === 0) {
                     this.activeSessions.delete(aiId);
                 }
             }
        };
    }

    /**
     * Forcibly closes all connected sessions for a given AI_ID.
     * @param aiId The AI_ID to disconnect.
     */
    public async disconnectAll(aiId: string) {
        const fns = this.activeSessions.get(aiId);
        if (fns) {
            this.activeSessions.delete(aiId); // Prevent async race conditions
            const arr = Array.from(fns);
            const chunkSize = 50;
            
            for (let i = 0; i < arr.length; i += chunkSize) {
                const chunk = arr.slice(i, i + chunkSize);
                for (const fn of chunk) {
                    try { 
                        fn(); 
                    } catch (e: any) {
                        this.logger.warn("SessionManager", `Error executing disconnect callback for '${aiId}': ${e.message}`);
                    }
                }
                // Yield to event loop between chunks
                /* istanbul ignore next - hard to accurately profile zero-delay timers */
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }
}
