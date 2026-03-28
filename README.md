# AI Auth Gateway Core (`@cyber-sec.space/aag-core`)

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Coverage](https://img.shields.io/badge/Coverage-100%25-brightgreen.svg)](https://jestjs.io/)
[![Version](https://img.shields.io/npm/v/@cyber-sec.space/aag-core.svg)](https://www.npmjs.com/package/@cyber-sec.space/aag-core)

**[English](#english)** | **[中文](#chinese)** | **[Changelog](CHANGELOG.md)**

---

<a id="english"></a>
## English

`aag-core` is the core engine for the AI Auth Gateway v2. It provides a robust, protocol-agnostic, **Scale-to-Zero** proxy for the Model Context Protocol (MCP), handling infinite downstream JIT connections, authentications, and stateful multi-user routing.

It is designed to be highly modular. By defining strict interfaces (`ISecretStore`, `IConfigStore`, `IAuditLogger`), it allows you to inject your own implementations. This makes `aag-core` highly adaptable for various deployment environments.

### Features

- **MCP Proxying**: Intercepts and routes MCP requests (`ListTools`, `CallTool`) seamlessly.
- **Multi-Transport Support**: Connects to downstream MCP servers via `stdio`, `sse`, or `http`.
- **Authentication & Authorization**: Validates AI client credentials (`AI_ID`, `AI_KEY`) and enforces fine-grained permissions (Servers, Tools, Prompts, Resources) with wildcard (`*`) support for allow/deny lists.
- **Strict Zod Validation & Typed Errors**: Boot configurations natively undergo Zod schema enforcement. All system faults are neatly categorized into HTTP-friendly Exception classes (e.g., `AuthenticationError`, `RateLimitExceededError`).
- **Dependency Injection**: Provide your own config managers, secret resolvers (e.g., OS Keychain), and loggers.
- **Auth Injection**: Safely injects credentials into downstream servers via environment variables, HTTP headers, or request payloads.
- **High Availability & Keep-Alive**: Automatically tracks downstream health via periodic pings and reconnects with exponential backoff.
- **Active Session Management**: Built-in `SessionManager` to forcibly close long-lived SSE/Stdio connections upon real-time backend credential revocation.
- **Plugin Ecosystem & Middlewares**: Standardized `IPlugin` interface and dynamic `PluginLoader` allowing community developers to seamlessly inject third-party extensions. All plugins natively inherit multi-user isolation and shared `IConfigStore` parameter structures. Built-in `DataMaskingPlugin` provided for PII redaction.
- **Scale-to-Zero Rate Limiting**: Built-in `RateLimitPlugin` employing the Token Bucket algorithm over an atomic `IRateLimitStore`. Supports dynamic, per-user limits mapped automatically by linking `IConfigStore`.

### Security & Host Requirements

When integrating `aag-core` into SaaS, Multi-Tenant, or internet-exposed environments, host developers must adhere to the following constraints:
- **Strictly Stateless Downstreams**: To conserve machine resources, `aag-core` multiplexes tool execution commands from different AI users (hitting the same MCP server ID) into the **same background process/connection**. Downstream MCP servers MUST NOT maintain state (e.g., user-specific chat histories or session databases) unless they securely isolate operations using an `aiId` injected into the tool arguments. Failure to ensure stateless tools may result in Cross-Tenant State Pollution.
- **SSRF Prevention on Config**: `ClientManager` connects blindly to any `url` mapped inside the `IConfigStore`. You must explicitly sanitize, validate, and restrict (e.g., blocking internal VPC ranges like `10.x.x.x` or AWS `169.254.x.x`) any user-provided URL configurations before writing them to the store.

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
  IAuthStore,
  PluginLoader,
  RateLimitPlugin,
  DataMaskingPlugin
} from '@cyber-sec.space/aag-core';

// 1. Provide your implementations
class MyConfigStore implements IConfigStore { /* ... */ }
class MySecretStore implements ISecretStore { /* ... */ }
class MyLogger implements IAuditLogger { /* ... */ }
class MyAuthStore implements IAuthStore { /* ... */ } // Optional, defaults to ConfigAuthStore

const configStore = new MyConfigStore();
const secretStore = new MySecretStore();
const logger = new MyLogger();
const authStore = new MyAuthStore();

// 2. Initialize the Downstream Client Manager
const clientManager = new ClientManager(configStore, secretStore, logger);
await clientManager.syncConfig(configStore.getConfig());

// 3. Initialize the Stateless Proxy Session for the specific environment
const proxy = new ProxyServer(clientManager, configStore, secretStore, authStore, logger, {
  aiId: "your-ai-user-uuid",   // Optionally binds identity to eliminate process.env fallbacks
  disableEnvFallback: true     // Secure constraint: mandates strict runtime context
});

// 4. Register Plugins and dynamic Middlewares
// Plugins execute with multi-user isolation, automatically referencing respective `pluginConfig` per AI ID
const pluginLoader = new PluginLoader(logger);
await pluginLoader.loadPlugins(proxy, configStore, configStore.getConfig()?.plugins || []);

// Or manually register built-in plugins:
await RateLimitPlugin.register({ proxyServer: proxy, configStore, logger, options: { maxRequests: 100 } });
await DataMaskingPlugin.register({ proxyServer: proxy, configStore, logger, options: { rules: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi] } });

// The proxy.server is an MCP Server instance ready to be connected to an incoming transport interface.
```

### Plugin Configuration (JSON Registry)

Plugins are dynamically loaded and allow for per-user parameter overrides in multi-user environments. To activate plugins, your configuration object (served by `IConfigStore`) should map them in the global `plugins` array:

```json
{
  "plugins": [
    {
      "name": "@cyber-sec.space/aag-core-rate-limit",
      "options": { "maxRequests": 1000, "windowMs": 60000 }
    },
    {
      "name": "./my-custom-plugin.js"
    }
  ],
  "mcpServers": { /* ... */ },
  "aiKeys": {
    "premium-user-id": {
      "permissions": { /* ... */ },
      "pluginConfig": {
        "aag-core-rate-limit": { "maxRequests": 5000 },
        "aag-core-data-masking": { "rules": ["(?i)credit_card"] }
      }
    }
  }
}
```

### Plugin Development Guide

It is incredibly easy to develop and publish your own plugins. Simply implement the `IPlugin` interface and optionally define `onRequest` / `onResponse` hooks via `ProxyMiddleware`.

```typescript
import { IPlugin, PluginContext, ProxyMiddleware } from '@cyber-sec.space/aag-core';

class MyCustomMiddleware implements ProxyMiddleware {
  async onRequest(context, args) {
    // context.aiId allows you to securely apply user-specific logic
    console.log(`User ${context.aiId} is calling ${context.toolName}`);
    return args;
  }
}

const MyCustomPlugin: IPlugin = {
  name: "my-custom-plugin",
  version: "1.0.0",
  register: async (context: PluginContext) => {
    // 1. Read parameters (combines global fallback options & aiKeys[...].pluginConfig)
    const options = context.options || {};
    
    // 2. Register your interceptors into the engine
    context.proxyServer.use(new MyCustomMiddleware(options));
    
    context.logger.info("MyPlugin", "Successfully injected middleware into AAG!");
  }
};

export default MyCustomPlugin; // Remember to export as default
```

For detailed architectural information, please see [ARCHITECTURE.md](https://github.com/Cyber-Sec-Space/aag-core/blob/main/ARCHITECTURE.md).

---

<a id="chinese"></a>
## 中文

**版本日誌 (Changelog)** 請參照上方 [Changelog](CHANGELOG.md)。

`aag-core` 是 AI Auth Gateway v2 的核心引擎。它為 Model Context Protocol (MCP) 提供了一個強大、協議無關、**原生支援無狀態化 (Scale-to-Zero)** 的代理層，負責處理成千上萬的下游客戶端連線、身分驗證以及基於使用者權限的請求路由。

它的設計高度模組化。透過定義嚴格的介面（`ISecretStore`、`IConfigStore`、`IAuditLogger`、`IRateLimitStore`），您可以注入自己的實作。這使得 `aag-core` 能夠高度適應各種部署環境與規模。

### 核心功能

- **MCP 代理**: 無縫攔截和路由 MCP 請求（如 `ListTools`、`CallTool`）。
- **多傳輸協定支援**: 可透過 `stdio`、`sse` 或 `http` 連接到下游的 MCP 伺服器。
- **身分驗證與授權**: 驗證 AI 客戶端憑證（`AI_ID`、`AI_KEY`），並執行細粒度的伺服器、工具、提示詞 (Prompts) 與資源 (Resources) 權限控管（允許/拒絕清單，支援萬用字元 `*`）。
- **Zod 嚴格校驗與型別錯誤生態系**: 所有的設定檔在實例化時皆需通過嚴苛的 Zod 架構解析，防堵任何異常屬性注入。同時核心全面採用 `AagError` 型別錯誤類別 (如 `AuthorizationError`)，讓外部 Host App 得以輕鬆擷取並實作 HTTP 狀態碼對映。
- **依賴注入 (Dependency Injection)**: 允許您提供自訂的設定管理器、機密解析器（如作業系統 Keychain）與日誌記錄器。
- **憑證注入 (Auth Injection)**: 安全地將憑證透過環境變數、HTTP Headers 或請求 Payload 注入到下游伺服器。
- **高可用性與 Keep-Alive**: 自動追蹤下游健康度並定期 Ping，支援斷線指數退避 (Exponential Backoff) 自動重連。
- **動態連線中斷 (Session Management)**: 內建 `SessionManager` 可偵測即時的憑證撤銷，並強制剔除對應使用者的現有長時間連線 (SSE/Stdio)。
- **全域插件生態系與中介軟體 (Plugins & Middlewares)**: 內建標準化 `IPlugin` 介面與 `PluginLoader`，允許社群開發者輕易掛載第三方擴充套件，且完美繼承多使用者環境下的動態配置隔離特性。原生包含可過濾機密個資的 `DataMaskingPlugin`。
- **動態限流防護 (Rate Limiting)**: 內建 `RateLimitPlugin` 實踐 Token Bucket 演算法，針對不同 AI 使用者設定分級防護。依託 `IRateLimitStore` 提供可靠的跨叢集原子性計數。

### 資安與宿主環境要求 (Security Requirements)

當您將 `aag-core` 部署於 SaaS、多租戶 (Multi-Tenant) 或開放式網路環境時，宿主開發者 (Host Developers) 必須嚴格遵守以下架構限制：
- **絕對無狀態的下游伺服器 (Strictly Stateless Downstreams)**：為了達成極致的效能與擴展性，如果多位不同的 AI 終端使用者請求相同的 MCP 伺服器 ID，`aag-core` 會將這些請求「多工多工 (Multiplex)」分派至**同一個底層背景程序或連線**。因此，下游的 MCP 工具必須是絕對無狀態的。如果下游工具本身持有狀態（例如記憶體快取或暫存資料庫），除非其嚴格透過 Payload 中的 `aiId` 進行隔離，否則將產生跨租戶資料外洩 (Cross-Tenant State Pollution) 的嚴重風險。
- **防範伺服器端請求偽造 (SSRF)**：`ClientManager` 會無條件連線至您 `IConfigStore` 提供的任何 `url`。在將這類使用者自訂或動態產生的連接埠套用至 Store 之前，您必須在您的應用程式層預先過濾並阻擋惡意的內部 IP（例如強制攔截針對 `169.254.169.254` 或是企業內網 `10.x.x.x` 的配置請求）。

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
  IAuthStore,
  PluginLoader,
  RateLimitPlugin,
  DataMaskingPlugin
} from '@cyber-sec.space/aag-core';

// 1. 提供您的實作
class MyConfigStore implements IConfigStore { /* ... */ }
class MySecretStore implements ISecretStore { /* ... */ }
class MyLogger implements IAuditLogger { /* ... */ }
class MyAuthStore implements IAuthStore { /* ... */ } // 非必填，預設提供 ConfigAuthStore 退路

const configStore = new MyConfigStore();
const secretStore = new MySecretStore();
const logger = new MyLogger();
const authStore = new MyAuthStore();

// 2. 初始化下游客戶端管理器
const clientManager = new ClientManager(configStore, secretStore, logger);
await clientManager.syncConfig(configStore.getConfig());

// 3. 針對特定環境初始化無狀態的代理會話 (Stateless Proxy Session)
const proxy = new ProxyServer(clientManager, configStore, secretStore, authStore, logger, {
  aiId: "your-ai-user-uuid", // 綁定身分，跳過 process.env 等環境全域變數
  disableEnvFallback: true   // 強制性安全設定：多使用者環境下必須透過動態宣告身分
});

// 4. 註冊內建或自訂的插件 (Plugins) 與中介軟體
const pluginLoader = new PluginLoader(logger);
await pluginLoader.loadPlugins(proxy, configStore, configStore.getConfig()?.plugins || []);

// 若要手動註冊內建外掛：
await RateLimitPlugin.register({ proxyServer: proxy, configStore, logger, options: { maxRequests: 100 } });
await DataMaskingPlugin.register({ proxyServer: proxy, configStore, logger, options: { rules: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi] } });

// proxy.server 是一個等待接收客戶端請求的 MCP Server 執行個體。
```

### 插件註冊表設定指南 (Plugin Configuration)

在新的生態系架構中，插件採用動態加載。您必須在設定檔 (由 `IConfigStore` 提供) 根目錄的 `plugins` 陣列中宣告它們。如果您身處多使用者環境，您還可以針對每個 `aiId` 分別宣告並覆寫專屬的插件參數 (`pluginConfig`)：

```json
{
  "plugins": [
    {
      "name": "@cyber-sec.space/aag-core-rate-limit",
      "options": { "maxRequests": 1000, "windowMs": 60000 }
    },
    {
      "name": "./my-custom-plugin.js"
    }
  ],
  "mcpServers": { /* ... */ },
  "aiKeys": {
    "premium-user-id": {
      "permissions": { /* ... */ },
      "pluginConfig": {
        "aag-core-rate-limit": { "maxRequests": 5000 },
        "aag-core-data-masking": { "rules": ["(?i)credit_card"] }
      }
    }
  }
}
```

### 插件開發指南 (Plugin Development Guide)

開發並發布自訂的外掛非常容易。您只需要實作 `IPlugin` 介面，並選擇性地定義 `onRequest` / `onResponse` 生命週期攔截器 (`ProxyMiddleware`) 即可。

```typescript
import { IPlugin, PluginContext, ProxyMiddleware } from '@cyber-sec.space/aag-core';

class MyCustomMiddleware implements ProxyMiddleware {
  constructor(private options: any) {}

  async onRequest(context, args) {
    // context.aiId 讓您確保邏輯被安全地隔離在獨立的執行環境沙盒內
    console.log(`使用者 ${context.aiId} 正在呼叫 ${context.toolName}`);
    return args;
  }
}

const MyCustomPlugin: IPlugin = {
  name: "my-custom-plugin",
  version: "1.0.0",
  register: async (context: PluginContext) => {
    // 1. 讀取參數 (此處已經自動合併「全域預設選項」以及「使用者專屬 pluginConfig」)
    const options = context.options || {};
    
    // 2. 將攔截器註冊進入代理核心引擎
    context.proxyServer.use(new MyCustomMiddleware(options));
    
    context.logger.info("MyPlugin", "外掛已成功掛載！");
  }
};

export default MyCustomPlugin; // 記得透過 default 輸出
```

如需詳細的架構資訊，請參見 [ARCHITECTURE.md](https://github.com/Cyber-Sec-Space/aag-core/blob/main/ARCHITECTURE.md)。
