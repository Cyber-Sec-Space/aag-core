import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ProxyConfig, McpServerConfig, McpStdioConfig, McpSseConfig, McpHttpConfig, AuthKey } from "./config/types.js";
import { IConfigStore } from "./interfaces/IConfigStore.js";
import { ISecretStore } from "./interfaces/ISecretStore.js";
import { IAuditLogger } from "./interfaces/IAuditLogger.js";
import { ProxyConfigSchema } from "./config/types.js";
import { UpstreamConnectionError, AagConfigurationError } from "./errors.js";

export type ClientStatus = "CONNECTED" | "RECONNECTING" | "DISCONNECTED" | "DISCONNECTED_IDLE";

export interface ManagedClient {
  client: Client | null;
  config: McpServerConfig;
  status: ClientStatus;
  reconnectAttempts: number;
  lastAccessed: number;
  connectingPromise?: Promise<Client | undefined>;
  reconnectTimeout?: ReturnType<typeof setTimeout>;
  isTenantContext?: boolean;
}

export class ClientManager {
  private clients: Map<string, ManagedClient> = new Map();
  private configStore: IConfigStore;
  private secretStore: ISecretStore;
  private logger: IAuditLogger;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;
  private idleTimeoutMs: number;

  private pingIntervalMs: number;
  private pingTimeoutMs: number;

  constructor(configStore: IConfigStore, secretStore: ISecretStore, logger: IAuditLogger, idleTimeoutMs?: number) {
    this.configStore = configStore;
    this.secretStore = secretStore;
    this.logger = logger;
    
    const sys = this.configStore.getConfig()?.system;
    this.idleTimeoutMs = idleTimeoutMs ?? sys?.idleTimeoutMs ?? 300000;
    this.pingIntervalMs = sys?.pingIntervalMs ?? 30000;
    this.pingTimeoutMs = sys?.pingTimeoutMs ?? 5000;
    
    this.startPingDaemon();
  }

  private startPingDaemon() {
    this.pingInterval = setInterval(async () => {
      const now = Date.now();
      for (const [id, managed] of this.clients.entries()) {
        if (managed.status === "CONNECTED" && managed.client) {
          
          if (now - managed.lastAccessed > this.idleTimeoutMs) {
             this.logger.info("ClientManager", `Evicting idle downstream client ${id} to save resources.`);
             managed.status = "DISCONNECTED_IDLE";
             managed.client.close().catch(()=>{});
             managed.client = null;
             
             // Dynamic tenant clients are ephemeral; fully remove if idle
             if (managed.isTenantContext) {
                 this.clients.delete(id);
             }
             continue;
          }

          try {
            const pingPromise = managed.client.ping();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Ping timeout")), this.pingTimeoutMs));
            await Promise.race([pingPromise, timeoutPromise]);
          } catch (e: any) {
            this.logger.warn("ClientManager", `Client ${id} failed ping check: ${e.message}. Triggering reconnect.`);
            this.triggerReconnect(id);
          }
        }
      }
    }, this.pingIntervalMs);
    /* istanbul ignore next */
    if (this.pingInterval?.unref) {
      this.pingInterval.unref();
    }
  }

  public async syncConfig(config: ProxyConfig) {
    let parsedConfig: ProxyConfig;
    try {
        parsedConfig = ProxyConfigSchema.parse(config);
    } catch (e: any) {
        this.logger.error("ClientManager", `Configuration schema invalid during sync: ${e.message}`);
        throw new AagConfigurationError("Proxy Configuration Schema is invalid during syncConfig", e.errors);
    }
    
    const currentServerIds = new Set(
        Array.from(this.clients.entries())
        .filter(([_, m]) => !m.isTenantContext)
        .map(([id]) => id)
    );
    const newServerIds = new Set(Object.keys(parsedConfig.mcpServers));

    for (const id of currentServerIds) {
      if (!newServerIds.has(id)) {
        await this.removeClient(id);
      }
    }

    for (const [id, serverConfig] of Object.entries(parsedConfig.mcpServers)) {
      if (currentServerIds.has(id)) {
        const existing = this.clients.get(id);
        if (JSON.stringify(existing?.config) !== JSON.stringify(serverConfig)) {
           await this.removeClient(id);
           await this.addClient(id, serverConfig as McpServerConfig);
        }
      } else {
        await this.addClient(id, serverConfig as McpServerConfig);
      }
    }
  }

