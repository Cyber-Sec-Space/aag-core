import { IAuthStore } from "../interfaces/IAuthStore.js";
import { IConfigStore } from "../interfaces/IConfigStore.js";
import { AuthKey } from "../config/types.js";

/**
 * A highly simplified fallback adapter natively built into the core.
 * Extrapolates dynamic IAuthStore identity lookups from an existing synchronous IConfigStore dict mappings.
 * Ideal for standalone CLI endpoints or strict single-machine deployments that don't need real SaaS database scaling.
 */
export class ConfigAuthStore implements IAuthStore {
    constructor(private configStore: IConfigStore) {}

    async getIdentity(aiId: string): Promise<AuthKey | null> {
        const config = this.configStore.getConfig();
        return config?.aiKeys?.[aiId] || null;
    }
}
