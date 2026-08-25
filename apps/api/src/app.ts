import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerIngestionRoutes } from "./routes/ingestion.js";
import type { TraceStore } from "./store/types.js";

export function createApp(options: { store: TraceStore; adminToken?: string | undefined }) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  app.register(registerAdminRoutes, { store: options.store, adminToken: options.adminToken });
  app.register(registerIngestionRoutes, { store: options.store });
  return app;
}
