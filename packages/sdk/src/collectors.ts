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

const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function safeErrorName(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const name = error.name.trim();
  return SAFE_ERROR_NAME_PATTERN.test(name) ? name : undefined;
}

// filename 은 "https://app.example.com/assets/checkout.js?v=2" 같은 전체 URL 이고
// 쿼리에 토큰이 실릴 수 있다. redactUrl 은 new URL 을 쓰므로 빈 값·비 URL 에서
// throw 한다 — cross-origin 오류의 filename 이 "" 이라 가드가 필수다.
function safeErrorSource(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  try {
    return redactUrl(filename).urlPath;
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
