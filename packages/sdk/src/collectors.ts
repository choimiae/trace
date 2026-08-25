import { nanoid } from "nanoid";
import type { TraceClient } from "./client";
import { getElementMetadata } from "./dom";

export function installCollectors(client: TraceClient) {
  client.enqueue(
    client.createEvent({
      eventId: `evt_${nanoid(10)}`,
      type: "page_view",
      urlPath: window.location.pathname,
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
        urlPath: window.location.pathname,
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
        urlPath: window.location.pathname,
        metadata: { errorType: "js_error" },
      }),
    );
  });
}
