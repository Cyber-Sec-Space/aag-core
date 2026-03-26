import { ProxyMiddleware, ProxyContext } from "./types.js";

/**
 * A built-in reference middleware for masking sensitive data leaving the proxy.
 * Can be configured with regular expressions to strip out PII, secrets, or specific terms.
 */
export class DataMaskingMiddleware implements ProxyMiddleware {
    private redactionRules: RegExp[];
    private maskString: string;

    constructor(rules: (RegExp | string)[], maskString = "***") {
        this.redactionRules = rules.map(r => typeof r === "string" ? new RegExp(r, "gi") : r);
        this.maskString = maskString;
    }

    onResponse(context: ProxyContext, result: any) {
        if (!result || !result.content || !Array.isArray(result.content)) {
            return result; // Pass through unmodified if structure is unexpected
        }

        const maskedContent = result.content.map((block: any) => {
            if (block.type === "text" && typeof block.text === "string") {
                let text = block.text;
                for (const rule of this.redactionRules) {
                    text = text.replace(rule, this.maskString);
                }
                return { ...block, text };
            }
            return block;
        });

        return { ...result, content: maskedContent };
    }
}
