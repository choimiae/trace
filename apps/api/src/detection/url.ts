export function issueTargetKey(input: { urlPath: string; selectorHash?: string | undefined; issueType: string }): string {
  return [input.urlPath, input.selectorHash ?? "page", input.issueType].join("|").replace(/[^a-z0-9|:_-]+/gi, "_");
}
