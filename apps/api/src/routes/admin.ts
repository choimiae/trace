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
}
