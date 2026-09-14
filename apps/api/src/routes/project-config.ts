import { isSafeTraceIdentifier } from "@trace/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TraceStore } from "../store/types.js";

const paramsSchema = z.object({
  projectId: z.string().refine((value) => isSafeTraceIdentifier(value, "proj")),
});

export async function registerProjectConfigRoutes(
  app: FastifyInstance,
  options: { store: TraceStore },
): Promise<void> {
  // 공개 엔드포인트다. projectId 는 이미 고객 사이트의 script 태그에 적혀 있고,
  // 나가는 값은 그 사이트가 어떤 셀렉터를 가리는지 - 그 클래스명 역시 사이트
  // HTML 에 그대로 보인다.
  app.get("/v1/projects/:projectId/config", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "project_not_found" });

    const project = await options.store.getProject(params.data.projectId);
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    // 설정이 바뀌면 즉시 반영돼야 한다. 셀렉터를 지웠는데 캐시된 설정으로
    // 기록이 이어지면 가려야 할 자리가 원문으로 담긴다.
    reply.header("cache-control", "no-store");

    // 꺼져 있으면 셀렉터를 내보내지 않는다 - 켤 생각이 없는 프로젝트의 내부
    // 클래스 이름을 공개 엔드포인트로 흘릴 이유가 없다.
    if (!project.replay.enabled) return { replay: false, maskSelectors: [] };

    return { replay: true, maskSelectors: project.replay.maskSelectors };
  });
}
