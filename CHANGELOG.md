# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-03-31

### Added
- **Multi-Tenant BYO-MCP (Bring Your Own MCP)**: Upgraded `AuthKeySchema` and `ClientManager` to support tenant-specific MCP server definitions dynamically (`auth.mcpServers`). This allows users/tenants in a SaaS environment to connect their own private MCP servers seamlessly without restarting the core gateway.
- **Tenant Scope Isolation (`tenantId`)**: Introduced `tenantId` property in `AuthKeySchema` which instructs the `ClientManager` to group and share JIT connection pools across all `aiId`s belonging to the same tenant. Achieves zero-redundancy O(1) connection sharing.
- **RCE Security Gate (`allowStdio`)**: Implemented a system-wide `allowStdio` toggle in `SystemConfigSchema` (default: `false`). This acts as a hard boundary preventing SaaS tenants from defining `stdio` transports, effectively securing the host instance against Remote Code Execution (RCE) vectors while empowering HTTP/SSE based decoupled integrations.

### Fixed
- **O(1) Memory & Routing Extractor**: Separated `globalServerIds` into an explicit Set inside `ClientManager`. This drops `getClientsJIT` routing complexity from O(N) back down to true O(1), preventing event-loop freezing when querying multi-tenant connection pools exceeding 500,000 instances.
- **OOM Protection (Regex LRU Cache)**: Swapped infinite static `regexPatternCache` with a configurable LRU Cache (adjustable via `system.regexCacheSize` default 10,000). Completely prevents memory leak vulnerabilities orchestrated by SaaS users transmitting infinite combinations of dynamic string rules.
- **100k SaaS Thundering Herd Ping Starvation**: Abolished the `setInterval` burst health check daemon. Rewrote the polling system utilizing a Continuous Sweeper (`sweepLoop`) that dynamically applies jittered Sleep slices proportional to network density, natively distributing Pings across the entire lifespan without network flooding or OS FD exhaustion.
## [2.2.0] - 2026-03-28

### Added
- **Asynchronous Identity Resolution (`IAuthStore`)**: Decoupled identity lookups from static configuration. Implemented `IAuthStore` interface and `ConfigAuthStore` adapter for backward compatibility. Refactored `ProxyServer.validateAuth()` to be `async`, allowing JIT identity fetching from external databases/services.
- **Pure SaaS Mode (`aiKeys` Optional)**: Updated `ProxyConfigSchema` to make `aiKeys` optional, allowing the system to operate in pure SaaS mode where identities are managed externally via `IAuthStore`.
- **Session Revocation Targeting**: Refactored `SessionManager` to selectively terminate target `aiId` connections gracefully (`disconnectSession(aiId)`), significantly mitigating resource leakage across global instances vs recursive polling.
- **Middleware ProxyContext Auth Injection**: Decoupled `RateLimitMiddleware` and `DataMaskingMiddleware` from static `IConfigStore` identity lookups. `ProxyContext` now injects the pre-resolved `AuthKey` identity object directly into downstream plugins, enabling zero-latency SaaS scaling and eliminating dependency coupling.
- **High-Concurrency Regex Caching**: Introduced `Map`-based RegExp caching in `ProxyServer` (for wildcard tool permissions) and `DataMaskingMiddleware` (for dynamic regex string masking). This achieves `O(1)` runtime complexity for tenant-specific policy evaluation, preventing NodeJS event loop blocking (DoS vector) when servicing 10,000+ simultaneous connections over complex rule sets.

