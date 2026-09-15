# 세션 리플레이 — 재생 (B)

## 배경

`A`(기록·전송)는 2026-09-14 에 머지됐다(`6a76815`). A 스펙 §8 이 이 작업을 하위 프로젝트 `B` 로 잡아 뒀고, §6 에 **"A 만으로는 동작한다를 말할 수 없다. A+B 를 묶어 한 번 검증한다"** 고 적혀 있다. 이 스펙이 그 B 다.

2026-09-15 에 관리자 화면의 리플레이 설정(`8e1326d`)까지 붙어서, 운영자가 화면에서 켜고 실제로 기록이 쌓이는 것까지 확인됐다. 사용자 앱(localhost:3000)에서 잰 값이다.

| 항목 | 값 |
| --- | --- |
| 청크 1개 (gzip 저장분) | 29,013 B |
| 같은 청크를 푼 JSON | 304,493 B |
| 배율 | **10.5배** |

**지금 없는 것은 볼 방법뿐이다.** 기록은 `session_recordings` 에 쌓이는데 관리자에 조회 라우트도 화면도 없다.

## 목표

- 기록이 올라온 세션을 **목록에서 찾아** 재생할 수 있다.
- 첫 청크가 도착하면 **바로 재생이 시작**되고 나머지는 뒤에서 채워진다.
- 서버는 재생을 위해 **압축을 풀지 않는다.**
- A 스펙 §6 이 B 에 미뤄 둔 세 가지(흐름으로 읽히는가 · CSS 링크가 붙는가 · 마스킹 후에도 이해되는가)를 이 작업으로 확인한다.

## 목표가 아닌 것

- **와이어프레임 걷어내기.** A 스펙 §8 의 `C` 다. A+B 확인 후에 한다.
- **기록 편집·내보내기·공유 링크.** 기록은 보존 기간 안에서 관리자 화면으로만 본다.
- **세션 검색·필터.** 목록은 최근 순 한 가지다. 기록이 트리거된 세션만 올라오므로 애초에 많지 않다.
- **서버의 마스킹 재판정.** A 스펙 §5 그대로 불가능하다.

## 1. 진입점 — 기록된 세션 목록

지금 관리자에서 세션에 도달하는 유일한 경로는 `문제 상세 → 영향 세션`(`IssueDetailPage`)이다. 여기에 재생 버튼을 붙이지 **않는다.** 리플레이는 트리거(연속 클릭·JS 오류·반응 없는 클릭)가 걸린 세션만 올라오므로, 문제의 예시 세션에 기록이 있다는 보장이 없다. 비활성 버튼을 자주 보게 된다.

대신 **올라온 기록 자체가 곧 「막힌 세션」 목록**이라는 점을 쓴다. 대시보드 아래쪽에 「기록된 세션」 `Card` 를 하나 두고, 기존 `DataTable` 로 행을 그린다. 행을 누르면 재생 화면으로 간다.

관리자는 상태 머신이므로(`App.tsx:40`) 상태를 하나 더한다.

```ts
| { type: "replay"; projectId: string; sessionId: string; csrfToken: string }
```

```
GET /admin/api/projects/:projectId/recorded-sessions
→ { sessions: [{ sessionId, startedAt, lastReceivedAt, chunkCount, eventCount, bytes }] }
```

store 에 메서드 하나를 더한다. 타입은 `apps/api/src/store/types.ts` 에, 관리자 쪽 응답 타입은 `apps/admin/src/api.ts` 에 둔다 — 기존 목록들과 같은 자리다.

```ts
listRecordedSessions(projectId: string, limit: number): Promise<RecordedSessionSummary[]>
```

`session_recordings` 를 `session_id` 로 묶어 세는 쿼리다. 인덱스 `session_recordings_project_session (project_id, session_id, seq)` 가 이미 있다. 최근 순(`max(received_at)` 내림차순), **상한 50 고정** — 질의 파라미터를 받지 않는다. 기록은 트리거가 걸린 세션만 올라오므로 페이지네이션이 필요할 만큼 쌓이는 것을 확인하기 전에는 만들지 않는다.

