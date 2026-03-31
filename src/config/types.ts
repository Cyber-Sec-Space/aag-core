import { z } from "zod";

export const AuthInjectionSchema = z.object({
  type: z.enum(["none", "env", "header", "payload"]),
  key: z.string().optional(), // For payload or env
  value: z.string().optional(), // The value mapping (e.g. $AI_KEY or keytar://)
  headerName: z.string().optional() // For SSE headers
});

export const StdioServerSchema = z.object({
  transport: z.literal("stdio").optional().default("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional(),
  authInjection: AuthInjectionSchema.optional()
});

export const SseServerSchema = z.object({
  transport: z.literal("sse"),
  url: z.string().startsWith("http", { message: "URL must begin with http:// or https://" }),
  authInjection: AuthInjectionSchema.optional()
});

export const HttpServerSchema = z.object({
  transport: z.literal("http"),
  url: z.string().startsWith("http", { message: "URL must begin with http:// or https://" }),
  authInjection: AuthInjectionSchema.optional()
});

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
  StdioServerSchema.extend({ transport: z.literal("stdio") }),
  SseServerSchema,
  HttpServerSchema
]);

export type McpStdioConfig = z.infer<typeof StdioServerSchema>;
export type McpSseConfig = z.infer<typeof SseServerSchema>;
export type McpHttpConfig = z.infer<typeof HttpServerSchema>;
export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig;

export const AuthKeySchema = z.object({
  key: z.string().optional(),
  description: z.string().optional(),
  tenantId: z.string().optional(),
  createdAt: z.string().optional(),
  revoked: z.boolean().default(false),
  permissions: z.object({
    allowedServers: z.array(z.string()).optional(),
    deniedServers: z.array(z.string()).optional(),
    allowedTools: z.array(z.string()).optional(),
    deniedTools: z.array(z.string()).optional(),
    allowedPrompts: z.array(z.string()).optional(),
    deniedPrompts: z.array(z.string()).optional(),
    allowedResources: z.array(z.string()).optional(),
    deniedResources: z.array(z.string()).optional(),
  }).optional(),
  rateLimit: z.object({
    rpm: z.number().int().nonnegative().optional(), // Requests Per Minute
    rph: z.number().int().nonnegative().optional()  // Requests Per Hour
  }).optional(),
  pluginConfig: z.record(z.string(), z.any()).optional().default({}),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional()
});

export const SystemConfigSchema = z.object({
  port: z.number().int().min(0).max(65535).default(3000),
  logLevel: z.enum(["INFO", "WARN", "ERROR", "DEBUG", "TRACE"]).default("INFO"),
  allowStdio: z.boolean().default(false),
  pingIntervalMs: z.number().int().positive().optional().default(30000),
  pingTimeoutMs: z.number().int().positive().optional().default(5000),
  idleTimeoutMs: z.number().int().positive().optional().default(300000),
  reconnectTimeoutMs: z.number().int().positive().optional().default(5000),
  regexCacheSize: z.number().int().positive().optional().default(10000)
});

export const PluginConfigSchema = z.object({
  name: z.string(),
  options: z.record(z.string(), z.any()).optional().default({})
});

export const ProxyConfigSchema = z.object({
  masterKey: z.string().optional(),
  plugins: z.array(PluginConfigSchema).optional().default([]),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional().default({}),
  aiKeys: z.record(z.string(), AuthKeySchema).optional().default({})
});

export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;
export type SystemConfig = z.infer<typeof SystemConfigSchema>;
export type AuthKey = z.infer<typeof AuthKeySchema>;
export type PluginConfig = z.infer<typeof PluginConfigSchema>;
