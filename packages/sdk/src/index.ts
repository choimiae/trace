import { TraceClient } from "./client.js";
import { installCollectors } from "./collectors.js";
import { Identity } from "./identity.js";
import { autoInstall, type Consent, type InstallOptions } from "./install.js";
import { loadReplay, stopReplay } from "./replay-loader.js";

let client: TraceClient | undefined;
// 동의 상태를 여기에도 둔다. TraceClient 는 자기 큐만 막을 뿐이고, 리플레이는
// 그 큐를 지나지 않는 별도 경로다.
let consentState: Consent = "granted";
let replayTarget: { projectId: string; endpoint: string } | undefined;

function startReplayIfAllowed(): void {
  if (!client || !replayTarget) return;
  // 리플레이는 켜진 프로젝트에서만 켜진다. 실패해도 수집은 계속돼야 하므로
  // 기다리지 않고, loadReplay 는 절대 던지지 않는다.
  //
  // 세션 ID 는 부를 때 읽는다. 동의 보류에서 grant() 가 오면 저장소에 있던 세션을
  // 이어 받아 ID 가 바뀌므로, init 때 읽어 둔 값으로 올리면 리플레이만 다른 세션이 된다.
  void loadReplay({ ...replayTarget, sessionId: client.sessionId, isGranted: () => consentState === "granted" });
}

export function init(options: { projectId: string; endpoint?: string; consent?: Consent }) {
  const endpoint = options.endpoint ?? "/v1/events/batch";
  consentState = options.consent ?? "granted";
  client = new TraceClient({
    projectId: options.projectId,
    endpoint,
    consent: consentState,
    // 동의가 있을 때만 저장소를 읽고 쓴다. 보류면 grant() 가 TraceClient 를 거쳐 persist() 를 부른다.
    identity: new Identity({ persist: consentState === "granted" }),
  });
  installCollectors(client);
  replayTarget = { projectId: options.projectId, endpoint };
  startReplayIfAllowed();
  return client;
}

export const consent = {
  grant() {
    consentState = "granted";
    client?.grantConsent();
    // 배너에서 늦게 동의를 받는 것이 data-consent="pending" 의 존재 이유다.
    // loadReplay 는 문서의 표식을 보고 두 번 주입하지 않으므로 그냥 다시 부른다.
    startReplayIfAllowed();
  },
  deny() {
    consentState = "denied";
    client?.denyConsent();
    // 큐를 비우는 것만으로는 리플레이가 멈추지 않는다 - 기록기·업로드 타이머가 따로 돈다.
    stopReplay();
  },
};

declare global {
  interface Window {
    trace?: { init: typeof init; consent: typeof consent };
  }
}

if (typeof window !== "undefined") {
  window.trace = { init, consent };

  if (typeof document !== "undefined") {
    autoInstall(document.currentScript, (options: InstallOptions) => init(options));
  }
}

export { TraceClient };
export type { Consent, InstallOptions };
