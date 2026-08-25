import { createApp } from "./app.js";
import { createGoogleOAuthClient } from "./auth/google.js";
import { MemoryStore } from "./store/memory-store.js";
import { prepareServerStartup } from "./startup.js";

const port = Number(process.env.PORT ?? 4000);
const store = new MemoryStore();
const authConfig = prepareServerStartup({ store, env: process.env });

const app = createApp({
  store,
  ...(authConfig ? { authConfig, googleOAuthClient: createGoogleOAuthClient(authConfig) } : {}),
});

await app.listen({ port, host: "0.0.0.0" });
