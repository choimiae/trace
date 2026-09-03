// 32비트 누산기 두 개를 서로 다른 오프셋·소수로 돌려 16 hex 를 만든다. 입력이
// 다양해지면 서로 다른 입력이 같은 해시로 충돌할 확률이 오르고, 요소 지문에서
// 그 충돌은 서로 다른 컨트롤을 한 요소로 합치는 버그와 증상이 같다 — 32비트는
// 서로 다른 입력 약 77,000개에서 충돌 확률 50%다. 요소 지문 계약이 16 hex 까지
// 허용하므로 계약을 바꾸지 않고 폭을 두 배로 쓸 수 있다.
// BigInt 는 SDK 번들 예산 때문에 쓰지 않는다.
export function hash64Hex(input: string): string {
  let low = 0;
  let high = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    low = (low * 31 + code) >>> 0;
    // 16777619 를 평범하게 곱하면 2^53 을 넘어 정밀도를 잃는다. Math.imul 은
    // 32비트 곱을 정확히 낸다.
    high = Math.imul(high ^ code, 16777619) >>> 0;
  }

  return `${low.toString(16).padStart(8, "0")}${high.toString(16).padStart(8, "0")}`;
}
