import { nanoid } from "nanoid";
import { redactUrl } from "@trace/shared/privacy";
import type { TraceClient } from "./client.js";
import { getElementMetadata, getScreenContext } from "./dom.js";
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

// 같은 정규식이 apps/api/src/routes/ingestion.ts 의 SAFE_ERROR_NAME_PATTERN 과
// packages/shared/src/events.ts 의 errorNameSchema 에도 손으로 복사돼 있다. 셋을
// 공유 상수로 묶지 않는 것은 이 파일의 관례다 — 대신 셋은 함께 고쳐야 한다.
// 어긋나면: 정리기의 계약은 "언제나 eventBatchSchema.parse 가 받는 값을 낸다" 이므로
// 계약(events.ts) 쪽만 좁히면, 정리해서 통과시키던 값이 배치 전체 400 으로 바뀐다.
// "수집 API 는 거절이 아니라 정리한다" 가 그 자리에서 깨진다.
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function safeErrorName(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const name = error.name.trim();
  return SAFE_ERROR_NAME_PATTERN.test(name) ? name : undefined;
}

// filename 은 "https://app.example.com/assets/checkout.js?v=2" 같은 전체 URL 이고
// 쿼리에 토큰이 실릴 수 있다. redactUrl 은 new URL 을 쓰므로 빈 값·비 URL 에서
// throw 한다 — cross-origin 오류의 filename 이 "" 이라 가드가 필수다.
//
// redactUrl 이 던지지 않고 돌려주는 값도 계약(errorSourceSchema)을 만족한다는
// 보장은 없다 — "data:text/javascript,..." 나 "about:blank" 같은 filename 은
// 선행 "/" 없는 urlPath 를 내고, 아주 긴 경로는 256 자 상한을 넘는다. 그런 값이
// 그대로 나가면 Task 5 도입 후 서버가 400 을 내고, client.ts 는 4xx 를 영구
// 실패로 보고 배치 전체(무관한 click·page_view 포함)를 버린다. 그래서 여기서
// 모양을 확인하되 정규화(자르기·접기)는 하지 않는다 — 잘린 경로는 다른 파일을
// 가리키게 되므로 자르는 대신 생략한다. 선행 "//" 는 의도적으로 허용한다
// (`//vendor/lib.js` 같은 정상 경로일 수 있고, 접는 일은 Task 5 서버의 몫이다).
//
// 사본 위치: apps/api/src/routes/ingestion.ts 의 SAFE_ERROR_SOURCE_PATTERN 과
// packages/shared/src/events.ts 의 errorSourceSchema. 셋의 모양이 일부러 다르다 —
// 계약만 선행 "//" 를 거절하고(lookahead), 여기와 수집 API 사본에는 lookahead 가
// 없다. 여기서는 선행 "//" 를 통과시켜도 수집 API 가 접어서 넘기므로 계약을 통과한다.
// 셋 중 하나만 손대면 이 사슬이 끊긴다 — 특히 계약을 좁히면 배치 전체가 400 이 된다.
const SAFE_ERROR_SOURCE_SHAPE = /^\/[^\s?#]*$/;
const MAX_ERROR_SOURCE_LENGTH = 256;

function safeErrorSource(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  try {
    const path = redactUrl(filename).urlPath;
    if (path.length > MAX_ERROR_SOURCE_LENGTH) return undefined;
    return SAFE_ERROR_SOURCE_SHAPE.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function safeErrorLine(lineno: number | undefined): number | undefined {
  if (typeof lineno !== "number" || !Number.isFinite(lineno)) return undefined;
  const rounded = Math.round(lineno);
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
    const errorName = safeErrorName(event.error);
    const errorSource = safeErrorSource(event.filename);
    const errorLine = safeErrorLine(event.lineno);
    client.enqueue(
      client.createEvent({
        eventId: `evt_${nanoid(10)}`,
        type: "js_error",
        urlPath: currentPath(),
        ...(errorName === undefined ? {} : { errorName }),
        ...(errorSource === undefined ? {} : { errorSource }),
        ...(errorLine === undefined ? {} : { errorLine }),
        metadata: { errorType: "js_error" },
      }),
    );
  });

  installTransport(client);
}
