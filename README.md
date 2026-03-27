# AI Auth Gateway Core (`@cyber-sec.space/aag-core`)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Coverage](https://img.shields.io/badge/Coverage-100%25-brightgreen.svg)](https://jestjs.io/)
[![Version](https://img.shields.io/npm/v/@cyber-sec.space/aag-core.svg)](https://www.npmjs.com/package/@cyber-sec.space/aag-core)

**[English](#english)** | **[中文](#chinese)** | **[Changelog](CHANGELOG.md)**

---

<a id="english"></a>
## English

`aag-core` is the core engine for the AI Auth Gateway v2. It provides a robust, protocol-agnostic, **Scale-to-Zero SaaS-oriented** proxy for the Model Context Protocol (MCP), handling infinite downstream JIT connections, authentications, and stateful multi-user routing.

It is designed to be highly modular. By defining strict interfaces (`ISecretStore`, `IConfigStore`, `IAuditLogger`), it allows you to inject your own implementations. This makes `aag-core` suitable for both open-source CLI wrappers and fully-featured commercial services.

### Features

- **MCP Proxying**: Intercepts and routes MCP requests (`ListTools`, `CallTool`) seamlessly.
- **Multi-Transport Support**: Connects to downstream MCP servers via `stdio`, `sse`, or `http`.
- **Authentication & Authorization**: Validates AI client credentials (`AI_ID`, `AI_KEY`) and enforces fine-grained tool and server permissions with wildcard (`*`) support for allow/deny lists.
- **Dependency Injection**: Provide your own config managers, secret resolvers (e.g., OS Keychain), and loggers.
- **Auth Injection**: Safely injects credentials into downstream servers via environment variables, HTTP headers, or request payloads.
- **High Availability & Keep-Alive**: Automatically tracks downstream health via periodic pings and reconnects with exponential backoff.
- **Active Session Management**: Built-in `SessionManager` to forcibly close long-lived SSE/Stdio connections upon real-time backend credential revocation.
- **Middleware Interceptors**: Programmable pipeline to mutate MCP requests/responses, with a built-in `DataMaskingMiddleware` for PII redaction.
- **In-Memory Rate Limiting**: Built-in `RateLimitMiddleware` employing the Token Bucket algorithm to control request frequency per user/agent. Supports dynamic, per-user limits mapped automatically by sequentially linking `IConfigStore`.

### Installation

```bash
npm install @cyber-sec.space/aag-core
```

### Quick Start

To use `aag-core`, you must implement the required interfaces and instantiate the `ClientManager` and `ProxyServer`.

```typescript
import { 
  ClientManager, 
  ProxyServer, 
  IConfigStore, 
  ISecretStore, 
  IAuditLogger,
  RateLimitMiddleware,
  DataMaskingMiddleware
} from '@cyber-sec.space/aag-core';

// 1. Provide your implementations
class MyConfigStore implements IConfigStore { /* ... */ }
class MySecretStore implements ISecretStore { /* ... */ }
class MyLogger implements IAuditLogger { /* ... */ }

const configStore = new MyConfigStore();
const secretStore = new MySecretStore();
const logger = new MyLogger();

// 2. Initialize the Downstream Client Manager
const clientManager = new ClientManager(configStore, secretStore, logger);
await clientManager.syncConfig(configStore.getConfig());

// 3. Initialize the Stateless Proxy Session for the specific tenant
const proxy = new ProxyServer(clientManager, configStore, secretStore, logger, {
  aiId: "your-ai-tenant-uuid", // Optionally binds tenant identity to eliminate process.env fallbacks
  disableEnvFallback: true     // Secure constraint: mandates runtime context for SaaS
});

// 4. Register built-in or custom Middlewares
// Rate limits are now continuously pulled from configStore.getConfig().aiKeys[aiId].rateLimit
proxy.use(new RateLimitMiddleware(100, 60000, configStore)); // Distributed memory mappings configurable via IRateLimitStore
proxy.use(new DataMaskingMiddleware([/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi], "[REDACTED]")); // PII Redaction

// The proxy.server is an MCP Server instance ready to be connected to an incoming transport interface.
```

For detailed architectural information, please see [ARCHITECTURE.md](https://github.com/Cyber-Sec-Space/aag-core/blob/main/ARCHITECTURE.md).

---

<a id="chinese"></a>
## 中文

**版本日誌 (Changelog)** 請參照上方 [Changelog](CHANGELOG.md)。

`aag-core` 是 AI Auth Gateway v2 的核心引擎。它為 Model Context Protocol (MCP) 提供了一個強大、協議無關、**原生支援企業級 SaaS 無狀態化 (Scale-to-Zero)** 的代理層，負責處理成千上萬的下游客戶端連線、身分驗證以及基於租戶權限的請求路由。

它的設計高度模組化。透過定義嚴格的介面（`ISecretStore`、`IConfigStore`、`IAuditLogger`、`IRateLimitStore`），您可以注入自己的實作。這使得 `aag-core` 既適用於開源的 CLI 系統，也完美適配於功能高併發的商用服務叢集。

### 核心功能

- **MCP 代理**: 無縫攔截和路由 MCP 請求（如 `ListTools`、`CallTool`）。
- **多傳輸協定支援**: 可透過 `stdio`、`sse` 或 `http` 連接到下游的 MCP 伺服器。
- **身分驗證與授權**: 驗證 AI 客戶端憑證（`AI_ID`、`AI_KEY`），並執行細粒度的工具與伺服器權限控管（允許/拒絕清單，支援萬用字元 `*`）。
- **依賴注入 (Dependency Injection)**: 允許您提供自訂的設定管理器、機密解析器（如作業系統 Keychain）與日誌記錄器。
- **憑證注入 (Auth Injection)**: 安全地將憑證透過環境變數、HTTP Headers 或請求 Payload 注入到下游伺服器。
- **高可用性與 Keep-Alive**: 自動追蹤下游健康度並定期 Ping，支援斷線指數退避 (Exponential Backoff) 自動重連。
- **動態連線中斷 (Session Management)**: 內建 `SessionManager` 可偵測即時的憑證撤銷，並強制剔除對應使用者的現有長時間連線 (SSE/Stdio)。
- **中介軟體攔截器 (Middlewares)**: 可程式化管線，能在傳輸前後攔截或修改 MCP 請求與回應，並內建 `DataMaskingMiddleware` 用於遮蔽機密個資。
- **內建限流防護 (Rate Limiting)**: 內建 `RateLimitMiddleware` 採用 Token Bucket 演算法，可針對不同 AI 使用者設定請求頻率限制。支援動態依賴 `IConfigStore` 自動即時套用不同用戶的獨立限流參數。

### 安裝方式

```bash
npm install @cyber-sec.space/aag-core
```

### 快速開始

要使用 `aag-core`，您必須實作所需的介面，並實例化 `ClientManager` 與 `ProxyServer`。

```typescript
import { 
  ClientManager, 
  ProxyServer, 
  IConfigStore, 
  ISecretStore, 
  IAuditLogger,
  RateLimitMiddleware,
  DataMaskingMiddleware
} from '@cyber-sec.space/aag-core';

// 1. 提供您的實作
class MyConfigStore implements IConfigStore { /* ... */ }
class MySecretStore implements ISecretStore { /* ... */ }
class MyLogger implements IAuditLogger { /* ... */ }

const configStore = new MyConfigStore();
const secretStore = new MySecretStore();
const logger = new MyLogger();

// 2. 初始化下游客戶端管理器
const clientManager = new ClientManager(configStore, secretStore, logger);
await clientManager.syncConfig(configStore.getConfig());

// 3. 針對特定租戶初始化無狀態的代理會話 (Stateless Proxy Session)
const proxy = new ProxyServer(clientManager, configStore, secretStore, logger, {
  aiId: "your-ai-tenant-uuid", // 綁定租戶身分，跳過 process.env 等環境全域變數
  disableEnvFallback: true     // 強制性安全設定：SaaS 環境下必須透過動態宣告身分
});

// 4. 註冊內建或自訂的中介軟體 (Middlewares)
// 會自動讀取 configStore.getConfig().aiKeys[aiId].rateLimit 並由 IRateLimitStore 同步
proxy.use(new RateLimitMiddleware(100, 60000, configStore)); // 即時分散式記憶體自動限流可透過 IRateLimitStore 同步
proxy.use(new DataMaskingMiddleware([/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi], "[REDACTED]")); // PII 個資自動遮蔽

// proxy.server 是一個等待接收客戶端請求的 MCP Server 執行個體。
```

如需詳細的架構資訊，請參見 [ARCHITECTURE.md](https://github.com/Cyber-Sec-Space/aag-core/blob/main/ARCHITECTURE.md)。
