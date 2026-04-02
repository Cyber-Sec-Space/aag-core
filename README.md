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
- **Multi-Tenant BYO-MCP**: Tenants can define and securely connect their own private MCP servers (`mcpServers` isolated via `tenantId`) dynamically without gateway restarts.
- **Multi-Transport Support**: Connects to downstream MCP servers via `stdio`, `sse`, or `http`.
- **Authentication & Authorization**: Validates AI client credentials (`AI_ID`, `AI_KEY`) and enforces fine-grained permissions (Servers, Tools, Prompts, Resources) with wildcard (`*`) support for allow/deny lists.
- **Strict Zod Validation & Typed Errors**: Boot configurations natively undergo Zod schema enforcement. All system faults are neatly categorized into HTTP-friendly Exception classes (e.g., `AuthenticationError`, `RateLimitExceededError`).
- **Dependency Injection**: Provide your own config managers, secret resolvers (e.g., OS Keychain), and loggers.
- **Auth Injection**: Safely injects credentials into downstream servers via environment variables, HTTP headers, or request payloads.
- **High Availability & Keep-Alive**: Automatically tracks downstream health via periodic pings and reconnects with exponential backoff.
- **Active Session Management**: Built-in `SessionManager` to forcibly close long-lived SSE/Stdio connections upon real-time backend credential revocation.
- **Plugin Ecosystem & Middlewares**: Standardized `IPlugin` interface and dynamic `PluginLoader` allowing community developers to seamlessly inject third-party extensions. All plugins natively inherit multi-user isolation and shared `IConfigStore` parameter structures. Built-in `DataMaskingPlugin` provided for PII redaction.
- **Scale-to-Zero Rate Limiting**: Built-in `RateLimitPlugin` employing the Token Bucket algorithm over an atomic `IRateLimitStore`. Supports dynamic, per-user limits mapped automatically by linking `IConfigStore`.

### 🛡️ Enterprise SaaS Security
- **OOM Prevention (Batch HRU Buffers)**: Dynamic wildcard RBAC policies (`*`) and `MemoryStateStore` states utilize 10% Batch Evicting (Least-Recently-Used) limits constrained directly by the environment. For example, `system.regexCacheSize` bounds regex evaluation tracking, while gracefully sweeping 10% of entries sequentially to eliminate single-item event loop jitter. Natively deflects Memory Exhaustion (OOM) vectors under extreme high-cardinality multi-tenant spikes (100k+ users).
- **O(1) Non-Blocking Dispatch**: Core orchestration engines (`ClientManager`, `ProxyServer`) handle downstream configuration aggregation and `ListTools` fetching using parallel concurrent chunking (`Promise.allSettled` with arrays up to `concurrentLimits`). Latencies are reduced from `O(N)` Event Loop blocks down to `O(1)` (bound only by the slowest downstream instance). Background GC routines are also wrapped in `setTimeout/setImmediate` to yield back to the main thread securely.
- **Strictly Stateless Downstreams**: To conserve machine resources, `aag-core` multiplexes tool execution commands from different AI users (hitting the same MCP server ID) into the **same background process/connection**. Downstream MCP servers MUST NOT maintain state (e.g., user-specific chat histories or session databases) unless they securely isolate operations using an `aiId` injected into the tool arguments. Failure to ensure stateless tools may result in Cross-Tenant State Pollution.
- **RCE Prevention (`allowStdio`)**: Host architectures configuring user-provided tools (BYO-MCP) are inherently susceptible to Remote Code Execution limits. You MUST set `allowStdio: false` in the system config to prevent SaaS tenants from manipulating `stdio` arguments into executing malicious sub-commands (e.g. `rm -rf`).
- **Resource Limits & SSRF/SSRD Prevention**: 
  - `ClientManager` connects blindly to any `url` mapped inside the `IConfigStore`. You must explicitly sanitize URLs to prevent Server-Side Request Forgery (SSRF) hitting VPCS. 
  - Tenants configuring their own `mcpServers` are strictly bounded by `system.maxTenantServers` or permissions overrides `maxServers` to prevent Resource Exhaustion Distributed Denial of Service (DDoS). 
  - **Secret Isolation**: Server-Side Request Deception (SSRD) is natively blocked; Global servers natively receive `SecretStore` payload injections, while private Tenant endpoints only receive raw text to strictly prevent exfiltration.
