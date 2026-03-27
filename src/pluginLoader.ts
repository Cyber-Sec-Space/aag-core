import { IPlugin, PluginContext } from "./interfaces/IPlugin.js";
import { ProxyServer } from "./proxy.js";
import { IConfigStore } from "./interfaces/IConfigStore.js";
import { IAuditLogger } from "./interfaces/IAuditLogger.js";
import { PluginConfig } from "./config/types.js";
import path from "path";

export class PluginLoader {
    private logger: IAuditLogger;

    constructor(logger: IAuditLogger) {
        this.logger = logger;
    }

    /**
     * Dynamically loads and registers plugins into the ProxyServer.
     */
    public async loadPlugins(
        proxyServer: ProxyServer,
        configStore: IConfigStore,
        pluginsConfig: PluginConfig[]
    ): Promise<void> {
        if (!pluginsConfig || pluginsConfig.length === 0) {
            this.logger.debug("PluginLoader", "No plugins configured to load.");
            return;
        }

        for (const pluginConfig of pluginsConfig) {
            try {
                this.logger.info("PluginLoader", `Attempting to load plugin: ${pluginConfig.name}`);
                
                let importPath = pluginConfig.name;
                // Resolve relative paths from current working directory
                if (importPath.startsWith(".")) {
                    importPath = path.resolve(process.cwd(), importPath);
                }

                const pluginModule = await import(importPath);
                
                // Handle Default ES module exports or CommonJS module.exports
                const plugin: IPlugin = pluginModule.default || pluginModule;

                if (!plugin.name || typeof plugin.register !== "function") {
                    throw new Error(`Module ${pluginConfig.name} does not implement the IPlugin interface correctly.`);
                }

                const context: PluginContext = {
                    proxyServer,
                    configStore,
                    logger: this.logger,
                    options: pluginConfig.options
                };

                await plugin.register(context);
                this.logger.info("PluginLoader", `Successfully registered plugin: ${plugin.name} (v${plugin.version})`);
                
            } catch (error: any) {
                this.logger.error(
                    "PluginLoader", 
                    `Failed to load plugin '${pluginConfig.name}'. Ensure it is installed via npm or the path is correct. Error: ${error.message}`
                );
                // Throw error to halt boot if critical plugins are missing
                throw error;
            }
        }
    }
}
