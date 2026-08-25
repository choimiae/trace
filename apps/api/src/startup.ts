import { assertDeployableAdminAuthConfig, loadAdminAuthConfig, type AdminAuthConfig } from "./auth/config.js";
import { assertDeployableTraceStore, type TraceStore } from "./store/types.js";

export function prepareServerStartup(input: {
  store: TraceStore;
  env: NodeJS.ProcessEnv;
}): AdminAuthConfig | undefined {
  const authConfig = loadAdminAuthConfig(input.env);

  assertDeployableTraceStore(input.store, input.env);
  assertDeployableAdminAuthConfig(authConfig, input.env);

  return authConfig;
}