- **Audit Logging**: Mandatory telemetry paths built natively into every route handler requiring explicit `IAuditLogger` implementation, achieving ISO/SOC2-ready logging density (`trace()`, `debug()`, `info()`).

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

### SaaS BYO-MCP & Plugin Configuration Example (JSON)

In a true SaaS environment, you can dynamically configure tenant-specific Private MCP servers, limits (`maxServers`), and plugin settings all nested under a specific `aiId` globally.

```json
{
  "system": {
    "maxTenantServers": 10,
    "allowStdio": false
  },
  "plugins": [
    {
      "name": "@cyber-sec.space/aag-core-rate-limit",
      "options": { "maxRequests": 1000, "windowMs": 60000 }
    }
  ],
  "mcpServers": {
    "global-weather": {
      "command": "node",
      "args": ["weather-server.js"]
    }
  },
  "aiKeys": {
    "premium-user-id": {
      "tenantId": "org_apple_inc",
      "permissions": {
        "maxServers": 5,
        "allowedTools": ["*"]
      },
      "mcpServers": {
        "tenant-private-db": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://db..."],
          "authInjection": { 
             "type": "payload", 
             "value": "secret_key" 
             // 🛡️ SECURITY SSRD Block: Since this is defined inside a Tenant, 
             // "secret_key" will NOT be resolved against the Host's SecretStore. 
             // It will be passed literally as the text "secret_key" to prevent exfiltration.
          }
        }
      },
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
  constructor(private options: any) {}

  async onRequest(context, args) {
    // Read tenant-isolated configuration dynamically injected by aag-core
    const userOverrides = context.auth?.pluginConfig?.["my-custom-plugin"] || {};
    const effectiveOptions = { ...this.options, ...userOverrides };

    console.log(`User ${context.aiId} called ${context.toolName} (Setting: ${effectiveOptions.settingName})`);
    return args;
  }
}

const MyCustomPlugin: IPlugin = {
  name: "my-custom-plugin",
  version: "1.0.0",
  register: async (context: PluginContext) => {
    // 1. Read global default parameters (applies to users without specific overrides)
    const options = context.options || {};
    
    // 2. Register your interceptors into the proxy engine
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
- **多租戶自帶 MCP (BYO-MCP)**：支援 SaaS 服務下的每個租戶自定義私有 MCP 伺服器設定 (`mcpServers`)，依託 `tenantId` 做到 O(1) 等級的主機池連線自動隔離與重複收斂。
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

當您將 `aag-core` 部署於 SaaS、多租戶 (Multi-Tenant) 或開放式網路環境（例如承受大於 10 萬名活躍併發用戶）時，宿主開發者 (Host Developers) 必須嚴格遵守以下架構限制：
- **防 CPU 抖動記憶體爆破 (10% Batch LRU 快取機制)**：所有具備大量無窮增長風險的問題陣列（如動態權限匹配的 RegExp 正則解析、Session 狀態機等），核心內部皆換用具備最大上限 (`maxKeys`) 切斷機制的 LRU 最少存取快取。為防禦單筆清除導致的 CPU 抖動 (Jitter)，系統採用批次 10% 回收演算法確保高負載下 Event Loop 的平滑穩定，防禦因大量租戶異常連線而誘發的 V8 OOM 崩潰。
- **O(1) 等級平行無阻塞派送 (Non-Blocking Dispatch)**：當 `ClientManager` 需要去喚醒並同步多個下游伺服器的 Capability (`ListTools`) 時，傳統的 `O(N)` 標配 Await 迴圈會遭受阻塞導致回應極端緩慢。核心內部重構採用區塊化的平行解析 `Promise.allSettled(...)`，且單次發包率受 `concurrentLimits` 上限控管，達成耗時只受最慢之單一微服務拖累的滿血效能。所有背景垃圾回收 (GC) 也皆使用 `setImmediate` 主動讓出執行緒。
- **絕對無狀態的下游伺服器 (Strictly Stateless Downstreams)**：為了達成極致的效能與擴展性，如果多位不同的 AI 終端使用者請求相同的 MCP 伺服器 ID，`aag-core` 會將這些請求「多工多工 (Multiplex)」分派至**同一個底層背景程序或連線**。因此，下游的 MCP 工具必須是絕對無狀態的。如果下游工具本身持有狀態（例如記憶體快取或暫存資料庫），除非其嚴格透過 Payload 中的 `aiId` 進行隔離，否則將產生跨租戶資料外洩 (Cross-Tenant State Pollution) 的嚴重風險。
- **防止遠端木馬命令執行防護 (RCE Prevention)**：假如您的 Host 服務擁抱了自帶擴充（BYO-MCP），因為租戶可以自行傳遞 MCP 註冊參數，這代表他們可以填寫諸如 `['rm', '-rf']` 這類參數於 `stdio` 內。為此您必須確保將 `allowStdio` 鐵門開關鎖死為 `false`，強制關閉本地行程註冊功能，避免整個核心被入侵。
- **資源綁定與 SSRF/SSRD 防護**：
  - `ClientManager` 會無條件連線至您 `IConfigStore` 提供的任何 `url`。您必須在您的應用程式層預先過濾 (防範 SSRF) 並阻擋惡意的內部 IP（例如強制攔截針對企業內網 `10.x.x.x` 的請求）。
  - SaaS 租戶自行設定之伺服器具備資源數量上限，受系統全域 `system.maxTenantServers` 或是憑證權限 `maxServers` 嚴格約束，避免大量亂配觸發系統癱瘓 (DDoS)。
  - **跨界機密隔離**：為防範「伺服器端請求欺騙 (SSRD)」，代理引擎限定全域資源 (Global Servers) 方可從 OS `SecretStore` 抽取最高權限，而專屬於租戶私有的 MCP 連線將被無情隔離為「純文字 (Raw Text)」傳輸，杜絕租戶騙取內部主金鑰的可能。

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

### SaaS 多租戶自帶伺服器與外掛設定範例 (JSON)

在真實的 SaaS 環境中，您可以針對個別 `aiId` 動態掛載租戶專屬的私有 MCP 伺服器、伺服器數量配額 (`maxServers`) 以及中介軟體參數覆寫。

```json
{
  "system": {
    "maxTenantServers": 10,
    "allowStdio": false
  },
  "plugins": [
    {
      "name": "@cyber-sec.space/aag-core-rate-limit",
      "options": { "maxRequests": 1000, "windowMs": 60000 }
    }
  ],
  "mcpServers": {
    "global-weather": {
      "command": "node",
      "args": ["weather-server.js"]
    }
  },
  "aiKeys": {
    "premium-user-id": {
      "tenantId": "org_apple_inc",
      "permissions": {
        "maxServers": 5,
        "allowedTools": ["*"]
      },
      "mcpServers": {
        "tenant-private-db": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://db..."],
          "authInjection": { 
             "type": "payload", 
             "value": "secret_key" 
             // 🛡️ SSRD 資安阻擋: 因為這台機器是由租戶定義的，
             // "secret_key" 將「絕對不會」被引擎底層的 SecretStore 解析或解密。
             // 為了防範伺服器請求欺騙外洩，它只會被當作純文字 (Literal text) 傳遞！
          }
        }
      },
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
    // 透過 aag-core 原生注入的身分物件 (AuthKey)，動態讀取租戶隔離的參數覆寫
    const userOverrides = context.auth?.pluginConfig?.["my-custom-plugin"] || {};
    const effectiveOptions = { ...this.options, ...userOverrides };

    console.log(`使用者 ${context.aiId} 正在呼叫 ${context.toolName} (設定檔套用：${effectiveOptions.settingName})`);
    return args;
  }
}

const MyCustomPlugin: IPlugin = {
  name: "my-custom-plugin",
  version: "1.0.0",
  register: async (context: PluginContext) => {
    // 1. 讀取全域預設參數 (套用至那些沒有專屬 pluginConfig 覆寫的租戶)
    const options = context.options || {};
    
    // 2. 將攔截器註冊進入代理架構
    context.proxyServer.use(new MyCustomMiddleware(options));
    
    context.logger.info("MyPlugin", "外掛已成功掛載！");
  }
};

export default MyCustomPlugin; // 記得透過 default 輸出
```

如需詳細的架構資訊，請參見 [ARCHITECTURE.md](https://github.com/Cyber-Sec-Space/aag-core/blob/main/ARCHITECTURE.md)。
