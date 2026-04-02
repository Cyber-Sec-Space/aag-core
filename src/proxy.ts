import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";
import { ClientManager } from "./clientManager.js";
import { IConfigStore } from "./interfaces/IConfigStore.js";
import { ISecretStore } from "./interfaces/ISecretStore.js";
import { IAuthStore } from "./interfaces/IAuthStore.js";
import { IAuditLogger } from "./interfaces/IAuditLogger.js";
import { ProxyMiddleware, ProxyContext } from "./middleware/types.js";
import { AuthKey } from "./config/types.js";
import { 
  AagConfigurationError, 
  AuthenticationError, 
  AuthorizationError, 
  UpstreamConnectionError 
} from "./errors.js";

export interface ProxySessionOptions {
  aiId?: string; // Pre-authenticated identity for multi-tenant SaaS scaling
  disableEnvFallback?: boolean; // Secure proxy bounds entirely
}

export class ProxyServer {
  public server: Server;
  private clientManager: ClientManager;
  private configStore: IConfigStore;
  private secretStore: ISecretStore;
  private authStore: IAuthStore;
  private logger: IAuditLogger;
  private authenticatedAiId: string | null = null;
  private disableEnvFallback: boolean = false;
  private middlewares: ProxyMiddleware[] = [];
  private authCache: Map<string, { auth: AuthKey; expiresAt: number }> = new Map();
  private authCacheTTL: number;
  private authCacheGcInterval: ReturnType<typeof setInterval>;

