// 쿠키를 막은 브라우저와 샌드박스 iframe 에서는 window.sessionStorage 를 읽는
// 순간 SecurityError 가 난다. jsdom 에서는 속성을 덮어 그 상태를 만든다.
export function breakStorage(name: "sessionStorage" | "localStorage"): () => void {
  const original = Object.getOwnPropertyDescriptor(window, name);
  Object.defineProperty(window, name, {
    configurable: true,
    get() {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(window, name, original);
  };
}
