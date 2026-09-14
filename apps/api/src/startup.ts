import { assertDeployableAdminAuthConfig, loadAdminAuthConfig, type AdminAuthConfig } from "./auth/config.js";
import {
  loadEventRetentionConfig,
  loadSessionRecordingRetentionConfig,
  type EventRetentionConfig,
  type SessionRecordingRetentionConfig,
} from "./retention/config.js";
import { assertDeployableTraceStore, type TraceStore } from "./store/types.js";

export interface ServerStartupConfig {
  authConfig?: AdminAuthConfig | undefined;
  eventRetentionConfig: EventRetentionConfig;
  sessionRecordingRetentionConfig: SessionRecordingRetentionConfig;
}

export function prepareServerStartup(input: {
  store: TraceStore;
  env: NodeJS.ProcessEnv;
}): ServerStartupConfig {
  const authConfig = loadAdminAuthConfig(input.env);
  const eventRetentionConfig = loadEventRetentionConfig(input.env);
  const sessionRecordingRetentionConfig = loadSessionRecordingRetentionConfig(input.env);

  assertDeployableTraceStore(input.store, input.env);
  assertDeployableAdminAuthConfig(authConfig, input.env);

  return { authConfig, eventRetentionConfig, sessionRecordingRetentionConfig };
}