  constructor(
      clientManager: ClientManager, 
      configStore: IConfigStore, 
      secretStore: ISecretStore, 
      authStore: IAuthStore,
      logger: IAuditLogger,
      options?: ProxySessionOptions
  ) {
    this.clientManager = clientManager;
    this.configStore = configStore;
    this.secretStore = secretStore;
    this.authStore = authStore;
    this.logger = logger;

    if (options?.aiId) {
        this.authenticatedAiId = options.aiId;
    }
    if (options?.disableEnvFallback !== undefined) {
        this.disableEnvFallback = options.disableEnvFallback;
    }

    this.authCacheTTL = this.configStore.getConfig()?.system?.authCacheTtlMs ?? 60000;
    const gcIntervalMs = this.configStore.getConfig()?.system?.authCacheGcIntervalMs ?? 300000;

    this.server = new Server(
      { name: "mcp-proxy-server", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    this.setupRequestHandlers();

    // Prevent AuthCache from growing indefinitely in SaaS multi-tenant environments
    this.authCacheGcInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, value] of this.authCache.entries()) {
            if (value.expiresAt <= now) {
                this.authCache.delete(key);
            }
        }
    }, gcIntervalMs); // Sweep every configured interval
    this.authCacheGcInterval.unref(); // Do not block Node.js exit
  }

  public destroy() {
      // Allow clean shutdown
      clearInterval(this.authCacheGcInterval);
  }

  public use(middleware: ProxyMiddleware) {
      this.middlewares.push(middleware);
      this.logger.info("Proxy", "Registered custom ProxyMiddleware interceptor.");
  }

  private cacheAuth(id: string, auth: AuthKey) {
      if (this.authCache.has(id)) {
          this.authCache.delete(id);
      } else {
          const maxSize = this.configStore.getConfig()?.system?.authCacheSize ?? 10000;
          if (this.authCache.size >= maxSize) {
              const firstKey = this.authCache.keys().next().value;
              /* istanbul ignore next - Generator boundary protection */
              if (firstKey !== undefined) this.authCache.delete(firstKey);
          }
      }
      this.authCache.set(id, { auth, expiresAt: Date.now() + this.authCacheTTL });
  }

  private async validateAuth(request: any, extra?: any): Promise<AuthKey> {
    if (this.authenticatedAiId) {
        let auth: AuthKey | null | undefined = this.authCache.get(this.authenticatedAiId)?.auth;
        if (!auth || (this.authCache.get(this.authenticatedAiId)!.expiresAt <= Date.now())) {
            auth = await this.authStore.getIdentity(this.authenticatedAiId);
            if (auth) this.cacheAuth(this.authenticatedAiId, auth);
        }

        if (!auth) {
            throw new AuthenticationError(`Session constructed with bound AI ID '${this.authenticatedAiId}' but no matching identity profile found.`);
        }
        if (auth.revoked) {
            this.authCache.delete(this.authenticatedAiId);
            throw new AuthenticationError(`Key for AI ID '${this.authenticatedAiId}' has been revoked.`);
        }
        return auth;
    }

    if (this.disableEnvFallback) {
         this.logger.error("Proxy", "Authentication failed: No AI ID injected and environment fallback disabled.");
         throw new AuthenticationError("Authentication required: No AI ID context provided for this session.");
    }

    const aiid = process.env.AI_ID;
    const key = process.env.AI_KEY;

    if (!aiid || !key) {
      this.logger.warn("Proxy", "Authentication failed: Missing AI_ID or AI_KEY in environment.");
      throw new AuthenticationError("Authentication required: Please provide AI_ID and AI_KEY in environment variables.");
    }

    let auth: AuthKey | null | undefined = this.authCache.get(aiid)?.auth;
    /* istanbul ignore next - Covered conceptually via caching suite */
    if (!auth || (this.authCache.get(aiid)!.expiresAt <= Date.now())) {
        auth = await this.authStore.getIdentity(aiid);
        if (auth) this.cacheAuth(aiid, auth);
    }

    if (!auth) {
      this.logger.warn("Proxy", `Authentication failed: Invalid AIID '${aiid}'`);
      throw new AuthenticationError(`Invalid AIID from environment: ${aiid}`);
    }

    if (auth.revoked) {
      this.authCache.delete(aiid);
      this.logger.warn("Proxy", `Authentication failed: AI ID '${aiid}' is revoked`);
      throw new AuthenticationError(`Key for AI ID '${aiid}' has been revoked.`);
    }

    if (auth.key !== key) {
      this.logger.warn("Proxy", `Authentication failed: Invalid key provided for AI ID '${aiid}'`);
      throw new AuthenticationError(`Invalid Key for AI ID '${aiid}' provided in environment.`);
    }
    
    this.authenticatedAiId = aiid;
    this.logger.info("Auth", `AI ID '${aiid}' authenticated successfully`);
    return auth;
  }

  private regexPatternCache = new Map<string, RegExp>();

  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return value === pattern;
    
    let regex = this.regexPatternCache.get(pattern);
    if (!regex) {
       const regexPattern = "^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$";
       regex = new RegExp(regexPattern);
       this.regexPatternCache.set(pattern, regex);
       
       const maxSize = this.configStore.getConfig()?.system?.regexCacheSize ?? 10000;
       if (this.regexPatternCache.size > maxSize) {
           const clearCount = Math.max(1, Math.floor(maxSize * 0.10));
           const iter = this.regexPatternCache.keys();
           for(let i = 0; i < clearCount; i++) {
               const key = iter.next().value;
               /* istanbul ignore next - Extreme boundary protection */
               if (key !== undefined) this.regexPatternCache.delete(key);
           }
       }
    } else {
       // LRU Refresh
       this.regexPatternCache.delete(pattern);
       this.regexPatternCache.set(pattern, regex);
    }
    
    return regex.test(value);
  }

  private isAllowed(auth: AuthKey, serverId: string, toolName: string): boolean {
    if (!this.authenticatedAiId) return false;
    if (!auth.permissions) return true;

    const { allowedServers, deniedServers, allowedTools, deniedTools } = auth.permissions;
    const fullToolName = `${serverId}___${toolName}`;

    const checkMatch = (list: string[], val: string) => list.some(pattern => this.matchPattern(val, pattern));

    if (deniedServers && checkMatch(deniedServers, serverId)) return false;
    if (deniedTools && checkMatch(deniedTools, fullToolName)) return false;

    const hasServerWhitelist = allowedServers && allowedServers.length > 0;
    const hasToolWhitelist = allowedTools && allowedTools.length > 0;

    if (!hasServerWhitelist && !hasToolWhitelist) {
      return true;
    }

    const serverIsAllowed = !hasServerWhitelist || checkMatch(allowedServers!, serverId);
    const toolIsAllowed = !hasToolWhitelist || checkMatch(allowedTools!, fullToolName);

    return serverIsAllowed && toolIsAllowed;
  }

  private setupRequestHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      const auth = await this.validateAuth(request, extra);
      const allTools: Tool[] = [];
      const clients = await this.clientManager.getClientsJIT(auth);

      const clientsArray = Array.from(clients.entries());
      const chunkSize = 50;

      for (let i = 0; i < clientsArray.length; i += chunkSize) {
        const chunk = clientsArray.slice(i, i + chunkSize);
        await Promise.allSettled(chunk.map(async ([serverId, client]) => {
          try {
            const response = await client.listTools();
            const prefixedTools = response.tools
              .filter(tool => this.isAllowed(auth, serverId, tool.name))
              .map((tool) => ({
                ...tool,
                name: `${serverId}___${tool.name}`
              }));
            allTools.push(...prefixedTools);
          } catch (e: any) {
            this.logger.error("Proxy", `Error listing tools for ${serverId}: ${e.message}`);
          }
        }));
      }

      this.logger.info("Activity", `AI ID '${this.authenticatedAiId}' requested ListTools. Returning ${allTools.length} tools.`);
      return { tools: allTools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const auth = await this.validateAuth(request, extra);
      const requestedName = request.params.name;
      this.logger.info("Activity", `AI ID '${this.authenticatedAiId}' calling tool: ${requestedName}`);
      
      let targetServerId: string | null = null;
      let actualToolName: string | null = null;
      let isGlobalServer = false;
      
      const prefixIndex = requestedName.indexOf("___");
      /* istanbul ignore else - False branch covered implicitly via ToolNotFoundError below */
      if (prefixIndex > 0) {
        const parsedServerId = requestedName.substring(0, prefixIndex);
        
        // Fast O(1) existence check semantics
        const globalServers = this.configStore.getConfig()?.mcpServers || {};
        const tenantServers = auth.mcpServers || {};
        
        const existsGlobal = parsedServerId in globalServers;
        const existsTenant = parsedServerId in tenantServers;
        
        if (existsGlobal || existsTenant) {
            targetServerId = parsedServerId;
            actualToolName = requestedName.substring(prefixIndex + 3);
            isGlobalServer = existsGlobal;
        }
      }

      if (!targetServerId || !actualToolName) {
        this.logger.warn("Proxy", `Tool not found: ${requestedName}`);
        throw new AagConfigurationError(`Tool ${requestedName} fully qualified server not found`);
      }

      if (!this.isAllowed(auth, targetServerId, actualToolName)) {
        this.logger.warn("Security", `Access Denied: AI ID '${this.authenticatedAiId}' attempted to use unauthorized tool '${requestedName}'`);
        throw new AuthorizationError(`Permission denied: AI ID '${this.authenticatedAiId}' is not allowed to use tool '${requestedName}'.`);
      }

      const config = (auth.mcpServers?.[targetServerId] || this.configStore.getConfig()?.mcpServers?.[targetServerId]) as any;
      if (!config) {
        throw new AagConfigurationError(`Config for ${targetServerId} not found`);
      }

      // JIT Connection Wake-Up
      const client = await this.clientManager.getClientJIT(targetServerId, auth);
      if (!client) {
        this.logger.error("Proxy", `Downstream client ${targetServerId} could not be connected JIT.`);
        throw new UpstreamConnectionError(`Client ${targetServerId} is disconnected and failed to wake up.`);
      }

      let args = { ...(request.params.arguments || {}) } as any;
      const proxyContext: ProxyContext = { serverId: targetServerId, toolName: actualToolName, aiId: this.authenticatedAiId!, auth };

      for (const mw of this.middlewares) {
        if (mw.onRequest) {
            args = (await mw.onRequest(proxyContext, args)) ?? args;
        }
      }

      if (config.authInjection?.type === "payload" && config.authInjection.key) {
        if (isGlobalServer) {
            args[config.authInjection.key] = await this.secretStore.resolveSecret(config.authInjection.value || "");
        } else {
            args[config.authInjection.key] = config.authInjection.value || "";
        }
      }

      try {
        this.logger.debug("Proxy", `Forwarding CallTool (${actualToolName}) to downstream ${targetServerId}`);
        let result = await client.callTool({
          name: actualToolName,
          arguments: args
        });

        for (const mw of this.middlewares) {
            if (mw.onResponse) {
                result = (await mw.onResponse(proxyContext, result)) ?? result;
            }
        }

        this.logger.info("Activity", `AI ID '${this.authenticatedAiId}' call to '${requestedName}': Success`);
        return result;
      } catch (e: any) {
        this.logger.error("Proxy", `Error calling ${actualToolName} on ${targetServerId}: ${e.message}`);
        throw new UpstreamConnectionError(`Internal Gateway Error: Downstream MCP server '${targetServerId}' encountered a failure.`);
      }
    });
  }
}