  private triggerReconnect(id: string) {
    const managed = this.clients.get(id);
    if (!managed || managed.status === "RECONNECTING" || this.isDestroyed) return;

    managed.status = "RECONNECTING";
    
    if (managed.client) {
      managed.client.close().catch(() => {});
      managed.client = null;
    }

    const backoffTime = Math.min(1000 * Math.pow(2, managed.reconnectAttempts), 30000);
    managed.reconnectAttempts++;

    this.logger.info("ClientManager", `Scheduling reconnect for ${id} in ${backoffTime}ms (Attempt ${managed.reconnectAttempts})`);

    managed.connectingPromise = new Promise((resolve) => {
      managed.reconnectTimeout = setTimeout(async () => {
        managed.reconnectTimeout = undefined;
        if (this.isDestroyed) { resolve(undefined); return; }
        const current = this.clients.get(id);
        if (!current || current.status !== "RECONNECTING") { resolve(undefined); return; }

        try {
          const client = await this.createTransportAndConnect(id, current.config, current.isTenantContext);
          if (client) {
             current.client = client;
             current.status = "CONNECTED";
             current.reconnectAttempts = 0;
             this.logger.info("ClientManager", `Successfully reconnected downstream: ${id}`);
             resolve(client);
          } else {
             throw new UpstreamConnectionError("createTransport returned null");
          }
        } catch (e: any) {
          this.logger.error("ClientManager", `Reconnect failed for ${id}: ${e.message}`);
          resolve(undefined);
          this.triggerReconnect(id);
        } finally {
          current.connectingPromise = undefined;
        }
      }, backoffTime);
      
      /* istanbul ignore next */
      if (managed.reconnectTimeout?.unref) {
          managed.reconnectTimeout.unref();
      }
    });
  }

  private async removeClient(id: string) {
    const managed = this.clients.get(id);
    if (managed) {
      managed.status = "DISCONNECTED";
      if (managed.client) {
        try {
          await managed.client.close();
        } catch (e: any) {
          this.logger.error("ClientManager", `Error closing client ${id}: ${e.message}`);
        }
      }
      this.clients.delete(id);
      this.logger.info("ClientManager", `Removed downstream client: ${id}`);
    }
  }

  private async addClient(id: string, config: McpServerConfig) {
    this.clients.set(id, {
        client: null,
        config,
        status: "DISCONNECTED_IDLE",
        reconnectAttempts: 0,
        lastAccessed: Date.now(),
        isTenantContext: false
    });
    this.logger.info("ClientManager", `Registered downstream config for ${id}. (Awaiting JIT connection)`);
  }

  private async createTransportAndConnect(id: string, config: McpServerConfig, isTenantContext: boolean = false): Promise<Client | null> {
    const client = new Client(
      { name: "mcp-proxy-client", version: "1.0.0" },
      { capabilities: {} }
    );

    let transport;

    if (config.transport === "stdio") {
      if (isTenantContext) {
        const sys = this.configStore.getConfig()?.system;
        if (!sys?.allowStdio) {
            throw new AagConfigurationError(`Disallowed transport: 'stdio' is disabled for tenant-provided MCP servers.`);
        }
      }

      const stdioConfig = config as McpStdioConfig;
      const env: Record<string, string> = Object.assign({}, process.env, stdioConfig.env) as Record<string, string>;
      
      if (config.authInjection?.type === "env" && config.authInjection.key) {
        env[config.authInjection.key] = await this.secretStore.resolveSecret(config.authInjection.value || "") || "";
      }

      transport = new StdioClientTransport({
        command: stdioConfig.command,
        args: stdioConfig.args,
        env
      });
    } else if (config.transport === "sse") {
      const sseConfig = config as McpSseConfig;
      const headers: Record<string, string> = {};
      
      if (config.authInjection?.type === "header" && config.authInjection.headerName) {
        headers[config.authInjection.headerName] = await this.secretStore.resolveSecret(config.authInjection.value || "") || "";
      }

      transport = new SSEClientTransport(new URL(sseConfig.url), {
        requestInit: { headers },
        eventSourceInit: { headers } as any
      });
    } else if (config.transport === "http") {
      const httpConfig = config as McpHttpConfig;
      const headers: Record<string, string> = {};
      
      if (config.authInjection?.type === "header" && config.authInjection.headerName) {
        headers[config.authInjection.headerName] = await this.secretStore.resolveSecret(config.authInjection.value || "") || "";
      }

      transport = new StreamableHTTPClientTransport(new URL(httpConfig.url), {
        requestInit: { headers }
      });
    }

    if (transport) {
      await client.connect(transport);
      return client;
    }
    return null;
  }

  private getTenantScopeId(auth: AuthKey): string {
      return auth.tenantId || auth.key || "anonymous";
  }

