import { createApp } from "./app";
import { MemoryStore } from "./store/memory-store";

const port = Number(process.env.PORT ?? 4000);
const app = createApp({ store: new MemoryStore() });

await app.listen({ port, host: "0.0.0.0" });
