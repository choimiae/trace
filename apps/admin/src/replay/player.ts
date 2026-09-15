import { Replayer } from "rrweb";
import { computeFit } from "./fit.js";

export interface ReplayPlayer {
  addEvent(event: unknown): void;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  /**
   * 재생 무대를 마운트 너비에 다시 맞춘다. 창 크기가 바뀌었을 때 호출한다.
   * 녹화 크기를 아직 모르면(첫 Meta 이벤트가 아직 안 왔으면) 아무 일도 하지 않는다.
   */
  fit(): void;
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

  // rrweb 의 bare `Replayer` 는 원본 녹화 뷰포트 크기로 iframe 을 그린다 - 스스로
  // 맞추지 않는다(그건 rrweb-player 의 일). `getMetaData()` 는 startTime/endTime/
  // totalTime 뿐이라 크기가 없다(node_modules/rrweb/typings/replay/index.d.ts,
  // @rrweb/types 의 playerMetaData). 대신 `Replayer` 는 Meta 이벤트를 만나면
  // "resize" 이벤트로 { width, height } 를 알려주고, 그 순간 자신의 `iframe`/
  // `mouseTail` 에 width/height 속성을 그대로 적는다(es/rrweb/.../replay/index.js
  // 의 handleResize). 이 이벤트는 재생이 시작된 뒤 rAF 로 비동기 처리되므로
  // (Timer.start 가 requestAnimationFrame 으로 도는 큐에 delay:0 로 들어간다)
  // 생성 직후 한 번 읽어서는 값이 있다는 보장이 없다 - 그래서 폴링하지 않고
  // 이 공개 이벤트를 구독해 값이 오는 순간 맞춘다. `on`/`ReplayerEvents.Resize`
  // 는 rrweb/typings/replay/index.d.ts, @rrweb/types 의 ReplayerEvents 에 있다.
  let recorded: { width: number; height: number } | undefined;

  const fit = () => {
    if (!recorded) return;
    const { scale, height } = computeFit(mount.clientWidth, recorded.width, recorded.height);
    replayer.wrapper.style.transform = `scale(${scale})`;
    replayer.wrapper.style.transformOrigin = "top left";
    mount.style.height = `${height}px`;
  };

  replayer.on("resize", (payload) => {
    const { width, height } = payload as { width: number; height: number };
    recorded = { width, height };
    fit();
  });

  return {
    addEvent: (event) => replayer.addEvent(event as never),
    play: () => replayer.play(),
    pause: () => replayer.pause(),
    setSpeed: (speed) => replayer.setConfig({ speed }),
    fit,
    destroy: () => replayer.destroy(),
  };
}
