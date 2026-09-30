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
