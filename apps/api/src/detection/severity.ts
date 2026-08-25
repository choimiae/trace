export function clampSeverity(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreIssue(input: {
  base: number;
  affectedSessions: number;
  hasError?: boolean;
  repeatedClicks?: number;
}): number {
  return clampSeverity(
    input.base + input.affectedSessions * 8 + (input.repeatedClicks ?? 0) * 6 + (input.hasError ? 18 : 0),
  );
}
