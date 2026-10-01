import { nanoid } from "nanoid";
import type { TraceEvent } from "@trace/shared";
import { redactText, redactUrl } from "@trace/shared/privacy";
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

// 제목은 마스킹해 싣는다. redactText 는 이메일·전화·9자리 이상 숫자만 지우므로
// 제목에 든 사람 이름은 남는다(README 의 수집 표에 적었다). 비어 있으면 넣지
// 않는다 - 집계는 제목이 없으면 경로로 화면 이름을 대신한다.
function pageTitle(): Pick<TraceEvent, "titleMasked"> {
  const title = redactText(document.title.trim());
  return title ? { titleMasked: title } : {};
}

export function installCollectors(client: TraceClient) {
  const currentPath = () => redactUrl(window.location.href).urlPath;

  // 마지막으로 만든 page_view. 아래 제목 감시가 덮어쓴다.
  let lastPageView: TraceEvent | undefined;

  const sendPageView = (urlPath: string) => {
    const event = client.createEvent({
      eventId: `evt_${nanoid(10)}`,
      type: "page_view",
      urlPath,
      ...pageTitle(),
      metadata: {},
    });
    lastPageView = event;
    client.enqueue(event);
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

  // SPA 라우터는 경로를 먼저 바꾸고 제목은 렌더 뒤에 바꾼다. 그래서 라우팅 순간에
  // 읽은 제목은 직전 화면의 것이다 - 그대로 두면 ③ 의 화면 이름이 화면마다 한
  // 칸씩 밀린다. 제목이 바뀌면 같은 경로의 마지막 page_view 에 덮어 준다.
  //
  // 큐에 있는 객체를 고치는 것이 맞다. flush 는 큐의 이벤트를 복사해 보내므로,
  // 이미 나간 page_view 는 여기서 고쳐도 아무 데도 닿지 않는다.
  const titleObserver = new MutationObserver(() => {
    try {
      if (!lastPageView || lastPageView.urlPath !== currentPath()) return;
      const { titleMasked } = pageTitle();
      if (titleMasked) lastPageView.titleMasked = titleMasked;
      else delete lastPageView.titleMasked;
    } catch {
      // 고객 사이트의 DOM 변경 안에서 도는 콜백이다. 던지지 않는다.
    }
  });
  // <title> 은 통째로 바뀌기도 하고(childList) 글자만 바뀌기도 한다(characterData).
  if (document.head) {
    titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true });
  }

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
