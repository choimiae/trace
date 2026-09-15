import { Replayer } from "rrweb";

export interface ReplayPlayer {
  addEvent(event: unknown): void;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  destroy(): void;
}

/**
 * rrweb `Replayer` 를 감싸는 경계.
 *
 * `Replayer` 는 jsdom 에서 돌지 않으므로 화면은 이 함수를 주입받는다.
 * 테스트는 가짜를 넘기고, 실제 동작은 브라우저에서 확인한다(Task 9).
 *
 * rrweb 의 `eventWithTime` 은 관리자 타입에 들이지 않는다 — 이벤트 본문은
 * 모르는 채로 다루기로 했으므로 여기서 `as never` 로 넘긴다.
 */
export function createPlayer(mount: HTMLElement, firstEvents: unknown[]): ReplayPlayer {
  const replayer = new Replayer(firstEvents as never[], { root: mount });

  return {
    addEvent: (event) => replayer.addEvent(event as never),
    play: () => replayer.play(),
    pause: () => replayer.pause(),
    setSpeed: (speed) => replayer.setConfig({ speed }),
    destroy: () => replayer.destroy(),
  };
}
