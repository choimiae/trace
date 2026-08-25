import { nanoid } from "nanoid";
import { redactUrl } from "@trace/shared";
import type { TraceClient } from "./client.js";
import { getElementMetadata } from "./dom.js";

export function installCollectors(client: TraceClient) {
  const currentPath = () => redactUrl(window.location.href).urlPath;

  client.enqueue(
    client.createEvent({
      eventId: `evt_${nanoid(10)}`,
      type: "page_view",
      urlPath: currentPath(),
      metadata: {},
    }),
  );

  window.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const metadata = getElementMetadata(event.target);
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "click",
        urlPath: currentPath(),
        ...metadata,
        x: event.clientX,
        y: event.clientY,
        viewportX: window.innerWidth,
        viewportY: window.innerHeight,
        metadata: {},
      }),
    );
  });

  window.addEventListener("error", (event) => {
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "js_error",
        urlPath: currentPath(),
        metadata: { errorType: "js_error" },
      }),
    );
  });
}
