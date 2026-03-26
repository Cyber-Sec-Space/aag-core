import { IStateStore } from "./IStateStore.js";

export class MemoryStateStore implements IStateStore {
    private store = new Map<string, any>();

    async get(key: string): Promise<any | null> {
        return this.store.get(key) || null;
    }

    async set(key: string, value: any): Promise<void> {
        this.store.set(key, value);
    }
}
