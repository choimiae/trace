import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerAdminRoutes } from "./routes/admin";
import { registerIngestionRoutes } from "./routes/ingestion";
import type { TraceStore } from "./store/types";

export function createApp(options: { store: TraceStore }) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });
  app.register(registerAdminRoutes, { store: options.store });
  app.register(registerIngestionRoutes, { store: options.store });
  return app;
}