- **Trace Level Logging**: Expanded the `IAuditLogger` interface with a mathematically granular `trace()` log level intended to isolate high-density data streaming (such as upcoming Cloud Model Proxy evaluations) separately from the standard `debug()` or `info()` outputs.
- **Future-Proof RBAC Parameters**: Appended `allowedPrompts`, `deniedPrompts`, `allowedResources`, and `deniedResources` conditionally onto the `AuthKeySchema.permissions` layer to gracefully prepare the multi-tenant validation pipeline for exhaustive MCP Protocol scaling.
- **Zod Runtime Schema Validation**: Enforced strict `ProxyConfigSchema.parse()` evaluations natively during Core proxy execution and config synchronization (`syncConfig()`). This reliably catches malformed Host application JSON structures dynamically before they reach downstream pipes, safely returning HTTP 500 boundaries.
- **Typed Error Ecosystem**: Established HTTP-compatible, domain-specific `AagError` hierarchies (`AagConfigurationError`, `RateLimitExceededError`, `UpstreamConnectionError`, `AuthenticationError`, `AuthorizationError`). Host applications can now `catch` typed exceptions and react cleanly without parsing generic JavaScript string messages.

### Fixed
- **SaaS Mass Disconnect**: Removed the legacy `aiKeys` array sync listener from `SessionManager`. Connection revocations are now explicitly driven via `disconnectAll()`, fixing a critical bug that caused valid Hybrid SaaS tenants to be mass disconnected when static configs were reloaded.
- **Multi-Tenant Config Isolation**: Remedied a functional defect in `DataMaskingPlugin` where the middleware failed to poll `IConfigStore` dynamically, causing all AI clients to permanently inherit the global masking rules rather than their distinct, isolated `pluginConfig` overrides.
- **OOM Memory Leak**: Addressed a severe infinite memory growth vulnerability in `MemoryRateLimitStore` where inactive Token Buckets and Promises were never garbage collected. Implemented a non-blocking `setInterval.unref()` sweep.
- **Event Loop Thread Leak**: Resolved an issue causing Node.js worker processes (and Jest tests) to fail to gracefully exit at process termination. Extracted internal Ping Daemon (`setInterval`) and Reconnection Backoff (`setTimeout`) contexts in `ClientManager` to uniquely utilize V8's native `.unref()` detaching to prevent memory and thread deadlocks without altering Promise behavior.
- **Coverage Excellence**: Enforced an absolute 100% testing coverage standard across Statement, Branch, Function, and Line evaluations throughout all middlewares array and Core pipeline managers.
- **Documentation**: Added critical Multi-Tenant Cross-State pollution and SSRF vulnerability bounds to the `ARCHITECTURE.md` and `README.md`.

## [2.1.0] - 2026-03-27

### Added
- **Plugin Ecosystem**: Introduced `IPlugin` interface and dynamic `PluginLoader`, decoupling `RateLimitMiddleware` and `DataMaskingMiddleware` into standard plugins. This architecture allows administrators to configure extensible third-party community extensions dynamically, perfectly isolating multi-user `pluginConfig` variables per `aiId` without rebuilding the core.
- **Dynamic Connection Interruption**: Introduced an active `SessionManager` class that monitors `configChanged` events from `IConfigStore`. It gracefully and forcefully terminates established 'Active SSE Sessions' and underlying Stdio runtimes instantly whenever an administrator revokes an AI identity's credential.
- **Distributed Rate Limiting via `IRateLimitStore`**: Extracted the Token Bucket counter logic out of `RateLimitMiddleware` into an injectable `IRateLimitStore` interface. This allows systems to natively implement distributed storage backends (e.g. Redis evaluation scripts) for perfectly synchronized multi-pod horizontal scaling without race conditions. Also includes a localized `MemoryRateLimitStore` default fallback.
- **Configurable Downstream Timeouts**: Extracted hardcoded networking proxy daemon variables into `SystemConfigSchema` (`pingIntervalMs`, `pingTimeoutMs`, `idleTimeoutMs`, `reconnectTimeoutMs`).

### Fixed
- **Security**: Mitigated a Regular Expression Denial of Service (ReDoS) vulnerability by overriding the transitive dependency `path-to-regexp` to `^8.4.0`.
- **JIT Connection Pooling Mutex**: Solved a major resource bottleneck by implementing a `connectingPromise` Mutex in `ClientManager`, preventing Serverless/SaaS `getClientJIT` concurrent polling storms.
- **Error Sandboxing**: Masked downstream `CallTool` errors in `ProxyServer` as 'Internal Gateway Error's to prevent backend infrastructural stack-trace leaks to AI clients.
- **Memory Token Bucket Thread Safety**: Added asynchronous execution locks to `MemoryRateLimitStore` for robust race-condition immunity.
- **Session Manager Cleanup Warning**: Documented necessary `SessionManager.unregister()` garbage collection instructions for Host implementors to avoid memory leaks.