## 2. 전송 — 저장된 gzip 을 그대로

매니페스트와 본문을 나눈다.

```
GET /admin/api/sessions/:sessionId/recording?projectId=...
→ { chunks: [{ seq, eventCount, bytes, startedAt, receivedAt }] }

GET /admin/api/sessions/:sessionId/recording/chunks/:seq?projectId=...
→ 저장된 gzip 바이트 그대로
   Content-Encoding: gzip
   Content-Type: application/json
   Cache-Control: no-store
```

브라우저가 `Content-Encoding` 을 투명하게 풀어서 `response.json()` 이 그대로 동작한다. **서버는 압축 해제를 한 번도 하지 않고, 전송량은 1/10 이다.**

업로드 경로에서 `Content-Encoding` 을 일부러 **피한** 이유(`recording.ts` 주석: 중간 프록시가 풀어 버리면 우리가 받는 것이 gzip 인지 요청마다 달라진다)는 내려받기에 해당되지 않는다. 프록시가 풀든 말든 브라우저가 받는 것은 JSON 이다.

한 세션을 한 응답으로 합치지 않는다. 청크는 각각 **독립된 gzip JSON 문서**라 이어 붙이면 유효한 JSON 이 아니고, 합치려면 서버가 풀어야 한다 — 그게 이 설계가 피하려는 일이다.

`Cache-Control: no-store` 는 프로젝트 설정 엔드포인트(`61ed5e5`)와 같은 이유다.

## 3. 재생 화면

`SessionReplayPage` 를 새로 만든다.

1. 매니페스트를 받는다.
2. `seq` 0 부터 순서대로 청크를 받는다.
3. **첫 청크가 도착하면 `Replayer` 를 만들어 재생을 시작**하고, 이후 청크는 `replayer.addEvent` 로 뒤에서 채운다.

컨트롤은 재생·일시정지, 스크럽 슬라이더, 배속(1x/2x/4x), 경과/전체 시간이다. `rrweb-player` 를 쓰지 않는다 — Svelte 런타임을 React 관리자에 들이는 값이 버튼 몇 개보다 크다.

**조립은 순수 모듈로 분리한다.**

```ts
// apps/admin/src/replay/assemble.ts
assembleChunk(raw: unknown): { events: unknown[] } | { error: "unreadable" }
```

입력은 A 가 올린 봉투 그대로다(`recordingChunkSchema`: `projectId`·`seq`·`startedAt`·`url`·`sdkVersion`·`events`). 매니페스트가 이미 `seq` 를 주므로 조립은 `events` 만 꺼내 이어 붙인다. 이벤트 자체는 검증하지 않는다 — A 스펙이 그 이유를 적어 뒀다(모양이 rrweb 버전에 묶여 있다).

`Replayer` 는 jsdom 에서 돌지 않는다. 조립을 순수 함수로 빼면 순서·중복 `seq`·깨진 청크를 `Replayer` 없이 직접 테스트할 수 있고, 화면 테스트는 경계에서 모킹만 하면 된다.

### 번들

`rrweb` 2.0.0-alpha.4 는 이미 저장소에 있다(`packages/sdk` 의존성). 관리자에도 의존성으로 더하고, 재생 화면은 **lazy import 로 잘라 별도 청크로 뺀다** — 차트(`IssueTypeChart`·`FrictionTrendChart`)가 이미 그렇게 나뉘어 있다. 재생을 열지 않는 운영자는 받지 않는다.

### 화면에 적어야 할 것

기록은 `inlineStylesheet: false` 다(A 스펙 §1). **재생기가 원본 사이트의 스타일시트를 불러온다.** 그 사이트가 떠 있지 않거나 주소가 바뀌었으면 재생 화면이 원본과 다르게 보인다. 한 줄로 적는다.

## 4. 권한

세 라우트 모두 기존 타임라인 라우트(`admin-proxy.ts:462`)와 같은 패턴을 탄다.

