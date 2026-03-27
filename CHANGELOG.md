# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-03-27

### Added
- **Plugin Ecosystem**: Introduced `IPlugin` interface and dynamic `PluginLoader`, decoupling `RateLimitMiddleware` and `DataMaskingMiddleware` into standard plugins. This architecture allows administrators to configure extensible third-party community extensions dynamically, perfectly isolating multi-user `pluginConfig` variables per `aiId` without rebuilding the core.
- **Dynamic Connection Interruption**: Introduced an active `SessionManager` class that monitors `configChanged` events from `IConfigStore`. It gracefully and forcefully terminates established 'Active SSE Sessions' and underlying Stdio runtimes instantly whenever an administrator revokes an AI identity's credential.
- **Distributed Rate Limiting via `IRateLimitStore`**: Extracted the Token Bucket counter logic out of `RateLimitMiddleware` into an injectable `IRateLimitStore` interface. This allows systems to natively implement distributed storage backends (e.g. Redis evaluation scripts) for perfectly synchronized multi-pod horizontal scaling without race conditions. Also includes a localized `MemoryRateLimitStore` default fallback.

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