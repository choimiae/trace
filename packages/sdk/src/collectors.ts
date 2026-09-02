import { nanoid } from "nanoid";
import { redactUrl } from "@trace/shared/privacy";
import type { TraceClient } from "./client.js";
import { getElementMetadata, getScreenContext } from "./dom.js";
import { installTransport } from "./transport.js";

// 숨은 iframe·레이아웃 전에는 innerWidth/innerHeight 가 0 이고 확대 상태에서는
// 소수가 된다. 측정 불가한 값은 보내지 않는다 — 0 은 의미가 없고, 수집 API 는
// 양의 정수만 저장한다.
function measuredViewport(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;

  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}

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
    const screenContext = getScreenContext(event.target);
    const viewportX = measuredViewport(window.innerWidth);
    const viewportY = measuredViewport(window.innerHeight);
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "click",
        urlPath: currentPath(),
        ...metadata,
        ...(screenContext ? { screenContext } : {}),
        x: event.clientX,
        y: event.clientY,
        ...(viewportX === undefined ? {} : { viewportX }),
        ...(viewportY === undefined ? {} : { viewportY }),
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

  installTransport(client);
}