```
authenticate(request, options)
  → getProjectAccess(store, projectId, authenticated, "session_recording")
```

`ProjectResourceType`(`admin-proxy.ts:617` 의 지역 타입)에 `session_recording` 을 더한다. 접근 거부는 기존처럼 감사 로그에 남는다(`auditProjectAccessDenied`).

**조회자도 볼 수 있다.** 조회자는 이미 세션 타임라인과 마스킹된 화면 글자를 보고 있어서, 재생만 막는 것은 일관성이 없고 새 권한 축을 하나 늘린다.

## 5. 오류와 빈 상태

| 상황 | 화면 |
| --- | --- |
| 기록 없음 (트리거 안 걸림 / 보존 기간 경과) | 빈 상태 — "이 세션에는 기록이 없습니다. 리플레이는 트리거가 걸린 세션만 올라오고 기본 7일 뒤 지워집니다." |
| 청크 하나가 깨져 파싱 실패 | **거기까지 재생하고** "이후 기록을 읽지 못했습니다" — 전체를 버리지 않는다 |
| 401 | 로그인 화면 (기존 `App` 패턴) |
| 403 | "이 프로젝트에 접근할 수 없습니다" |
| 없는 `seq` | 404 |

매니페스트는 기록이 없어도 **404 가 아니라 빈 배열**이다. 보존 기간이 지나 지워진 것과 애초에 트리거가 안 걸린 것을 화면이 같은 빈 상태로 다루면 되고, 둘을 구분해 봐야 운영자가 할 일이 다르지 않다.

## 6. 검증

### 라우트

- 인증 없이 401
- 프로젝트 멤버가 아니면 403 **+ 감사 로그**
- 조회자는 200
- 매니페스트 모양, 기록 없으면 빈 배열
- **청크 응답 바이트가 DB 의 BLOB 와 바이트 단위로 같다** (gzip 헤더 포함)
- 없는 `seq` 는 404
- `Cache-Control: no-store`

### store

`store-contract.test.ts` 에 `listRecordedSessions` 집계 계약을 더한다 — memory·sqlite 양쪽이 같은 계약으로 돈다.

### 화면

- 조립 순수 모듈: `seq` 순서, 중복 `seq`, 깨진 청크
- 첫 청크 도착 시점에 재생이 시작된다
- 빈 상태·부분 재생 문구
- 컨트롤(재생/일시정지/배속)

### 실측 (A+B 묶음)

A 스펙 §6 이 B 에 미뤄 둔 것들이다. **숫자가 맞아도 이것이 안 되면 의미가 없다 — 와이어프레임이 정확히 여기서 실패했다.**

- 리플레이가 **흐름으로 읽히는가**
- CSS 를 링크로 뒀을 때 관리자 화면에서 **스타일이 붙는가**
- **마스킹 후에도 이해할 수 있는가** (다 가리면 리플레이가 무의미해진다)

## 7. 남는 한계

- **거슬러 볼 수 있는 시간이 2~4분이다.** 버퍼가 체크포인트 2세대(`CHECKPOINT_INTERVAL_MS` 120초 × `BUFFERED_CHECKPOINT_GENERATIONS` 2)만 들고 있다. 트리거 이전의 먼 과거는 애초에 올라오지 않는다.
- **오래된 기록은 스타일이 깨진다.** CSS 를 링크로 두는 대가이고, 보존 기간(기본 7일)이 그 완화책이다.
- **이미지가 빈 상자로 보인다.** A 에서 187배를 지불하지 않기로 한 결과다.
- **패턴 없는 개인정보는 운영자가 셀렉터로 지정해야 가려진다.** 재생 화면은 이미 가려진 것을 보여줄 뿐 다시 판정하지 않는다.
- **긴 세션의 메모리.** 청크를 받는 대로 `Replayer` 에 넣으므로 브라우저가 세션 전체를 들고 있게 된다. 청크 상한(2 MB gzip · 5만 이벤트)과 보존 기간이 사실상의 울타리지만, 상한까지 찬 세션을 실제로 재생해 보기 전에는 모른다.
