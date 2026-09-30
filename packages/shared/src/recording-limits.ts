// SDK 리플레이 번들과 서버가 함께 쓰는 상수·가드. zod 를 import 하지 않는다 —
// 이 파일은 esbuild 로 브라우저 번들에 들어가고, 계약 스키마(recording.ts)를
// 끌어오면 zod 가 통째로 딸려온다.

/** 전체 스냅샷을 다시 찍는 주기. 버퍼가 거슬러 보는 시간의 하한을 정한다. */
export const CHECKPOINT_INTERVAL_MS = 120_000;

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
//
// **쉼표는 뺀다.** 쉼표를 받으면 목록의 한 항목이 그 자체로 목록이 되고, 그래서
// 끝에 쉼표가 붙은 ".customer-name," 같은 **컴파일되지 않는** 문자열이 검증을
// 통과했다. rrweb 은 maskTextSelector 를 모든 텍스트 노드에서 closest 로 맞춰
// 보므로 SyntaxError 하나가 기록을 통째로 죽인다(실측: Meta 하나만 나가고
// FullSnapshot 이 없다). 여러 셀렉터는 목록 항목을 여럿 두면 되니 잃는 것이 없다.
//
// 이것만으로는 부족하다 - ".foo)" 나 "]" 도 이 패턴을 통과하면서 파서를 던지게
// 한다. 여기는 저장 전 1차 관문이고, 기록을 실제로 지키는 것은 SDK 쪽의
// 컴파일 검사다(packages/sdk/src/replay/index.ts 의 compilableSelectors).
const MASK_SELECTOR_PATTERN = /^[A-Za-z0-9_\-.#[\]="' :>~+*()]+$/;

export function isSafeMaskSelector(value: string): boolean {
  if (value.length === 0 || value.length > MAX_MASK_SELECTOR_LENGTH) return false;
  return MASK_SELECTOR_PATTERN.test(value);
}
