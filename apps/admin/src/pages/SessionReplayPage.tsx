import { useEffect, useRef, useState } from "react";
import { ApiError, getRecordingChunk, getRecordingManifest } from "../api.js";
import { assembleChunk } from "../replay/assemble.js";
import { createPlayer as createRealPlayer, type ReplayPlayer } from "../replay/player.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

type LoadState = "loading" | "empty" | "playing" | "truncated" | "forbidden";

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

  useEffect(() => {
    onAuthExpiredRef.current = onAuthExpired;
  });

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
          // 전체를 버리지 않는다. 여기까지 받은 것은 볼 수 있다.
          setState(player ? "truncated" : "empty");
          return;
        }

        if (!player) {
          const mount = mountRef.current;
          if (!mount) return;
          player = createPlayerRef.current(mount, assembled.events);
          playerRef.current = player;
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
      // 그 밖의 실패는 읽지 못한 것과 같게 다룬다 - 화면이 할 수 있는 일이 같다.
      setState((current) => (current === "playing" ? "truncated" : "empty"));
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = undefined;
    };
  }, [projectId, sessionId]);

  const changeSpeed = (next: number) => {
    setSpeed(next);
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
          이 세션에는 기록이 없습니다. 리플레이는 트리거가 걸린 세션만 올라오고 기본 7일 뒤
          지워집니다.
        </p>
      ) : null}

      {state === "truncated" ? <p className="replay-error">이후 기록을 읽지 못했습니다.</p> : null}

      {state === "forbidden" ? (
        <p className="replay-error">이 프로젝트에 접근할 수 없습니다.</p>
      ) : null}

      <Card className="replay-stage">
        <div className="replay-mount" ref={mountRef} />
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
      </Card>
    </main>
  );
}
