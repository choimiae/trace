import cors from "@fastify/cors";
import Fastify from "fastify";
import type { AdminAuthConfig } from "./auth/config.js";
import { createGoogleOAuthClient, type GoogleOAuthClient } from "./auth/google.js";
import type { EventRetentionConfig, SessionRecordingRetentionConfig } from "./retention/config.js";
import { registerAdminProxyRoutes } from "./routes/admin-proxy.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerIngestionRoutes } from "./routes/ingestion.js";
import { registerProjectConfigRoutes } from "./routes/project-config.js";
import { registerSdkBundleRoutes } from "./routes/sdk-bundle.js";
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
  app.register(registerSdkBundleRoutes, {});
  return app;
}