  private async _resolveJIT(id: string, managed: ManagedClient): Promise<Client | undefined> {
    managed.lastAccessed = Date.now();

    if (managed.status === "CONNECTED" && managed.client) {
        return managed.client;
    }

    if (managed.status === "DISCONNECTED" || managed.status === "DISCONNECTED_IDLE") {
        managed.status = "RECONNECTING";
        managed.connectingPromise = (async () => {
            try {
                const client = await this.createTransportAndConnect(id, managed.config, !!managed.isTenantContext);
                if (client) {
                    managed.client = client;
                    managed.status = "CONNECTED";
                    managed.reconnectAttempts = 0;
                    this.logger.info("ClientManager", `JIT connection established for: ${id} (Tenant Context: ${!!managed.isTenantContext})`);
                    return client;
                } else {
                    throw new UpstreamConnectionError(`Unsupported or null transport connection for: ${id}`);
                }
            } catch (e: any) {
                this.logger.error("ClientManager", `JIT connection failed for ${id}: ${e.message}`);
                managed.status = "DISCONNECTED";
                throw e;
            } finally {
                managed.connectingPromise = undefined;
            }
        })();
        return managed.connectingPromise;
    }

    if (managed.status === "RECONNECTING") {
        if (managed.connectingPromise) {
            return managed.connectingPromise;
        }
        throw new UpstreamConnectionError(`Client ${id} is stuck reconnecting without a lock`);
    }

    return undefined;
  }

  public getClient(id: string, auth?: AuthKey): Client | undefined {
    let managed = this.clients.get(id);
    if (!managed && auth && auth.mcpServers && auth.mcpServers[id]) {
       const scopeId = this.getTenantScopeId(auth);
       managed = this.clients.get(`${scopeId}::${id}`);
    }

    if (managed) {
        managed.lastAccessed = Date.now();
        return managed.status === "CONNECTED" && managed.client ? managed.client : undefined;
    }
    return undefined;
  }

  public async getClientJIT(id: string, auth?: AuthKey): Promise<Client | undefined> {
    const globalManaged = this.clients.get(id);
    if (globalManaged && !globalManaged.isTenantContext) {
        return this._resolveJIT(id, globalManaged);
    }

    if (auth && auth.mcpServers && auth.mcpServers[id]) {
        const scopeId = this.getTenantScopeId(auth);
        const scopedId = `${scopeId}::${id}`;
        
        let tenantManaged = this.clients.get(scopedId);
        const newConfigStr = JSON.stringify(auth.mcpServers[id]);
        
        if (tenantManaged && JSON.stringify(tenantManaged.config) !== newConfigStr) {
            await this.removeClient(scopedId);
            tenantManaged = undefined;
        }
        
        if (!tenantManaged) {
             tenantManaged = {
                client: null,
                config: auth.mcpServers[id],
                status: "DISCONNECTED_IDLE",
                reconnectAttempts: 0,
                lastAccessed: Date.now(),
                isTenantContext: true
             };
             this.clients.set(scopedId, tenantManaged);
        }
        
        return this._resolveJIT(scopedId, tenantManaged);
    }

    return undefined;
  }

  public getClientStatus(id: string, auth?: AuthKey): ClientStatus | undefined {
    let managed = this.clients.get(id);
    if (!managed && auth && auth.mcpServers && auth.mcpServers[id]) {
       const scopeId = this.getTenantScopeId(auth);
       managed = this.clients.get(`${scopeId}::${id}`);
    }
    return managed?.status;
  }

  public async getClientsJIT(auth?: AuthKey): Promise<Map<string, Client>> {
    const map = new Map<string, Client>();
    
    for (const [id, managed] of this.clients.entries()) {
      if (!managed.isTenantContext) {
         try {
           const client = await this.getClientJIT(id, auth);
           if (client) map.set(id, client);
         } catch(e) {}
      }
    }
    
    if (auth && auth.mcpServers) {
        for (const id of Object.keys(auth.mcpServers)) {
            try {
                const client = await this.getClientJIT(id, auth);
                if (client) map.set(id, client);
            } catch(e) {}
        }
    }
    
    return map;
  }
  
  public getClients(): Map<string, Client> {
    const map = new Map<string, Client>();
    for (const [id, managed] of this.clients.entries()) {
      if (!managed.isTenantContext && managed.status === "CONNECTED" && managed.client) {
        map.set(id, managed.client);
      }
    }
    return map;
  }
  
  public destroy() {
     this.isDestroyed = true;
     if (this.pingInterval) clearInterval(this.pingInterval);
     for (const id of this.clients.keys()) {
         this.removeClient(id).catch(()=>{});
     }
  }
}
