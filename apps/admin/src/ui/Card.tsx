import type { ReactNode } from "react";
import "./Card.css";

export function Card({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "aside";
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Tag className={className ? `card ${className}` : "card"} {...rest}>
      {children}
    </Tag>
  );
}
