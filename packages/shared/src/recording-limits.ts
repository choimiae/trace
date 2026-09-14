// SDK 리플레이 번들과 서버가 함께 쓰는 상수·가드. zod 를 import 하지 않는다 —
// 이 파일은 esbuild 로 브라우저 번들에 들어가고, 계약 스키마(recording.ts)를
// 끌어오면 zod 가 통째로 딸려온다.

/** 전체 스냅샷을 다시 찍는 주기. 버퍼가 거슬러 보는 시간의 하한을 정한다. */
export const CHECKPOINT_INTERVAL_MS = 120_000;

/**
 * 버퍼가 쥐고 있는 체크포인트 세대 수. 1 이면 0~2분(운에 달림), 2 면 2~4분을
 * 보장한다. 스냅샷은 압축 전 약 383 KB 라 세대마다 그만큼을 더 쓴다.
 */
export const BUFFERED_CHECKPOINT_GENERATIONS = 2;

/** 프로젝트마다 지정할 수 있는 마스킹 셀렉터 개수와 길이. */
export const MAX_MASK_SELECTORS = 50;
export const MAX_MASK_SELECTOR_LENGTH = 200;

/** 청크 한 건의 압축 본문 상한. Fastify bodyLimit 으로도 같은 값을 건다. */
export const MAX_RECORDING_CHUNK_BYTES = 2 * 1024 * 1024;

/**
 * 압축 해제 후 상한. 이것이 없으면 2 MB 본문이 해제 중에 수 GB 로 부풀어
 * 서버를 넘어뜨린다(압축 폭탄).
 */
export const MAX_RECORDING_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

/** 청크 한 건에 담기는 rrweb 이벤트 개수 상한. */
export const MAX_RECORDING_CHUNK_EVENTS = 50_000;

// 셀렉터는 고객 사이트 HTML 에 이미 보이는 클래스·태그명이다. 공개 설정
// 엔드포인트로 그대로 나가므로, 값의 의미보다 "파서를 흔드는 문자가 없다" 를 본다.
const MASK_SELECTOR_PATTERN = /^[A-Za-z0-9_\-.#[\]="' :>~+*(),]+$/;

export function isSafeMaskSelector(value: string): boolean {
  if (value.length === 0 || value.length > MAX_MASK_SELECTOR_LENGTH) return false;
  return MASK_SELECTOR_PATTERN.test(value);
}
