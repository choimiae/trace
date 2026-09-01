# 이벤트 보관 기간 정책 Design

작성일 2026-09-01 · 브랜치 `main`

## 배경

Trace는 수집 이벤트를 SQLite `events` 테이블에 계속 저장한다. 현재 보관 기간 설정과 정리 작업이 없어 로컬 self-hosted 사용자가 오래 실행하면 DB 파일이 계속 커진다.

## 목적

운영자가 opt-in으로 이벤트 보관 기간을 설정하면 오래된 원본 이벤트를 자동 삭제한다. 대시보드 요약과 세션 타임라인은 남아 있는 이벤트만 기준으로 동작한다.

## 범위

**한다**

- `EVENT_RETENTION_DAYS` 환경변수를 추가한다.
- 값이 없으면 기존처럼 자동 삭제하지 않는다.
- 값이 있으면 양의 정수 일수로 파싱한다.
- 서버 시작 시 cutoff 이전 `events`를 삭제한다.
- 이벤트 수집 성공 후 같은 cutoff 기준으로 `events` 정리를 시도한다.
- `MemoryStore`와 `SqliteStore` 모두 같은 `deleteEventsBefore(cutoff: string)` 계약을 구현한다.
- README와 `.env.example`에 설정을 문서화한다.

**하지 않는다**

- `issues`를 삭제하지 않는다.
- `audit_logs`, `admin_sessions`, `admin_users`, `projects`, `project_memberships`를 삭제하지 않는다.
- 프로젝트별 보관 기간을 만들지 않는다.
- UI 설정 화면을 만들지 않는다.
- DB `VACUUM` 자동 실행은 만들지 않는다.

## 정책

`EVENT_RETENTION_DAYS=30`이면 현재 시각에서 30일을 뺀 ISO 시각을 cutoff로 계산한다. `event.timestamp < cutoff`인 이벤트만 삭제한다. cutoff와 같은 timestamp는 남긴다.

서버 시작 시 한 번 정리하고, 이후 `POST /v1/events/batch`가 정상 저장된 뒤 정리한다. 수집 요청마다 정리하는 방식은 단순하고, 현재 SQLite self-hosted 규모에서는 충분하다.

정리 실패는 ingestion 성공 응답을 깨뜨리지 않는다. 이벤트 저장과 issue 감지는 이미 끝난 상태이므로, retention 실패는 다음 요청이나 다음 서버 시작 때 다시 시도할 수 있다.

## `issues` 보존 결정

이번 범위에서는 `issues`를 삭제하지 않는다. `issues`는 원본 이벤트보다 작고 운영자가 보는 문제 기록이다. 오래된 이벤트가 삭제되면 해당 issue의 `example_session_ids`로 조회한 세션 타임라인이 비어 있을 수 있지만, 문제 기록 자체는 유지한다.

## 설정

환경변수:

| 이름 | 설명 |
| --- | --- |
| `EVENT_RETENTION_DAYS` | 선택. 양의 정수. 설정하면 cutoff 이전 `events`를 삭제한다. |

잘못된 값(`0`, 음수, 소수, 안전하지 않은 큰 수)은 서버 시작을 실패시킨다.

## 테스트 기준

- store 계약: cutoff 이전 이벤트만 삭제하고, cutoff와 같은 이벤트 및 이후 이벤트는 남긴다.
- store 계약: 다른 프로젝트 이벤트도 같은 cutoff 기준으로 삭제한다.
- 설정 파서: 미설정이면 retention 없음, 양의 정수면 일수 반환, 잘못된 값은 오류.
- 서버 시작: retention 설정이 있으면 시작 시 오래된 이벤트를 삭제한다.
- ingestion route: 저장과 issue 감지 후 오래된 이벤트를 삭제한다.
- ingestion route: retention 미설정이면 이벤트를 삭제하지 않는다.
