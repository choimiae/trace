import { createApp } from "./app.js";
import { createGoogleOAuthClient } from "./auth/google.js";
import { loadLocalEnvFiles } from "./env/local-env.js";
import { SqliteStore } from "./store/sqlite-store.js";
import { prepareServerStartup } from "./startup.js";

loadLocalEnvFiles();

const port = Number(process.env.PORT ?? 4000);
const store = new SqliteStore(process.env.TRACE_DB_PATH ?? "./trace.db");
const authConfig = prepareServerStartup({ store, env: process.env });

const app = createApp({
  store,
  ...(authConfig ? { authConfig, googleOAuthClient: createGoogleOAuthClient(authConfig) } : {}),
});

await app.listen({ port, host: "0.0.0.0" });
