import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminAuthConfig } from "../auth/config.js";
import { parseCookieHeader } from "../auth/cookies.js";
import { verifyCsrfRequest } from "../auth/csrf.js";
import { requireAdminSession, type AuthenticatedAdmin } from "../auth/session.js";
import type { ProjectRecord, TraceStore } from "../store/types.js";
import { createProjectSchema, updateProjectSchema } from "./admin.js";
import { parsePathStart, parsePeriod } from "./aggregation-query.js";

const projectParamsSchema = z.object({ projectId: z.string() });
const sessionParamsSchema = z.object({ sessionId: z.string() });
const projectQuerySchema = z.object({ projectId: z.string() });
const recordingChunkParamsSchema = z.object({
  sessionId: z.string(),
  seq: z.coerce.number().int().min(0),
});

// 질의 파라미터를 받지 않는다. 페이지네이션이 필요할 만큼 쌓이는 것을 본 뒤에
// 만든다.
const SESSION_LIMIT = 50;
const PAGE_STATS_LIMIT = 50;

export async function registerAdminProxyRoutes(
  app: FastifyInstance,
  options: { store: TraceStore; config: AdminAuthConfig },
) {
  app.post("/admin/api/projects", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_allowed_domains" });

    const project = await options.store.createProject(parsed.data);
    return reply.code(201).send({
      ...project,
      installSnippet: `<script src="https://cdn.trace.app/sdk.js" data-project-id="${project.projectId}"></script>`,
    });
  });

  app.get("/admin/api/projects/:projectId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    return toProjectSettingsResponse(access.project);
  });

  app.patch("/admin/api/projects/:projectId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const parsed = updateProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_project_settings" });

    const updated = await options.store.updateProject(projectId, {
      name: parsed.data.name,
      allowedDomains: parsed.data.allowedDomains,
      // exactOptionalPropertyTypes: replay 를 아예 안 보낸 요청과 구분하려면
      // 값이 없을 때 키 자체를 빼야 한다(undefined 를 값으로 넣으면 안 됨).
      ...(parsed.data.replay === undefined ? {} : { replay: parsed.data.replay }),
    });
    if (!updated) return reply.code(404).send({ error: "project_not_found" });

    return toProjectSettingsResponse(updated);
  });

  app.get("/admin/api/projects/:projectId/sessions", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const sessions = await options.store.listSessions(projectId, SESSION_LIMIT);
    return reply.header("cache-control", "no-store").send({ sessions });
  });

  app.get("/admin/api/projects/:projectId/features", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const period = parsePeriod(request.query);
    if (!period) return reply.code(400).send({ error: "invalid_period" });
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const usage = await options.store.getFeatureUsage(projectId, period.since);
    return reply.header("cache-control", "no-store").send(usage);
  });

  app.get("/admin/api/projects/:projectId/paths", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const period = parsePeriod(request.query);
    if (!period) return reply.code(400).send({ error: "invalid_period" });
    const path = parsePathStart(request.query);
    if (!path) return reply.code(400).send({ error: "invalid_path_start" });
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const ranking = await options.store.getPathRanking(projectId, period.since, path.start);
    return reply.header("cache-control", "no-store").send(ranking);
  });

  app.get("/admin/api/projects/:projectId/page-stats", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const pages = await options.store.listPageStats(projectId, PAGE_STATS_LIMIT);
    return reply.header("cache-control", "no-store").send({ pages });
  });

  app.get("/admin/api/sessions/:sessionId/timeline", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { sessionId } = sessionParamsSchema.parse(request.params);
    const query = projectQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_project_query" });
    const { projectId } = query.data;
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    return options.store.getSessionTimeline(projectId, sessionId);
  });

  app.get("/admin/api/sessions/:sessionId/recording", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { sessionId } = sessionParamsSchema.parse(request.params);
    const query = projectQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_project_query" });
    const { projectId } = query.data;
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const chunks = await options.store.listSessionRecordingChunks(projectId, sessionId);

    // 기록이 없어도 404 가 아니다. 기록은 세션 시작부터 모두 올라오므로 비어
    // 있다면 보존 기간이 지나 지워졌거나 기록을 끈 프로젝트다. 화면이 같은 빈
    // 상태로 다룬다.
    return reply.header("cache-control", "no-store").send({
      chunks: chunks.map((chunk) => ({
        seq: chunk.seq,
        eventCount: chunk.eventCount,
        // gzip 상태의 크기다. 푼 크기가 아니다.
        bytes: chunk.bytes.byteLength,
        startedAt: chunk.startedAt,
        receivedAt: chunk.receivedAt,
      })),
    });
  });

  app.get("/admin/api/sessions/:sessionId/recording/chunks/:seq", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const params = recordingChunkParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_chunk_seq" });

    const query = projectQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_project_query" });
    const { projectId } = query.data;
    const access = await getProjectAccess(options.store, projectId);
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const chunk = await options.store.getSessionRecordingChunk(projectId, params.data.sessionId, params.data.seq);
    if (!chunk) return reply.code(404).send({ error: "recording_chunk_not_found" });

    // **풀지 않는다.** 저장된 gzip 을 그대로 흘려보내고 브라우저가 푼다.
    // 업로드에서 content-encoding 을 피한 이유(프록시가 풀면 받는 것이
    // gzip 인지 매번 달라진다)는 내려받기에 해당되지 않는다 - 프록시가
    // 풀든 말든 브라우저가 받는 것은 JSON 이다.
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-encoding", "gzip")
      .header("cache-control", "no-store")
      .send(Buffer.from(chunk.bytes));
  });
}

async function authenticate(
  request: FastifyRequest,
  options: { store: TraceStore; config: AdminAuthConfig },
): Promise<AuthenticatedAdmin | { error: "admin_auth_required" }> {
  return requireAdminSession({
    store: options.store,
    config: options.config,
    cookieHeader: request.headers.cookie,
  });
}

async function getProjectAccess(
  store: TraceStore,
  projectId: string,
): Promise<ProjectAccess | ProjectAccessError> {
  const project = await store.getProject(projectId);
  if (!project) return { statusCode: 404, error: "project_not_found" };
  return { project };
}

type ProjectAccess = { project: ProjectRecord };

type ProjectAccessError = { statusCode: 404; error: "project_not_found" };

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toProjectSettingsResponse(project: ProjectRecord) {
  return {
    projectId: project.projectId,
    name: project.name,
    allowedDomains: project.allowedDomains,
    replay: project.replay,
  };
}
