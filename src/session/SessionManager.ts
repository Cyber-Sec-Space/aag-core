import { IConfigStore } from "../interfaces/IConfigStore.js";
import { IAuditLogger } from "../interfaces/IAuditLogger.js";

export class SessionManager {
    /**
     * Map of AI_ID to a Set of disconnect callbacks.
     * Each Active Session registers a callback to forcibly close its transport/connection.
     */
    private activeSessions: Map<string, Set<() => void>> = new Map();

    /**
     * @param configStore Deprecated in v2.2.0. Pass null or any IConfigStore. Config sync is now decoupled.
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
        if (!this.activeSessions.has(aiId)) {
            this.activeSessions.set(aiId, new Set());
        }
        this.activeSessions.get(aiId)!.add(disconnectFn);

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
    public disconnectAll(aiId: string) {
        const fns = this.activeSessions.get(aiId);
        if (fns) {
            for (const fn of fns) {
                try { 
                    fn(); 
                } catch (e: any) {
                    this.logger.warn("SessionManager", `Error executing disconnect callback for '${aiId}': ${e.message}`);
                }
            }
            this.activeSessions.delete(aiId);
        }
    }
}
