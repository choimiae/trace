# 화면 맥락 기반 제품 마찰 대시보드 설계

작성일: 2026-09-02

## 배경

Trace의 제품 방향은 GA식 방문 통계가 아니라, 운영자와 PM이 사용자가 어디서 막히는지 이해하고 제품 개선 우선순위를 정하게 돕는 것이다. 현재 대시보드는 문제 목록, 점수, 화면 경로, 세션 타임라인을 제공하지만 관리자가 사용자 화면을 직접 본 것처럼 상황을 이해하기에는 맥락이 부족하다.

이번 방향은 이벤트마다 원본 스크린샷을 저장하지 않는다. 대신 마스킹된 화면 맥락, 클릭 위치, 요소 정보, 이벤트 흐름, 오류 단서를 조합해 사용자가 본 상황을 안전하게 재구성한다.

## 목표

- 대시보드 첫 화면에서 운영자가 가장 중요한 사용자 막힘을 하나의 흐름으로 이해한다.
- 관리자가 "사용자가 어떤 화면에서 무엇을 눌렀고, 어떤 반응이 없었고, 어떤 오류가 이어졌는지"를 빠르게 파악한다.
- 개발자가 상세 화면에서 재현 단서로 쓸 수 있는 URL, 요소, selector hash, 오류 유형, 대표 세션 흐름을 확인한다.
- 개인정보와 SDK 성능 부담을 늘리지 않는 방식으로 화면 맥락을 제공한다.

## 비목표

- 모든 이벤트마다 실제 픽셀 스크린샷을 저장하지 않는다.
- 입력값, 사용자 이름, 이메일, 주소, 카드 정보 등 민감 원문을 저장하지 않는다.
- rrweb 수준의 전체 세션 리플레이를 이번 범위에 포함하지 않는다.
- GA식 유입, 캠페인, 방문자 세그먼트 분석을 이번 범위에 포함하지 않는다.

## 제품 원칙

1. **화면 먼저, 숫자는 보조**
   운영자는 추상적인 수치보다 사용자가 막힌 화면과 행동 맥락을 먼저 본다.

2. **하나의 흐름으로 읽히는 대시보드**
   첫 화면은 카드 나열보다 `발견 -> 사용자 의도 -> 막힘 -> 원인 후보 -> 다음 액션` 순서로 읽힌다.

3. **운영 해석과 개발 근거를 분리하되 함께 둔다**
   운영자는 개선 방향을 읽고, 개발자는 같은 화면에서 기술 단서를 확인한다.

4. **개인정보 안전 기본값**
   화면 맥락은 실제 화면 원본이 아니라 마스킹된 구조와 이벤트 메타데이터로 재구성한다.

## 핵심 UX

### 대시보드 첫 화면

첫 화면은 `Product Friction Dashboard`로 재구성한다.

- 상단: 가장 중요한 제품 마찰 1개를 문장으로 요약한다.
- 중앙: 마스킹된 화면 맥락 미리보기와 클릭 지점을 보여준다.
- 우측: 운영 해석, 근거, 다음 액션을 배치한다.
- 하단: 대표 이벤트 흐름과 다른 주요 개선 후보를 보여준다.

추천 레이아웃은 `화면 스냅샷 중심`이다. 사용자는 실제 스크린샷을 보는 것이 아니라, Trace가 안전하게 재구성한 화면 구조를 본다.

### 화면 맥락 미리보기

화면 미리보기는 다음 정보를 조합해 만든다.

- URL path와 redacted query
- 페이지 title
- viewport 크기
- 클릭/오류가 발생한 요소의 bounding box
- 요소 role, tag, masked text
- 주변 상위 컨테이너의 안전한 구조
- 입력 필드와 민감 텍스트는 `MASKED` 또는 블록으로 표시
- 클릭 위치는 링 또는 작은 하이라이트로 표시

화면 위에는 복잡한 말풍선을 올리지 않는다. 클릭 위치 표시만 화면 내부에 두고, 설명은 우측 근거 패널 또는 하단 이벤트 흐름에 둔다.

### 이슈 상세

이슈 상세는 대시보드에서 본 대표 흐름을 더 깊게 확인하는 화면이다.

- 대표 세션의 화면 맥락 필름스트립
- 시간순 이벤트 타임라인
- 막힘 이벤트 전후 5~10개 이벤트
- 오류 유형과 안전한 오류 메타데이터
- 개발자 전달용 근거 묶음

상세 화면은 "정확히 확인"하는 곳이고, 대시보드 첫 화면은 "무엇을 개선할지 판단"하는 곳이다.

## 수집 데이터 설계

### TraceEvent 확장

기존 이벤트 필드에 `screenContext` 선택 필드로 화면 맥락을 추가한다.

```ts
interface ScreenContext {
  titleMasked?: string;
  viewport: {
    width: number;
    height: number;
  };
  target?: {
    tagName: string;
    role?: string;
    textMaskedOrLimited?: string;
    selectorHash?: string;
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  layoutHints: Array<{
    tagName: string;
    role?: string;
    textMaskedOrLimited?: string;
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    masked: boolean;
  }>;
}
```

`layoutHints`는 전체 DOM을 저장하지 않는다. 이벤트 대상 주변의 제한된 깊이와 화면상 주요 landmark만 저장한다.

