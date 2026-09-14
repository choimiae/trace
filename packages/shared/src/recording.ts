import { z } from "zod";
import { isoDateStringSchema } from "./events.js";
import { isSafeTraceIdentifier } from "./privacy.js";
import {
  isSafeMaskSelector,
  MAX_MASK_SELECTORS,
  MAX_RECORDING_CHUNK_EVENTS,
} from "./recording-limits.js";

export const maskSelectorSchema = z.string().trim().refine(isSafeMaskSelector);

export const replayConfigSchema = z.object({
  enabled: z.boolean(),
  maskSelectors: z.array(maskSelectorSchema).max(MAX_MASK_SELECTORS).default([]),
});

export type ReplayConfig = z.infer<typeof replayConfigSchema>;

export const DEFAULT_REPLAY_CONFIG: ReplayConfig = { enabled: false, maskSelectors: [] };

// events 는 검증하지 않는다 — 모양이 rrweb 버전에 묶여 있어 계약으로 고정하면
// 라이브러리를 올릴 수 없다. 봉투(누가·언제·몇 번째)만 본다. 크기는 바이트
// 단위로 recording.ts 바깥(라우트)에서 따로 막는다.
export const recordingChunkSchema = z.object({
  projectId: z.string().refine((value) => isSafeTraceIdentifier(value, "proj")),
  seq: z.number().int().min(0),
  startedAt: isoDateStringSchema,
  url: z.string().url(),
  sdkVersion: z.string().min(1).max(32),
  events: z.array(z.unknown()).min(1).max(MAX_RECORDING_CHUNK_EVENTS),
});

export type RecordingChunk = z.infer<typeof recordingChunkSchema>;
