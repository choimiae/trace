import cors from "@fastify/cors";
import Fastify from "fastify";
import type { AdminAuthConfig } from "./auth/config.js";
import { createGoogleOAuthClient, type GoogleOAuthClient } from "./auth/google.js";
import {
  DEFAULT_SESSION_RECORDING_RETENTION_DAYS,
  type EventRetentionConfig,
  type SessionRecordingRetentionConfig,
} from "./retention/config.js";
import { registerAdminProxyRoutes } from "./routes/admin-proxy.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerIngestionRoutes } from "./routes/ingestion.js";
import { registerProjectConfigRoutes } from "./routes/project-config.js";
import { registerRecordingRoutes } from "./routes/recording.js";
import { registerSdkBundleRoutes } from "./routes/sdk-bundle.js";
import { startSessionRecordingRetentionSweep } from "./retention/sweeper.js";
import type { TraceStore } from "./store/types.js";

export function createApp(options: {
  store: TraceStore;
  authConfig?: AdminAuthConfig | undefined;
  eventRetentionConfig?: EventRetentionConfig | undefined;
  sessionRecordingRetentionConfig?: SessionRecordingRetentionConfig | undefined;
  now?: (() => Date) | undefined;
  googleOAuthClient?: GoogleOAuthClient | undefined;
}) {
  const app = Fastify({ logger: false });
  const sessionRecordingRetentionConfig = options.sessionRecordingRetentionConfig ?? {
    sessionRecordingRetentionDays: DEFAULT_SESSION_RECORDING_RETENTION_DAYS,
  };

  // 보존을 업로드에만 매달아 두면, 운영자가 리플레이를 끈 순간 기록이 그대로
  // 남는다 - 지워지기를 기대하는 바로 그때다. 앱이 살아 있는 동안 주기적으로
  // 돈다. onClose 로 걷는 이유는 이 저장소의 테스트가 app 을 만들고 닫기
  // 때문이다 - 닫힌 앱의 타이머가 닫힌 스토어를 두드려서는 안 된다.
  const stopRetentionSweep = startSessionRecordingRetentionSweep({
    store: options.store,
    config: sessionRecordingRetentionConfig,
    now: options.now,
  });
  app.addHook("onClose", async () => {
    stopRetentionSweep();
  });
  app.register(cors, {
    delegator: (request, callback) => {
      const protectedBrowserRoute = request.url.startsWith("/auth/") || request.url.startsWith("/admin/api/");
      const allowCredentialedOrigin = protectedBrowserRoute && request.headers.origin === options.authConfig?.adminAppOrigin;
      if (protectedBrowserRoute) {
        callback(null, allowCredentialedOrigin ? { origin: options.authConfig!.adminAppOrigin, credentials: true } : { origin: false });
        return;
      }

      callback(null, { origin: true });
    },
  });
  if (options.authConfig) {
    app.register(registerAuthRoutes, {
      store: options.store,
      config: options.authConfig,
      ...(options.authConfig.googleOAuthEnabled
        ? { googleOAuthClient: options.googleOAuthClient ?? createGoogleOAuthClient(options.authConfig) }
        : {}),
    });
    app.register(registerAdminProxyRoutes, { store: options.store, config: options.authConfig });
  }
  app.register(registerIngestionRoutes, {
    store: options.store,
    eventRetentionConfig: options.eventRetentionConfig ?? {},
    now: options.now,
  });
  app.register(registerProjectConfigRoutes, { store: options.store });
  app.register(registerRecordingRoutes, {
    store: options.store,
    sessionRecordingRetentionConfig,
    now: options.now,
  });
  app.register(registerSdkBundleRoutes, {});
  return app;
}
