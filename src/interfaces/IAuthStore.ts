import { AuthKey } from "../config/types.js";

export interface IAuthStore {
    /**
     * Dynamically fetches the AuthKey profile for a specific AI ID.
     * In highly scalable environments, this allows JIT identity checks (e.g., against Redis or a relational DB)
     * avoiding the overhead of compiling a massive local JSON configuration tree into memory.
     * 
     * @param aiId The unique connection identifier referencing an AI client
     */
    getIdentity(aiId: string): Promise<AuthKey | null>;
}
