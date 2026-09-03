// 주의 — issueType 값은 아래 치환의 허용 문자셋 `[a-z0-9|:_-]` 안에 머물러야 한다.
// issueTypeSchema 의 여섯 값(탐지기가 실제로 내는 것은 그중 네 개)이 모두 `[a-z_]`
// 라서 지금은 치환이 항등 함수다. 하지만 예컨대 "api error" 처럼 공백이나 점을 담은
// 타입을 새로 넣으면 이 함수는 id 꼬리에 "api_error" 를 쓰는데
// issues.issue_type 컬럼에는 "api error" 가 그대로 남는다. sqlite-store 의 옛 이슈
// 정리 마이그레이션은 그 컬럼으로 지은 `'|page|' || issue_type` 을 id 의 꼬리와
// **정확히** 비교하므로, 두 값이 어긋나면 page 키로 지어진 행이 접미사 불일치로
// 판정되어 지워야 하지 않을 행이 지워진다. 새 타입은 소문자·밑줄로만 짓는다.
export function issueTargetKey(input: { urlPath: string; elementKey?: string | undefined; issueType: string }): string {
  return [input.urlPath, input.elementKey ?? "page", input.issueType].join("|").replace(/[^a-z0-9|:_-]+/gi, "_");
}