### 수집 시점

모든 이벤트에서 화면 맥락을 수집하지 않는다.

기본 수집 대상:

- `click`
- `js_error`
- `api_error`
- `idle`

고비용 맥락 수집 대상:

- rage click 후보
- dead click 후보
- long pause 후보
- 오류 발생 직후

MVP에서는 SDK가 클릭 이벤트마다 가벼운 `target rect`와 안전한 요소 메타데이터를 보낸다. 서버는 issue 감지 후 해당 이벤트 주변 타임라인을 조합해 화면 맥락을 보여준다. 더 무거운 layout snapshot은 후속 단계로 둔다.

## 개인정보 정책

- input, textarea, contenteditable 내부 텍스트는 저장하지 않는다.
- 이메일, 전화번호, 긴 숫자, 토큰 형태 텍스트는 기존 `redactText` 규칙으로 제거한다.
- 민감 필드로 판단되는 요소는 텍스트 대신 `MASKED` 상태만 저장한다.
- 화면 재구성은 원본 픽셀 이미지가 아니므로 이미지 안에 민감정보가 박제되지 않는다.
- 화면 맥락 보관 기간은 원본 이벤트 보관 정책을 따른다.

## 성능 정책

- SDK 번들 크기 예산을 유지한다.
- 이벤트마다 canvas screenshot을 만들지 않는다.
- layout snapshot은 throttle/debounce 대상이며, 최초 MVP에서는 target rect 중심으로 제한한다.
- payload 크기 상한을 둔다. 단일 이벤트의 화면 맥락은 작은 JSON 구조여야 한다.
- 수집 실패는 고객 사이트 동작에 영향을 주지 않는다.

## API와 저장소

MVP에서는 shared schema에 `screenContext` 선택 필드를 추가하고, SQLite `events` 테이블에 `screen_context` JSON 컬럼을 추가한다. 이 방식은 화면 맥락이 일반 metadata와 섞이지 않아 API/관리자 UI가 안정적으로 사용할 수 있다.

관리자 API는 다음 응답을 제공한다.

- `GET /admin/api/projects/:projectId/summary`: 대시보드 요약과 주요 issue 유지
- `GET /admin/api/projects/:projectId/issues`: 각 issue에 대표 화면 맥락 요약 추가 가능
- `GET /admin/api/issues/:issueId`: 상세 issue와 대표 screen context 반환
- `GET /admin/api/sessions/:sessionId/timeline`: timeline event에 screen context 포함

## 화면 구성

### 첫 화면

1. 오늘의 핵심 마찰 문장
2. 마스킹된 사용자 화면 미리보기
3. 운영 해석
4. 근거 묶음
5. 다음 액션
6. 대표 이벤트 흐름
7. 주요 개선 후보 목록

### 상세 화면

1. 이슈 제목과 영향 범위
2. 화면 필름스트립
3. 시간순 이벤트 타임라인
4. 선택 이벤트의 화면 맥락
5. 오류/selector/API 근거
6. 개발자 전달 요약

## 단계별 구현 전략

### 1단계: target rect 기반 화면 맥락

- SDK가 클릭 대상의 rect, role, masked text, viewport를 수집한다.
- 서버가 저장하고 관리자 타임라인에 노출한다.
- 대시보드에 대표 이슈의 화면 맥락 미리보기를 만든다.

### 2단계: 주변 layout hints

- 대상 주변 컨테이너와 주요 버튼/링크/입력 필드의 위치를 제한적으로 수집한다.
- 관리자 화면에서 실제 화면처럼 재구성한다.

### 3단계: 상세 필름스트립

- 대표 세션의 주요 이벤트를 화면 프레임으로 나열한다.
- 각 프레임은 마스킹된 화면 구조, 클릭 지점, 이벤트 설명을 포함한다.

### 4단계: 전체 리플레이 검토

- 사용자가 충분한 가치를 느낀 뒤 rrweb류 세션 리플레이 도입 여부를 판단한다.
- 별도 opt-in, 보관 기간, 마스킹 정책, 성능 예산을 새로 설계한다.

## 테스트

- SDK는 민감 input 텍스트를 screen context에 넣지 않는지 검증한다.
- SDK는 클릭 대상 rect와 viewport를 event에 포함하는지 검증한다.
- shared schema는 screen context의 크기와 안전한 텍스트만 허용한다.
- ingestion은 unsafe screen context를 sanitize하거나 거부한다.
- admin UI는 screen context가 없을 때도 기존 timeline을 보여준다.
- dashboard는 대표 issue에 screen context가 있으면 화면 미리보기를 렌더링한다.

## 성공 기준

- 운영자가 대시보드 첫 화면에서 가장 큰 제품 마찰과 개선 후보를 설명할 수 있다.
- 운영자가 사용자가 본 화면과 클릭 지점을 오해 없이 이해한다.
- 개발자가 상세 화면에서 재현에 필요한 URL, 요소, 오류 단서를 확인할 수 있다.
- 원본 스크린샷 없이도 사용자 흐름을 충분히 재구성한다.
- SDK 성능과 개인정보 정책이 기존 MVP 원칙을 깨지 않는다.
