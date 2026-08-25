import { createApp } from "./app.js";
import { MemoryStore } from "./store/memory-store.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp({ store: new MemoryStore(), adminToken: process.env.TRACE_ADMIN_TOKEN });

await app.listen({ port, host: "0.0.0.0" });
