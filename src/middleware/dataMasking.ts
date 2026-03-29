import { ProxyMiddleware, ProxyContext } from "./types.js";
import { IPlugin, PluginContext } from "../interfaces/IPlugin.js";
import { IConfigStore } from "../interfaces/IConfigStore.js";

/**
 * A built-in reference middleware for masking sensitive data leaving the proxy.
 * Can be configured with regular expressions to strip out PII, secrets, or specific terms.
 */
export class DataMaskingMiddleware implements ProxyMiddleware {
    private globalRules: RegExp[];
    private maskString: string;
    private configStore?: IConfigStore;
    private static pluginRegexCache = new Map<string, RegExp>();

    constructor(rules: (RegExp | string)[], maskString = "***", configStore?: IConfigStore) {
        this.globalRules = rules.map(r => typeof r === "string" ? new RegExp(r, "gi") : r);
        this.maskString = maskString;
        this.configStore = configStore;
    }

    onResponse(context: ProxyContext, result: any) {
        if (!result || !result.content || !Array.isArray(result.content)) {
            return result; 
        }

        let activeRules = this.globalRules;
        let activeMask = this.maskString;

        const pluginCfg = context.auth?.pluginConfig?.["aag-core-data-masking"];
        if (pluginCfg) {
            if (Array.isArray(pluginCfg.rules)) {
                activeRules = pluginCfg.rules.map((r: string | RegExp) => {
                    if (typeof r !== "string") return r;
                    let regex = DataMaskingMiddleware.pluginRegexCache.get(r);
                    if (!regex) {
                        regex = new RegExp(r, "gi");
                        DataMaskingMiddleware.pluginRegexCache.set(r, regex);
                    }
                    return regex;
                });
            }
            if (typeof pluginCfg.maskString === "string") {
                activeMask = pluginCfg.maskString;
            }
        }

        if (activeRules.length === 0) return result;

        const maskedContent = result.content.map((block: any) => {
            if (block.type === "text" && typeof block.text === "string") {
                let text = block.text;
                for (const rule of activeRules) {
                    text = text.replace(rule, activeMask);
                }
                return { ...block, text };
            }
            return block;
        });

        return { ...result, content: maskedContent };
    }
}

export const DataMaskingPlugin: IPlugin = {
    name: "aag-core-data-masking",
    version: "1.0.0",
    register: (context: PluginContext) => {
        const { rules = [], maskString = "***" } = context.options || {};
        if (rules.length > 0 || context.configStore) {
            const middleware = new DataMaskingMiddleware(rules, maskString, context.configStore);
            context.proxyServer.use(middleware);
            context.logger.info("DataMaskingPlugin", "Built-in Data Masking plugin registered.");
        } else {
            context.logger.debug("DataMaskingPlugin", "DataMaskingPlugin loaded but no rules provided. Middleware will not be active.");
        }
    }
};
