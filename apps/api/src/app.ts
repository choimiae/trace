import cors from "@fastify/cors";
import Fastify from "fastify";
import type { AdminAuthConfig } from "./auth/config.js";
import { createGoogleOAuthClient, type GoogleOAuthClient } from "./auth/google.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerIngestionRoutes } from "./routes/ingestion.js";
import type { TraceStore } from "./store/types.js";

export function createApp(options: {
  store: TraceStore;
  authConfig?: AdminAuthConfig | undefined;
  googleOAuthClient?: GoogleOAuthClient | undefined;
  adminToken?: string | undefined;
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
      googleOAuthClient: options.googleOAuthClient ?? createGoogleOAuthClient(options.authConfig),
    });
  }
  app.register(registerAdminRoutes, { store: options.store, adminToken: options.adminToken });
  app.register(registerIngestionRoutes, { store: options.store });
  return app;
}
