import { IStateStore } from "./IStateStore.js";

export class MemoryStateStore implements IStateStore {
    private store = new Map<string, any>();
    private maxKeys: number;

    constructor(maxKeys: number = 10000) {
        this.maxKeys = maxKeys;
    }

    async get(key: string): Promise<any | null> {
        return this.store.get(key) || null;
    }

    async set(key: string, value: any): Promise<void> {
        this.store.set(key, value);
        if (this.store.size > this.maxKeys) {
            const clearCount = Math.max(1, Math.floor(this.maxKeys * 0.10));
            let count = 0;
            for (const k of this.store.keys()) {
                this.store.delete(k);
                count++;
                if (count >= clearCount) break;
            }
        }
    }
}
