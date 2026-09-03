// 경고 — 이 함수의 출력은 영속 키 형식이다. elementKey 가 이 값을 그대로 이슈 id 에
// 실어 보내고(issueTargetKey), 그 id 가 issues.issue_id 로 저장된다. upsertIssues 에는
// 삭제 경로가 없으므로 알고리즘을 바꾸면 새 id 로 이슈가 새로 생기고 옛 행은 아무도
// 갱신하지 않아 영구히 고아가 된다. 즉 이 파일을 고치는 일은 리팩터링이 아니라
// 마이그레이션이다 — sqlite-store 의 user_version 게이트처럼 옛 행을 정리하는 절차를
// 함께 설계해야 한다. hash.test.ts 가 고정 입력의 출력을 리터럴로 박아 두는 이유도
// 이것이다. 그 리터럴이 깨졌다면 마이그레이션이 필요하다는 신호다.
//
// 32비트 누산기 두 개를 서로 다른 오프셋·소수로 돌려 16 hex 를 만든다. 입력이
// 다양해지면 서로 다른 입력이 같은 해시로 충돌할 확률이 오르고, 요소 지문에서
// 그 충돌은 서로 다른 컨트롤을 한 요소로 합치는 버그와 증상이 같다 — 32비트는
// 서로 다른 입력 약 77,000개에서 충돌 확률 50%다. 요소 지문 계약이 16 hex 까지
// 허용하므로 계약을 바꾸지 않고 폭을 두 배로 쓸 수 있다.
// BigInt 는 SDK 번들 예산 때문에 쓰지 않는다.
//
// 두 누산기를 마무리 혼합 없이 그대로 이어 붙이면 폭은 64비트인데 실제 혼합은
// 63비트뿐이다. 곱수 31·16777619 가 둘 다 홀수라 각 레인의 최하위 비트가 입력 문자
// 코드의 패리티로 환원되고, 그러면 두 레인의 bit0 이 오프셋의 패리티에 따라 언제나
// 같거나 언제나 서로의 여집합이 되어 한 비트가 남지 않는다(옛 구현은 low 를 0,
// high 를 홀수 오프셋으로 시작해 항상 여집합이었다 — 실측으로 서로 다른 입력
// 2000개 전부 여집합). 오프셋만 바꿔서는 고쳐지지 않는다. 패리티 환원 자체를
// 끊어야 하므로, 루프를 마친 뒤 레인마다 다른 소금으로 32비트 avalanche 를 한 번
// 돌린다. avalanche 는 상위 비트를 자리 이동 XOR 로 최하위까지 끌어내리므로 각
// 레인의 bit0 이 그 레인의 32비트 전체에 의존하게 되고, 두 레인의 bit0 사이 대수적
// 관계가 끊어진다(같은 입력 2000개에서 여집합 988개 ≈ 절반). 즉 이 함수가 실제로
// 제공하는 것은 서로 독립인 두 32비트 레인, 온전한 64비트 혼합이다.
const LOW_OFFSET = 0x2545f491;
const HIGH_OFFSET = 0x811c9dc5;
const LOW_SALT = 0x9e3779b9;
const HIGH_SALT = 0x7f4a7c15;

// murmur3 의 fmix32. 자리 이동 XOR 과 32비트 곱을 번갈아 돌려 한 비트의 변화를
// 32비트 전체로 퍼뜨린다. 소금은 레인마다 달라서 두 레인이 같은 누산값에
// 도달해도 같은 출력으로 접히지 않는다.
function avalanche(value: number, salt: number): number {
  let mixed = (value ^ salt) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function hex8(value: number): string {
  return value.toString(16).padStart(8, "0");
}

export function hash64Hex(input: string): string {
  let low = LOW_OFFSET;
  let high = HIGH_OFFSET;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    low = (low * 31 + code) >>> 0;
    // 16777619 를 평범하게 곱하면 2^53 을 넘어 정밀도를 잃는다. Math.imul 은
    // 32비트 곱을 정확히 낸다.
    high = Math.imul(high ^ code, 16777619) >>> 0;
  }

  return `${hex8(avalanche(low, LOW_SALT))}${hex8(avalanche(high, HIGH_SALT))}`;
}
