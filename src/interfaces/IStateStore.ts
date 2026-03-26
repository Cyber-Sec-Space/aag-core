export interface IStateStore {
  get(key: string): Promise<any | null>;
  set(key: string, value: any): Promise<void>;
}
