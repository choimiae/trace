import { gunzipSync } from "node:zlib";
import { isSafeTraceIdentifier, recordingChunkSchema, redactUrl } from "@trace/shared";
import {
  MAX_RECORDING_CHUNK_BYTES,
  MAX_RECORDING_DECOMPRESSED_BYTES,
} from "@trace/shared/recording-limits";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SessionRecordingRetentionConfig } from "../retention/config.js";
import { runSessionRecordingRetention } from "../retention/recordings.js";
import type { TraceStore } from "../store/types.js";

const paramsSchema = z.object({
  sessionId: z.string().refine((value) => isSafeTraceIdentifier(value, "sess")),
});

export async function registerRecordingRoutes(
  app: FastifyInstance,
  options: {
    store: TraceStore;
    sessionRecordingRetentionConfig: SessionRecordingRetentionConfig;
    now?: (() => Date) | undefined;
  },
): Promise<void> {
  // 본문은 gzip 된 JSON 봉투다. content-encoding 을 쓰지 않는 것은 의도다 -
  // 중간 프록시가 알아서 풀어 버리면 우리가 받는 것이 gzip 인지 아닌지
  // 요청마다 달라진다.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  // 이벤트 배치와 한 통에 넣지 않는다. 그쪽은 keepalive 64 KiB 한도 때문에
  // 48 KiB 로 묶여 있고, 성격이 다른 두 트래픽을 섞으면 서로를 밀어낸다.
  app.post(
    "/v1/sessions/:sessionId/recording",
    { bodyLimit: MAX_RECORDING_CHUNK_BYTES },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "invalid_session_id" });

      const body = request.body;
      if (!Buffer.isBuffer(body)) return reply.code(415).send({ error: "expected_gzip_body" });

      let envelope: unknown;
      try {
        const json = gunzipSync(body, { maxOutputLength: MAX_RECORDING_DECOMPRESSED_BYTES });
        envelope = JSON.parse(json.toString("utf8"));
      } catch {
        return reply.code(400).send({ error: "invalid_recording_chunk" });
      }

      const parsed = recordingChunkSchema.safeParse(envelope);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_recording_chunk" });
      const chunk = parsed.data;

      const project = await options.store.getProject(chunk.projectId);
      if (!project) return reply.code(404).send({ error: "project_not_found" });
      if (!project.replay.enabled) return reply.code(403).send({ error: "replay_disabled" });

      let redacted;
      try {
        redacted = redactUrl(chunk.url);
      } catch {
        return reply.code(400).send({ error: "invalid_recording_chunk" });
      }
      const origin = request.headers.origin ?? redacted.origin;
      if (!project.allowedDomains.includes(origin) || !project.allowedDomains.includes(redacted.origin)) {
        return reply.code(403).send({ error: "domain_not_allowed" });
      }

      // 받은 gzip 바이트를 그대로 넣는다. 풀어서 저장하면 12.8배로 부푼다.
      await options.store.saveSessionRecordingChunk({
        sessionId: params.data.sessionId,
        projectId: chunk.projectId,
        seq: chunk.seq,
        startedAt: chunk.startedAt,
        eventCount: chunk.events.length,
        bytes: new Uint8Array(body),
      });

      await runSessionRecordingRetention(
        options.store,
        options.sessionRecordingRetentionConfig,
        options.now?.() ?? new Date(),
      );

      return reply.code(202).send({ accepted: chunk.events.length });
    },
  );
}
