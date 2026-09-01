import { assertDeployableAdminAuthConfig, loadAdminAuthConfig, type AdminAuthConfig } from "./auth/config.js";
import { loadEventRetentionConfig, type EventRetentionConfig } from "./retention/config.js";
import { assertDeployableTraceStore, type TraceStore } from "./store/types.js";

export interface ServerStartupConfig {
  authConfig?: AdminAuthConfig | undefined;
  eventRetentionConfig: EventRetentionConfig;
}

export function prepareServerStartup(input: {
  store: TraceStore;
  env: NodeJS.ProcessEnv;
}): ServerStartupConfig {
  const authConfig = loadAdminAuthConfig(input.env);
  const eventRetentionConfig = loadEventRetentionConfig(input.env);

  assertDeployableTraceStore(input.store, input.env);
  assertDeployableAdminAuthConfig(authConfig, input.env);

  return { authConfig, eventRetentionConfig };
}
