import { Button } from "../ui/Button.js";

interface StatusAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

export function StatusPage({
  title,
  description,
  action,
  actions,
}: {
  title: string;
  description?: string;
  action?: StatusAction;
  actions?: StatusAction[];
}) {
  const visibleActions = actions ?? (action ? [action] : []);

  return (
    <main className="app-shell auth-state">
      <p className="eyebrow">Trace 관리자</p>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {visibleActions.length > 0 ? (
        <div className="status-actions">
          {visibleActions.map((visibleAction) => (
            <Button
              key={visibleAction.label}
              variant={visibleAction.variant ?? "primary"}
              onClick={visibleAction.onClick}
            >
              {visibleAction.label}
            </Button>
          ))}
        </div>
      ) : null}
    </main>
  );
}
