# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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