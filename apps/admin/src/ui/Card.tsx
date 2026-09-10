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
  children?: ReactNode;
  "aria-label"?: string;
  // 제목을 화면에 이미 그리는 카드는 라벨을 복제하는 대신 그 제목을 가리킨다.
  "aria-labelledby"?: string;
}) {
  return (
    <Tag className={className ? `card ${className}` : "card"} {...rest}>
      {children}
    </Tag>
  );
}
