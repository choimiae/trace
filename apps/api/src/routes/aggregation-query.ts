import { z } from "zod";
import { ROUTE_MAX_STEPS } from "../store/route.js";
import type { SessionFilter } from "../store/types.js";

// 집계 API 의 쿼리 파라미터 해석. 잘못된 쿼리는 undefined 로 돌려주고, 라우트가
// 원인별 400 코드로 바꾼다. Fastify 는 같은 키가 반복되면 배열로 준다.

const DAY_MS = 86_400_000;

// 다른 키는 무시한다(z.object 는 모르는 키를 버린다). 세션 API 는 같은 쿼리에 필터 키가 섞여 온다.
const periodSchema = z.object({ days: z.enum(["1", "7", "30"]).default("7") });

type Query = Record<string, unknown>;

/** `days` 를 기준 시각으로 바꾼다. 기준 시각 이후에 시작한 세션이 기간 세션이다. */
export function parsePeriod(query: unknown, now: Date = new Date()): { since: string } | undefined {
  const parsed = periodSchema.safeParse(query ?? {});
  if (!parsed.success) return undefined;
  return { since: new Date(now.getTime() - Number(parsed.data.days) * DAY_MS).toISOString() };
}

/** 이동 흐름의 시작 화면. 없거나 비었으면 "전체"다. */
export function parsePathStart(query: unknown): { start?: string } | undefined {
  const value = asQuery(query).start;
  if (value === undefined || value === "") return {};
  return typeof value === "string" ? { start: value } : undefined;
}

/** 세션 목록 필터. 하나만 걸 수 있다. */
export function parseSessionFilter(query: unknown): SessionFilter | undefined {
  const q = asQuery(query);
  const has = (key: string) => q[key] !== undefined;
  const wantsScreen = has("screen");
  const wantsFeature = has("featurePath") || has("featureKey");
  const wantsPath = has("step") || has("start") || has("exited");
  const groups = [wantsScreen, wantsFeature, wantsPath].filter(Boolean).length;
  if (groups === 0) return { kind: "none" };
  if (groups > 1) return undefined;

  if (wantsScreen) {
    const urlPath = text(q.screen);
    return urlPath === undefined ? undefined : { kind: "screen", urlPath };
  }

  if (wantsFeature) {
    const urlPath = text(q.featurePath);
    const elementKey = text(q.featureKey);
    return urlPath === undefined || elementKey === undefined ? undefined : { kind: "feature", urlPath, elementKey };
  }

  const rawSteps = Array.isArray(q.step) ? q.step : q.step === undefined ? [] : [q.step];
  const steps = rawSteps.map(text);
  // 6개 이상은 어떤 세션과도 맞을 수 없다(경로는 앞 5개까지만 쓴다).
  if (steps.length === 0 || steps.length > ROUTE_MAX_STEPS) return undefined;
  if (steps.some((step) => step === undefined)) return undefined;
  if (q.exited !== undefined && q.exited !== "true" && q.exited !== "false") return undefined;
  const start = has("start") ? text(q.start) : undefined;
  if (has("start") && start === undefined) return undefined;

  return {
    kind: "path",
    ...(start === undefined ? {} : { start }),
    steps: steps as string[],
    exited: q.exited === "true",
  };
}

function asQuery(query: unknown): Query {
  return typeof query === "object" && query !== null ? (query as Query) : {};
}

// 비지 않은 문자열 하나만 값으로 친다. 배열(같은 키 반복)과 빈 문자열은 잘못된 값이다.
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
