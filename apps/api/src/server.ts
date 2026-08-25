import { createApp } from "./app.js";
import { assertDeployableAdminAuthConfig, loadAdminAuthConfig } from "./auth/config.js";
import { createGoogleOAuthClient } from "./auth/google.js";
import { MemoryStore } from "./store/memory-store.js";
import { assertDeployableTraceStore } from "./store/types.js";

const port = Number(process.env.PORT ?? 4000);
const store = new MemoryStore();
const authConfig = loadAdminAuthConfig(process.env);

if (authConfig) {
  assertDeployableAdminAuthConfig(authConfig, process.env);
  assertDeployableTraceStore(store, process.env);
}

const app = createApp({
  store,
  adminToken: process.env.TRACE_ADMIN_TOKEN,
  ...(authConfig ? { authConfig, googleOAuthClient: createGoogleOAuthClient(authConfig) } : {}),
});

await app.listen({ port, host: "0.0.0.0" });
