import type { Issue } from "@trace/shared";
import "./Chip.css";

export type ChipStatus = "good" | "warn" | "serious" | "crit";

export function Chip({ status, label }: { status: ChipStatus; label: string }) {
  return (
    <span className={`chip chip-${status}`}>
      <i className="chip-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function issueStatusToChip(status: Issue["status"]): { status: ChipStatus; label: string } {
  switch (status) {
    case "new":
      return { status: "crit", label: "신규" };
    case "reviewing":
      return { status: "warn", label: "검토 중" };
    case "resolved":
      return { status: "good", label: "해결됨" };
    case "ignored":
      return { status: "good", label: "무시함" };
  }
}
