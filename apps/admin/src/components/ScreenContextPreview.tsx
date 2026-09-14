import type { ScreenContext, TraceEvent } from "@trace/shared";

export interface ScreenContextPreviewProps {
  context?: ScreenContext;
  event?: TraceEvent;
  compact?: boolean;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// 미리보기는 뷰포트를 축소해 그리는데 글자는 같이 줄지 않는다. hero 실측
// (캔버스 676px / 뷰포트 1456px, 배율 0.464)에서 11px 글자가 실제 비율의 2.2배로
// 그려져, 48px 메뉴 상자가 화면에서 22px 인데 다섯 글자를 밀어 넣고 있었다.
// "시스템설정" 이 가운데만 남아 "템설" 로 읽혔다.
//
// 그래서 상자가 화면에서 차지하는 **비율**로 판정한다 — 캔버스가 얼마나 크게
// 그려지든 같은 기준이다. 문턱 미만은 글자를 그리지 않고 title 로만 들고 있어,
// 마우스를 올리면 온전히 보이고 기하는 틀어지지 않는다.
//
// 0.06 은 실측에서 골랐다: 메뉴 레일 3.3%(제외), 근무시간 패널 12.3%(포함),
// 본문 문구 44%(포함).
const MIN_INLINE_LABEL_RATIO = 0.06;

// 다른 상자를 통째로 품은 상자는 요소가 아니라 **영역**이다. 전부 같은 실선
// 테두리 + 흰 배경으로 그리면 테두리 안에 테두리가 겹쳐 "빈 박스가 겹쳐 가득한"
// 그림이 된다 — 실측(2026-09-14, 요소 2,465개 업무 화면)에서 힌트 50개 중
// 컨테이너 5개가 자식 31개를 품고 있었다.
//
// 수집 쪽에서 컨테이너를 버리는 방법도 시도했으나 기각했다. div·table 로 짠
// 화면에서 td 셀 같은 진짜 영역까지 잃어(픽스처 힌트 10개+ → 5개) 골격이 통째로
// 날아갔고, "얼마나 채워져 있나" 로도 문턱이 안 그어졌다(버리고 싶던 상자가
// 채움률 88% 로 가장 높았다). 데이터는 정확하니 그리는 방식으로 푼다.
function containsRect(outer: ScreenContext["layoutHints"][number]["rect"], inner: ScreenContext["layoutHints"][number]["rect"]): boolean {
  if (outer.width * outer.height <= inner.width * inner.height) return false;
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

function rectStyle(context: ScreenContext, rect: { x: number; y: number; width: number; height: number }) {
  const { width, height } = context.viewport;
  return {
    left: `${clampPercent((rect.x / width) * 100)}%`,
    top: `${clampPercent((rect.y / height) * 100)}%`,
    width: `${clampPercent((rect.width / width) * 100)}%`,
    height: `${clampPercent((rect.height / height) * 100)}%`,
  };
}

export function ScreenContextPreview({ context, event, compact = false }: ScreenContextPreviewProps) {
  if (!context) {
    return (
      <section className="screen-preview screen-preview--empty" aria-label="화면 맥락 미리보기">
        <strong>화면 맥락 없음</strong>
        <span>이 이벤트에는 안전한 화면 재구성 정보가 없습니다.</span>
      </section>
    );
  }

  return (
    <section className={`screen-preview${compact ? " screen-preview--compact" : ""}`} aria-label="화면 맥락 미리보기">
      <header className="screen-preview__bar">
        <span className="screen-preview__dot" />
        <span className="screen-preview__dot" />
        <span className="screen-preview__dot" />
        <strong>{context.titleMasked ?? event?.urlPath ?? "사용자 화면"}</strong>
      </header>
      <div className="screen-preview__canvas" style={{ aspectRatio: `${context.viewport.width} / ${context.viewport.height}` }}>
        {context.layoutHints.map((hint, index) => {
          const label = hint.masked ? undefined : hint.textMaskedOrLimited;
          const fitsInline = label !== undefined && hint.rect.width / context.viewport.width >= MIN_INLINE_LABEL_RATIO;
          const isRegion = context.layoutHints.some(
            (other) => other !== hint && containsRect(hint.rect, other.rect),
          );
          return (
            <div
              className={`screen-preview__hint${hint.masked ? " screen-preview__hint--masked" : ""}${isRegion ? " screen-preview__hint--region" : ""}`}
              key={`${hint.tagName}-${index}-${hint.rect.x}-${hint.rect.y}`}
              style={rectStyle(context, hint.rect)}
              {...(label ? { title: label } : {})}
            >
              {fitsInline ? <span>{label}</span> : null}
            </div>
          );
        })}
        {context.target ? (
          <div className="screen-preview__target" style={rectStyle(context, context.target.rect)}>
            <span>{context.target.textMaskedOrLimited ?? context.target.role ?? context.target.tagName}</span>
            <i role="img" aria-label="클릭 위치" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
