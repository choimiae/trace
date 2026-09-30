import { assertDeployableAdminAuthConfig, loadAdminAuthConfig, type AdminAuthConfig } from "./auth/config.js";
import {
  loadEventRetentionConfig,
  loadSessionRecordingRetentionConfig,
  type EventRetentionConfig,
  type SessionRecordingRetentionConfig,
} from "./retention/config.js";

export interface ServerStartupConfig {
  authConfig?: AdminAuthConfig | undefined;
  eventRetentionConfig: EventRetentionConfig;
  sessionRecordingRetentionConfig: SessionRecordingRetentionConfig;
}

export function prepareServerStartup(input: {
  env: NodeJS.ProcessEnv;
}): ServerStartupConfig {
  const authConfig = loadAdminAuthConfig(input.env);
  const eventRetentionConfig = loadEventRetentionConfig(input.env);
  const sessionRecordingRetentionConfig = loadSessionRecordingRetentionConfig(input.env);

  assertDeployableAdminAuthConfig(authConfig, input.env);

  return { authConfig, eventRetentionConfig, sessionRecordingRetentionConfig };
}
