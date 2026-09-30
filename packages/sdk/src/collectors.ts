import { nanoid } from "nanoid";
import { redactUrl } from "@trace/shared/privacy";
import type { TraceClient } from "./client.js";
import { getElementMetadata } from "./dom.js";
import { installNavigationWatcher } from "./navigation.js";
import { installScrollWatcher } from "./scroll.js";
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

  const sendPageView = (urlPath: string) => {
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "page_view",
        urlPath,
        metadata: {},
      }),
    );
  };

  const sendPageLeave = (urlPath: string) => {
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "page_leave",
        urlPath,
        metadata: {},
      }),
    );
  };

  // 떠난 페이지의 경로를 들고 있어야 한다. page_leave 를 보낼 시점에는
  // location 이 이미 새 경로다.
  let openPath = currentPath();
  sendPageView(openPath);

  const scrollWatcher = installScrollWatcher(window, (depth) => {
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "scroll",
        urlPath: currentPath(),
        // safeMetadataSchema 는 .strict() 라 새 키를 거절한다. depth 를
        // 그대로 넣으면 배치 전체가 400 이 된다. score 는 0~100 이라
        // 백분율에 그대로 맞는다.
        metadata: { metric: "scroll_depth", score: depth },
      }),
    );
  });

  installNavigationWatcher(window, (urlPath) => {
    sendPageLeave(openPath);
    openPath = urlPath;
    sendPageView(urlPath);
    // 새 페이지는 처음부터 다시 센다.
    scrollWatcher.reset();
  });

  window.addEventListener("pagehide", () => sendPageLeave(openPath));

  window.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;

    const metadata = getElementMetadata(event.target);
    const viewportX = measuredViewport(window.innerWidth);
    const viewportY = measuredViewport(window.innerHeight);
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "click",
        urlPath: currentPath(),
        ...metadata,
        x: event.clientX,
        y: event.clientY,
        ...(viewportX === undefined ? {} : { viewportX }),
        ...(viewportY === undefined ? {} : { viewportY }),
        metadata: {},
      }),
    );
  });

  installTransport(client);
}
