import type { ReactNode } from "react";
import "./Button.css";

export function Button({
  variant = "secondary",
  type = "button",
  disabled,
  onClick,
  children,
  ...rest
}: {
  variant?: "primary" | "secondary" | "icon";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <button
      className={`button button-${variant}`}
      type={type}
      disabled={disabled}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}
