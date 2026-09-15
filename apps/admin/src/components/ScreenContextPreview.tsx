import type { ScreenContext, TraceEvent } from "@trace/shared";

export interface ScreenContextPreviewProps {
  context?: ScreenContext;
  event?: TraceEvent;
  compact?: boolean;
  /** 화면 글자를 레이어로 띄울지. compact 에서는 무시한다. */
  showLabels?: boolean;
  /** 주면 타이틀 바에 스위치를 그린다. compact 에서는 그리지 않는다. */
  onToggleLabels?: (next: boolean) => void;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

// 상자 안에는 글자를 넣지 않는다. 넣으려 하면 뷰포트를 축소해 그리는 미리보기에서
// 글자만 안 줄어, 48px 메뉴 상자가 화면에서 22px 인데 다섯 글자를 밀어 넣어야 했다
// ("시스템설정" 이 "템설" 로 읽혔다). 크기로 고르던 문턱(0.06)을 없애고, 스위치로
// 전부 보이거나 전부 숨긴다 — 켜면 상자 밖으로 넘치는 레이어에 그린다.

function rectStyle(context: ScreenContext, rect: { x: number; y: number; width: number; height: number }) {
  const { width, height } = context.viewport;
  return {
    left: `${clampPercent((rect.x / width) * 100)}%`,
    top: `${clampPercent((rect.y / height) * 100)}%`,
    width: `${clampPercent((rect.width / width) * 100)}%`,
    height: `${clampPercent((rect.height / height) * 100)}%`,
  };
}

export function ScreenContextPreview({
  context,
  event,
  compact = false,
  showLabels = false,
  onToggleLabels,
}: ScreenContextPreviewProps) {
  // compact 는 타임라인의 이벤트별 미리보기다(약 340px). 그 크기에서는 라벨
  // 간격이 11px 인데 글자 높이가 14px 이라 세로로도 겹쳐 덩어리가 된다.
  const labelsVisible = showLabels && !compact;
  const switchVisible = onToggleLabels !== undefined && !compact;
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
        {switchVisible ? (
          <label className="screen-preview__switch">
            {/* 네이티브 체크박스를 눈에서만 숨기고 track 으로 그린다. div 로
                바꾸면 키보드로 못 켜고 스크린리더가 상태를 못 읽는다. */}
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(changeEvent) => onToggleLabels(changeEvent.target.checked)}
            />
            <span className="screen-preview__switch-track" aria-hidden="true" />
            글자 보기
          </label>
        ) : null}
      </header>
      <div className="screen-preview__canvas" style={{ aspectRatio: `${context.viewport.width} / ${context.viewport.height}` }}>
        {context.layoutHints.map((hint, index) => {
          const label = hint.masked ? undefined : hint.textMaskedOrLimited;
          return (
            <div
              className={`screen-preview__hint${hint.masked ? " screen-preview__hint--masked" : ""}`}
              key={`${hint.tagName}-${index}-${hint.rect.x}-${hint.rect.y}`}
              style={rectStyle(context, hint.rect)}
              {...(label ? { title: label } : {})}
            />
          );
        })}
        {labelsVisible ? (
          /* 상자 안이 아니라 위에 얹는다. 넘쳐도 자르지 않고, 겹쳐도 그대로 둔다 —
             자리를 옮기면 어느 상자의 글자인지 알 수 없게 된다. */
          <div className="screen-preview__labels">
            {context.layoutHints.map((hint, index) =>
              hint.masked || hint.textMaskedOrLimited === undefined ? null : (
                <span
                  className="screen-preview__label"
                  key={`label-${hint.tagName}-${index}-${hint.rect.x}-${hint.rect.y}`}
                  style={{
                    left: `${clampPercent((hint.rect.x / context.viewport.width) * 100)}%`,
                    top: `${clampPercent((hint.rect.y / context.viewport.height) * 100)}%`,
                  }}
                >
                  {hint.textMaskedOrLimited}
                </span>
              ),
            )}
          </div>
        ) : null}
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
