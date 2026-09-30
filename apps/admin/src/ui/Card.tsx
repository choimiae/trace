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
  // 세션 상세처럼 카드가 곧 다이얼로그인 경우가 있다. 태그를 바꾸는 대신
  // 역할만 덮어쓴다.
  role?: string;
  "aria-modal"?: boolean | "true" | "false";
}) {
  return (
    <Tag className={className ? `card ${className}` : "card"} {...rest}>
      {children}
    </Tag>
  );
}
