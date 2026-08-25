import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TraceStore } from "../store/types.js";

const createProjectSchema = z.object({
  name: z.string().min(1),
  allowedDomains: z.array(z.string().url()).min(1),
});

export async function registerAdminRoutes(
  app: FastifyInstance,
  options: { store: TraceStore; adminToken?: string | undefined },
) {
  app.addHook("preHandler", async (request, reply) => {
    if (isAuthorizedAdminRequest(request.headers.authorization, request.headers["x-trace-admin-token"], options.adminToken)) {
      return;
    }

    return reply.code(401).send({ error: "admin_auth_required" });
  });

  app.post("/api/projects", async (request, reply) => {
    const input = createProjectSchema.parse(request.body);
    const project = await options.store.createProject(input);

    return reply.code(201).send({
      ...project,
      installSnippet: `<script src="https://cdn.trace.app/sdk.js" data-project-id="${project.projectId}"></script>`,
    });
  });

  app.get("/api/projects/:projectId/summary", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await options.store.getProject(params.projectId);
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    return options.store.getDashboardSummary(params.projectId);
  });

  app.get("/api/projects/:projectId/issues", async (request, reply) => {
    const params = z.object({ projectId: z.string() }).parse(request.params);
    const project = await options.store.getProject(params.projectId);
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    return options.store.listIssues(params.projectId);
  });

  app.get("/api/issues/:issueId", async (request, reply) => {
    const params = z.object({ issueId: z.string() }).parse(request.params);
    const query = z.object({ projectId: z.string() }).parse(request.query);
    const issue = await options.store.getIssue(params.issueId);
    if (!issue || issue.projectId !== query.projectId) return reply.code(404).send({ error: "issue_not_found" });

    return issue;
  });

  app.get("/api/sessions/:sessionId/timeline", async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    const query = z.object({ projectId: z.string() }).parse(request.query);

    return options.store.getSessionTimeline(query.projectId, params.sessionId);
  });
}

function isAuthorizedAdminRequest(
  authorization: string | undefined,
  tokenHeader: string | string[] | undefined,
  adminToken: string | undefined,
): boolean {
  if (!adminToken) return false;
  const headerToken = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  return authorization === `Bearer ${adminToken}` || headerToken === adminToken;
}
