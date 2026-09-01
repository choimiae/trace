import { createApp } from "./app.js";
import { createGoogleOAuthClient } from "./auth/google.js";
import { loadLocalEnvFiles } from "./env/local-env.js";
import { runEventRetention } from "./retention/events.js";
import { SqliteStore } from "./store/sqlite-store.js";
import { prepareServerStartup } from "./startup.js";

loadLocalEnvFiles();

const port = Number(process.env.PORT ?? 4000);
const store = new SqliteStore(process.env.TRACE_DB_PATH ?? "./trace.db");
const startup = prepareServerStartup({ store, env: process.env });
await runEventRetention(store, startup.eventRetentionConfig);

const app = createApp({
  store,
  eventRetentionConfig: startup.eventRetentionConfig,
  ...(startup.authConfig
    ? {
        authConfig: startup.authConfig,
        ...(startup.authConfig.googleOAuthEnabled ? { googleOAuthClient: createGoogleOAuthClient(startup.authConfig) } : {}),
      }
    : {}),
});

await app.listen({ port, host: "0.0.0.0" });
