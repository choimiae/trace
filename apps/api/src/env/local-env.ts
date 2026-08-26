import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface LoadLocalEnvFilesInput {
  cwd?: string;
  env?: Record<string, string | undefined>;
  files?: string[];
}

const DEFAULT_ENV_FILES = ["apps/api/.env", ".env"];

export function loadLocalEnvFiles(input: LoadLocalEnvFilesInput = {}): void {
  const env = input.env ?? process.env;
  const cwd = env.INIT_CWD ?? input.cwd ?? process.cwd();
  const files = input.files ?? DEFAULT_ENV_FILES;

  for (const file of files) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;

    const entries = parseEnvFile(readFileSync(path, "utf8"));
    for (const [key, value] of entries) {
      if (env[key] !== undefined || value === "") continue;
      env[key] = value;
    }
  }
}

function parseEnvFile(source: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    entries.push([key, parseEnvValue(line.slice(separatorIndex + 1).trim())]);
  }

  return entries;
}

function parseEnvValue(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  const commentIndex = value.indexOf(" #");
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trim();
}
