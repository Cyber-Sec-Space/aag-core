import { IConfigStore } from "../src/interfaces/IConfigStore.js";
import { ISecretStore } from "../src/interfaces/ISecretStore.js";
import { IAuditLogger } from "../src/interfaces/IAuditLogger.js";
import { ProxyConfig } from "../src/config/types.js";

export class MockConfigStore implements IConfigStore {
  private config: ProxyConfig;
  constructor(config: ProxyConfig) {
    this.config = config;
  }
  getConfig(): ProxyConfig {
    return this.config;
  }
  saveConfig(newConfig: any): void {
    this.config = newConfig;
  }
  on(event: "configChanged", listener: (config: any) => void): this {
    return this;
  }
}

export class MockSecretStore implements ISecretStore {
  async resolveSecret(ref: string): Promise<string> {
    return `resolved-${ref}`;
  }
}

export class MockLogger implements IAuditLogger {
  info(category: string, message: string): void {}
  warn(category: string, message: string): void {}
  error(category: string, message: string): void {}
  debug(category: string, message: string): void {}
}
