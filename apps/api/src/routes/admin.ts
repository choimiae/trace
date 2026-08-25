import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TraceStore } from "../store/types";

const createProjectSchema = z.object({
  name: z.string().min(1),
  allowedDomains: z.array(z.string().url()).min(1),
});

export async function registerAdminRoutes(app: FastifyInstance, options: { store: TraceStore }) {
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
    const issue = await options.store.getIssue(params.issueId);
    if (!issue) return reply.code(404).send({ error: "issue_not_found" });

    return issue;
  });

  app.get("/api/sessions/:sessionId/timeline", async (request) => {
    const params = z.object({ sessionId: z.string() }).parse(request.params);
    const query = z.object({ projectId: z.string() }).parse(request.query);

    return options.store.getSessionTimeline(query.projectId, params.sessionId);
  });
}
