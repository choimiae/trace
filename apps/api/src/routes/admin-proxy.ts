import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminAuthConfig } from "../auth/config.js";
import { parseCookieHeader } from "../auth/cookies.js";
import { verifyCsrfRequest } from "../auth/csrf.js";
import { requireAdminSession, type AuthenticatedAdmin } from "../auth/session.js";
import type { TraceStore } from "../store/types.js";
import { createProjectSchema } from "./admin.js";

const projectParamsSchema = z.object({ projectId: z.string() });
const issueParamsSchema = z.object({ issueId: z.string() });
const sessionParamsSchema = z.object({ sessionId: z.string() });
const projectQuerySchema = z.object({ projectId: z.string() });

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

    const project = await options.store.createProject(createProjectSchema.parse(request.body));
    const createdAt = new Date().toISOString();
    await options.store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: authenticated.adminUserId,
      role: "owner",
      createdAt,
    });
    await options.store.createAuditLog({
      adminUserId: authenticated.adminUserId,
      action: "project.created",
      projectId: project.projectId,
      createdAt,
      metadata: { name: project.name },
    });
    return reply.code(201).send({
      ...project,
      installSnippet: `<script src="https://cdn.trace.app/sdk.js" data-project-id="${project.projectId}"></script>`,
    });
  });

  app.get("/admin/api/projects/:projectId/summary", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const accessError = await getProjectAccessError(options.store, projectId, authenticated, "project_summary");
    if (accessError) {
      return reply.code(accessError.statusCode).send({ error: accessError.error });
    }

    return options.store.getDashboardSummary(projectId);
  });

  app.get("/admin/api/projects/:projectId/issues", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const accessError = await getProjectAccessError(options.store, projectId, authenticated, "project_issues");
    if (accessError) {
      return reply.code(accessError.statusCode).send({ error: accessError.error });
    }

    return options.store.listIssues(projectId);
  });

  app.get("/admin/api/issues/:issueId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { issueId } = issueParamsSchema.parse(request.params);
    const { projectId } = projectQuerySchema.parse(request.query);
    const project = await options.store.getProject(projectId);
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const issue = await options.store.getIssue(issueId);
    if (!issue || issue.projectId !== projectId) return reply.code(404).send({ error: "issue_not_found" });

    const membership = await options.store.getProjectMembership(projectId, authenticated.adminUserId);
    if (!membership) {
      await auditProjectAccessDenied(options.store, projectId, authenticated, "issue_detail");
      return reply.code(403).send({ error: "project_access_denied" });
    }

    return issue;
  });

  app.get("/admin/api/sessions/:sessionId/timeline", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { sessionId } = sessionParamsSchema.parse(request.params);
    const { projectId } = projectQuerySchema.parse(request.query);
    const accessError = await getProjectAccessError(options.store, projectId, authenticated, "session_timeline");
    if (accessError) {
      return reply.code(accessError.statusCode).send({ error: accessError.error });
    }

    return options.store.getSessionTimeline(projectId, sessionId);
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

async function getProjectAccessError(
  store: TraceStore,
  projectId: string,
  authenticated: AuthenticatedAdmin,
  resourceType: ProjectResourceType,
): Promise<ProjectAccessError | undefined> {
  const project = await store.getProject(projectId);
  if (!project) return { statusCode: 404, error: "project_not_found" };

  const membership = await store.getProjectMembership(projectId, authenticated.adminUserId);
  if (!membership) {
    await auditProjectAccessDenied(store, projectId, authenticated, resourceType);
    return { statusCode: 403, error: "project_access_denied" };
  }
}

type ProjectAccessError =
  | { statusCode: 404; error: "project_not_found" }
  | { statusCode: 403; error: "project_access_denied" };

type ProjectResourceType = "project_summary" | "project_issues" | "issue_detail" | "session_timeline";

async function auditProjectAccessDenied(
  store: TraceStore,
  projectId: string,
  authenticated: AuthenticatedAdmin,
  resourceType: ProjectResourceType,
): Promise<void> {
  await store.createAuditLog({
    adminUserId: authenticated.adminUserId,
    action: "project.access_denied",
    projectId,
    createdAt: new Date().toISOString(),
    metadata: { resourceType },
  });
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
