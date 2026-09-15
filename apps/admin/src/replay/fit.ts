export interface Fit {
  /** `.replayer-wrapper` 에 적용할 배율. 1 을 넘지 않는다 - 위로는 키우지 않는다. */
  scale: number;
  /** 마운트에 적용할 높이(px). 카드가 늘어난 재생 화면을 그대로 감싸도록. */
  height: number;
}

/**
 * 재생 무대를 마운트 너비에 맞춘다.
 *
 * rrweb 의 bare `Replayer` 는 스스로 크기를 맞추지 않는다(그건 `rrweb-player`
 * 의 일이고, 우리는 그것을 쓰지 않기로 했다) - 그래서 원본 녹화 뷰포트 크기를
 * 안 뒤 여기서 계산한다. 마운트나 녹화 너비를 아직 모르면(0 이하) 그대로
 * 둔다(scale 1, 원본 높이) - 호출부가 아직 값을 몰라 호출한 경우다.
 */
export function computeFit(mountWidth: number, recordedWidth: number, recordedHeight: number): Fit {
  if (mountWidth <= 0 || recordedWidth <= 0) return { scale: 1, height: recordedHeight };

  const scale = Math.min(1, mountWidth / recordedWidth);
  return { scale, height: recordedHeight * scale };
}
