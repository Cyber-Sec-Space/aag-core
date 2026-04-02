import { AuthKey } from "../config/types.js";

export interface ProxyContext {
    /** The downstream target server identifier (e.g. 'github') */
    serverId: string;
    /** The actual downstream tool name (e.g. 'search_repositories') */
    toolName: string;
    /** The authenticated identifier of the AI agent making the proxy request */
    aiId: string;
    /** The fully-resolved authenticated identity profile */
    auth: AuthKey;
}

export interface ProxyMiddleware {
    /**
     * Executes dynamically before proxying the request downstream.
     * Use this hook to inject, validate, or transform request arguments.
     * @param context The current execution context (Server ID, Tool Name, AI ID)
     * @param args The intercepted input arguments provided by the AI client
     * @returns The resulting arguments to forward (must be an object or identical type)
     */
    onRequest?: (context: ProxyContext, args: any) => Promise<any> | any;
    
    /**
     * Executes dynamically before returning the result to the AI Client.
     * Use this hook to redact or format sensitive tool output contents.
     * @param context The current execution context (Server ID, Tool Name, AI ID)
     * @param result The intercepted raw result from the downstream MCP server
     * @returns The resulting transformed CallToolResult
     */
    onResponse?: (context: ProxyContext, result: any) => Promise<any> | any;
}
