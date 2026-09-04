import { type issueTypeSchema } from "./events.js";
import type { z } from "zod";

type IssueType = z.infer<typeof issueTypeSchema>;

// 이슈 유형의 사람이 읽는 이름은 여기서만 정한다. 서버가 만드는 문장과
// 관리자 화면이 각자 이름을 들고 있으면 같은 유형이 화면마다 다르게 불린다.
const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  dead_click_cluster: "반응 없는 클릭",
  rage_click: "분노 클릭",
  long_pause: "긴 멈춤",
  scroll_friction: "스크롤 마찰",
  error_friction: "오류 마찰",
  form_friction: "폼 마찰",
};

// 계약에 없는 유형이 들어와도 화면이 비지 않게 받은 값을 그대로 돌려준다.
export function issueTypeLabel(issueType: string): string {
  return ISSUE_TYPE_LABELS[issueType as IssueType] ?? issueType;
}
