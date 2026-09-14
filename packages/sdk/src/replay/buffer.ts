import { BUFFERED_CHECKPOINT_GENERATIONS } from "@trace/shared/recording-limits";

export interface RecordedEvent {
  type: number;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * rrweb 이벤트를 체크포인트 세대로 나눠 담는다. 세대는 `isCheckout` 이 붙은
 * 전체 스냅샷에서 시작하므로 세대 하나만으로도 그 자체로 재생 가능하다.
 *
 * 세대를 두 개 쥐는 것이 이 클래스의 요점이다. 하나만 쥐면 체크포인트 직후에
 * 난 문제는 앞 맥락이 거의 0초가 되어, 같은 종류의 문제인데 어떤 건 앞이
 * 통째로 없다. 두 개면 2~4분이 보장된다.
 *
 * 메모리: 스냅샷은 압축 전 약 383 KB, 변경분은 209 B/s(4분에 50 KB)다.
 * 세대마다 스냅샷을 하나씩 들고 있으므로 약 816 KB 를 예상한다 - 실제 값은
 * Task 13 의 브라우저 확인에서 잰다.
 */
export class CheckpointBuffer {
  private generations: RecordedEvent[][] = [[]];
  private discarding = true;

  constructor(private readonly maxGenerations: number = BUFFERED_CHECKPOINT_GENERATIONS) {}

  push(event: RecordedEvent, isCheckout = false): void {
    if (isCheckout) {
      this.generations.push([]);
      while (this.discarding && this.generations.length > this.maxGenerations) {
        this.generations.shift();
      }
    }

    this.generations[this.generations.length - 1]!.push(event);
  }

  /**
   * 트리거가 걸린 뒤 호출한다. 그 뒤로는 계속 이어 올리므로, 세대를 버리면
   * 아직 올리지 못한 구간이 사라져 재생에 구멍이 생긴다.
   */
  stopDiscarding(): void {
    this.discarding = false;
  }

  drain(): RecordedEvent[] {
    const events = this.generations.flat();
    this.generations = [[]];
    return events;
  }

  get size(): number {
    let total = 0;
    for (const generation of this.generations) total += generation.length;
    return total;
  }
}
