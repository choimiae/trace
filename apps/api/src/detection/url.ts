export function issueTargetKey(input: { urlPath: string; elementKey?: string | undefined; issueType: string }): string {
  return [input.urlPath, input.elementKey ?? "page", input.issueType].join("|").replace(/[^a-z0-9|:_-]+/gi, "_");
}
