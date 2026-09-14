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

  /**
   * 쌓인 이벤트를 모두 꺼내고 버퍼를 비운다. 비운 자리는 `isCheckout` 없이
   * 시작하는 세대라 그 자체로는 재생할 스냅샷을 갖지 않는다 - 이후에 오는
   * 이벤트는 방금 꺼내 간 배치를 앵커로 삼는 델타다.
   *
   * 그래서 이 메서드가 돌려준 배치는 유실 없이, 순서 그대로 서버에 닿아야
   * 한다. 하나라도 빠지거나 순서가 뒤바뀌면 그 뒤 델타가 가리킬 스냅샷이
   * 없어져 재생이 아무것도 그리지 못한다 - 예외도, 실패하는 테스트도 없이
   * 조용히 그렇게 된다. 그 배달을 보장하는 것은 이 클래스의 일이 아니다
   * (Task 12 업로더의 몫).
   *
   * 같은 이유로 `stopDiscarding()` 이전에 부르도록 만든 메서드가 아니다 -
   * 트리거 전 drain 은 두 세대를 굴려 보장하려던 2~4분 맥락을 그 자리에서
   * 지워 버린다. 세대 버림 로직과 상호작용하도록 설계되지 않았다.
   */
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
