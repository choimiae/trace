import type { ScreenContext, TraceEvent } from "@trace/shared";

export interface ScreenContextPreviewProps {
  context?: ScreenContext;
  event?: TraceEvent;
  compact?: boolean;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
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
        {context.layoutHints.map((hint, index) => (
          <div
            className={`screen-preview__hint${hint.masked ? " screen-preview__hint--masked" : ""}`}
            key={`${hint.tagName}-${index}-${hint.rect.x}-${hint.rect.y}`}
            style={rectStyle(context, hint.rect)}
          >
            {!hint.masked && hint.textMaskedOrLimited ? <span>{hint.textMaskedOrLimited}</span> : null}
          </div>
        ))}
        {context.target ? (
          <div className="screen-preview__target" style={rectStyle(context, context.target.rect)}>
            <span>
              {context.target.textMaskedOrLimited ?? context.target.role ?? context.target.tagName ?? event?.type ?? "이벤트"}
            </span>
            <i role="img" aria-label="클릭 위치" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
