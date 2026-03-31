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
            const firstKey = this.store.keys().next().value;
            /* istanbul ignore next */
            if (firstKey !== undefined) this.store.delete(firstKey);
        }
    }
}
