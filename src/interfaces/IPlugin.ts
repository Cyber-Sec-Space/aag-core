import { ProxyServer } from "../proxy.js";
import { IConfigStore } from "./IConfigStore.js";
import { IAuditLogger } from "./IAuditLogger.js";

/**
 * Context provided to a plugin during its registration phase.
 */
export interface PluginContext {
    /** The core proxy server instance, allowing injection of Middlewares */
    proxyServer: ProxyServer;
    /** Dynamic config store for fetching tenant-specific parameters */
    configStore: IConfigStore;
    /** Core logging infrastructure in aag-core */
    logger: IAuditLogger;
    /** Plugin-specific global options loaded from aag.yaml 'plugins' array block */
    options?: any;
}

/**
 * Interface that all aag-core plugins must implement.
 */
export interface IPlugin {
    /** The unique name/identifier of this plugin */
    name: string;
    
    /** Semantic Versioning string of this plugin */
    version: string;
    
    /**
     * Called exactly once when the PluginLoader initializes this module.
     * Use this hook to register custom middlewares using context.proxyServer.use().
     */
    register: (context: PluginContext) => Promise<void> | void;
}
