import { useEffect, useRef, useState } from "react";
import { ApiError, getRecordingChunk, getRecordingManifest } from "../api.js";
import { assembleChunk } from "../replay/assemble.js";
import { createPlayer as createRealPlayer, type ReplayPlayer } from "../replay/player.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

// "empty" 는 매니페스트가 청크를 하나도 안 줬을 때만 쓴다("기본 7일 뒤
// 지워집니다" 라는 보존 문구가 여기 실린다 - 데이터의 처분에 대한 주장이다).
// 매니페스트가 청크를 줬는데 그 뒤로 재생을 시작하지 못하면(청크 요청 실패,
// 첫 청크가 깨짐) "unreadable" 이다 - 기록은 DB 에 있을 수 있고, 다만 지금
// 읽지 못했을 뿐이다. 이 둘을 섞으면 운영자가 멀쩡한 기록을 없다고 오해한다.
type LoadState = "loading" | "empty" | "playing" | "truncated" | "forbidden" | "unreadable";

export function SessionReplayPage({
  projectId,
  sessionId,
  onBack,
  onAuthExpired,
  createPlayer = createRealPlayer,
}: {
  projectId: string;
  sessionId: string;
  onBack: () => void;
  /** 401 일 때 App 이 로그인 화면으로 돌린다. 화면이 스스로 라우팅하지 않는다. */
  onAuthExpired: () => void;
  createPlayer?: (mount: HTMLElement, firstEvents: unknown[]) => ReplayPlayer;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<ReplayPlayer | undefined>(undefined);
  // 두 콜백은 effect 의 의존성에 넣지 않는다. 호출자가 인라인 화살표를 넘기면
  // 매 렌더마다 identity 가 바뀌어, 재생 중 state 가 한 번만 바뀌어도 effect 가
  // 정리·재실행되며 방금 만든 재생기를 부순다. 재생은 projectId·sessionId 가
  // 바뀔 때만 다시 시작한다.
  const createPlayerRef = useRef(createPlayer);
  const onAuthExpiredRef = useRef(onAuthExpired);
  const [state, setState] = useState<LoadState>("loading");
  const [speed, setSpeed] = useState(1);
  // 재생기가 아직 없을 때(청크를 받는 중) 고른 배속을 담아 둔다. 재생기가 막
  // 만들어지는 순간 이 값을 읽어 적용한다 - 그러지 않으면 로딩 중 고른 배속이
  // `playerRef.current?.setSpeed(...)` 의 no-op 뒤로 조용히 사라진다.
  const speedRef = useRef(speed);

  useEffect(() => {
    onAuthExpiredRef.current = onAuthExpired;
  });

  // 재생 무대는 마운트 너비에 맞춰 줄어든 채로 그려진다(player.ts 의 fit()).
  // 관리자 창 크기가 바뀌면 다시 맞춰야 한다 - 화면은 rrweb 을 모르니 그냥
  // `fit()` 을 부른다. 언마운트 뒤에는 부르지 않도록 정리한다.
  useEffect(() => {
    const handleResize = () => playerRef.current?.fit();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let player: ReplayPlayer | undefined;

    const run = async () => {
      const manifest = await getRecordingManifest(projectId, sessionId);
      if (cancelled) return;
      if (manifest.length === 0) {
        setState("empty");
        return;
      }

      for (const chunk of manifest) {
        const raw = await getRecordingChunk(projectId, sessionId, chunk.seq);
        if (cancelled) return;

        const assembled = assembleChunk(raw);
        if (!assembled.ok) {
          // 전체를 버리지 않는다. 여기까지 받은 것은 볼 수 있다. 아직 재생기가
          // 없으면 "empty" 가 아니라 "unreadable" 이다 - 매니페스트는 청크를
          // 줬으니 기록이 없다는 뜻이 아니다.
          setState(player ? "truncated" : "unreadable");
          return;
        }

        if (!player) {
          const mount = mountRef.current;
          if (!mount) return;
          player = createPlayerRef.current(mount, assembled.events);
          playerRef.current = player;
          player.setSpeed(speedRef.current);
          player.play();
          setState("playing");
          continue;
        }

        for (const event of assembled.events) player.addEvent(event);
      }
    };

    void run().catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof ApiError && error.status === 401) {
        onAuthExpiredRef.current();
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setState("forbidden");
        return;
      }
      // 그 밖의 실패(청크 요청 자체가 reject 되는 경우 등)도 마찬가지로 다룬다 -
      // 이미 재생 중이었으면 "truncated", 아니면 "unreadable" 이다. 여기 이르는
      // 시점엔 이미 manifest.length === 0 분기에서 반환했으므로(위) "empty" 로
      // 떨어질 이유가 없다 - 매니페스트가 비어 있지 않은 한 도달하지 않는다.
      setState((current) => (current === "playing" ? "truncated" : "unreadable"));
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = undefined;
    };
  }, [projectId, sessionId]);

  const changeSpeed = (next: number) => {
    setSpeed(next);
    speedRef.current = next;
    playerRef.current?.setSpeed(next);
  };

  return (
    <main className="app-shell replay-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Trace 관리자</p>
          <h1>세션 재생</h1>
          <p className="replay-subtitle">{sessionId}</p>
        </div>
        <div className="header-actions">
          <Button onClick={onBack}>대시보드로 돌아가기</Button>
        </div>
      </header>

      <p className="replay-note" role="note">
        기록은 스타일을 링크로 두므로 재생기가 <strong>원본 사이트의 스타일시트를 불러옵니다.</strong>{" "}
        그 사이트가 떠 있지 않거나 주소가 바뀌었으면 재생 화면이 원본과 다르게 보입니다.
      </p>

      {state === "empty" ? (
        <p className="empty-state">
          이 세션은 녹화가 없습니다. 리플레이를 켜기 전이거나 보존 기간이 지났습니다.
        </p>
      ) : null}

      {state === "truncated" ? <p className="replay-error">이후 기록을 읽지 못했습니다.</p> : null}

      {state === "unreadable" ? (
        <p className="replay-error">
          이 세션의 기록을 읽지 못했습니다. 서버 오류이거나 손상된 데이터일 수 있습니다. 잠시 후 다시
          시도해 주세요.
        </p>
      ) : null}

      {state === "forbidden" ? (
        <p className="replay-error">이 프로젝트에 접근할 수 없습니다.</p>
      ) : null}

      <Card className="replay-stage">
        <div className="replay-mount" ref={mountRef} />
        {state === "playing" || state === "truncated" ? (
          <div className="replay-controls">
            <Button onClick={() => playerRef.current?.play()}>재생</Button>
            <Button onClick={() => playerRef.current?.pause()}>일시정지</Button>
            {[1, 2, 4].map((option) => (
              <Button
                key={option}
                variant={speed === option ? "primary" : "secondary"}
                onClick={() => changeSpeed(option)}
              >
                {option}x
              </Button>
            ))}
          </div>
        ) : null}
      </Card>
    </main>
  );
}