## [2.0.0] - 2026-03-26

This major release transforms the core engine structurally to natively support clustered deployments, infinite horizontal scalability, and true zero-downtime stateless concurrency without breaking standalone CLI compatibilities.

### Added
- **Multi-User Architecture**: Refactored `ProxyServer` into a dynamic `ProxySession` mapping, stripping away `process.env` hard dependencies to support concurrent multi-user routing from a single Node.js runtime via `ProxySessionOptions`.
- **Scale-to-Zero JIT Connectors (Phase 2)**: Overhauled `ClientManager` to eagerly suspend downstream MCP connections into an LRU cache (`DISCONNECTED_IDLE`). Connections are lazily awakened (Just-In-Time) when AI clients invoke tools, severely reducing memory footprint for large deployments.
- **Stateful Interfaces (Phase 3)**: Extracted memory maps out of `RateLimitMiddleware`, introducing external `IStateStore` parameters. This unlocks multi-node, clustered Rate Limiting leveraging Redis bindings natively via the CLI environment.
- **100% Core Logic Coverage (Phase 4)**: Extended deep-mock testing framework achieving complete 100% line execution coverage over all Pipeline Middlewares, `ClientManager` ping daemons, and `ProxyServer` bounds.
- **Resilient Edge Case Handlers**: Enforced rigorous simulated fault-tolerance verifications for downstream client exceptions, HTTP token configurations, and missing fallback paths.

## [1.0.3] - 2026-03-26

### Added
- **Dynamic Config-Driven Rate Limiting**: `RateLimitMiddleware` now accepts an optional `IConfigStore` parameter via dependency injection, allowing live rate limitation variables to automatically track individual AI authentication profiles (`aiKeys.[aiId].rateLimit.rpm`) within the store's latest memory struct.


## [1.0.2] - 2026-03-26

### Added
- **In-Memory Rate Limiting**: Introduced `RateLimitMiddleware` leveraging the Token Bucket algorithm to control request frequency per AI ID.
- **Enhanced Middleware Exports**: Standardized all built-in middlewares (`DataMaskingMiddleware`, `RateLimitMiddleware`) and their types as exports from the main package entry.

## [1.0.1] - 2026-03-26

### Added
- **Proxy Middleware Interceptors**: Programmatic pipeline (`ProxyMiddleware`) enabling dynamic `onRequest` and `onResponse` payload mutation.
- **Data Masking Library**: Built-in `DataMaskingMiddleware` to intuitively sanitize PII from LLM tool responses using Regex.
- **Client Manager Hardening**: Robust transport layer multiplex connection pooling via `syncConfig`.
- **Keep-Alive Daemon**: Active background 30-second `client.ping` routines continuously monitoring downstream server health.
- **Auto-Reconnect (Exponential Backoff)**: Automatic scaling retry strategy (`2s, 4s, 8s, up to 30s`) targeting dropped downstream connections to avoid CPU congestion.
- **Fail-Fast Defense**: Proxy routing immediately cleanly rejects execution commands mapped to downstream servers actively labeled as `RECONNECTING`.
- **Wildcard Allow/Deny Roles**: Upgraded `isAllowed` RBAC configurations to support glob wildcards (`*`) for fine-grained tool boundaries (e.g., `github___search_*`).
- **Jest Test Suite**: Achieved full core coverage via ES modules / `ts-jest` for `ClientManager` connections and `ProxyServer` security bounds.

### Changed
- **License**: Relicensed `@cyber-sec.space/aag-core` standalone repository from MIT to AGPL-3.0.
- **Compilation**: Refined `tsconfig.json` configurations (`NodeNext` module resolution) and prepared `package.json` configurations for public NPM distribution.


## [1.0.0] - 2026-03-25