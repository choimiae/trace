import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { MemoryStore } from "../store/memory-store.js";

async function createProject(store: MemoryStore) {
  return store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
}

describe("GET /v1/projects/:projectId/config", () => {
  it("리플레이가 꺼진 프로젝트는 false 를 돌려준다", async () => {
    const store = new MemoryStore();
    const project = await createProject(store);
    const app = createApp({ store });

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.projectId}/config`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ replay: false, maskSelectors: [] });
  });

  it("켜진 프로젝트는 마스킹 셀렉터를 함께 돌려준다", async () => {
    const store = new MemoryStore();
    const project = await createProject(store);
    await store.updateProject(project.projectId, {
      name: project.name,
      allowedDomains: project.allowedDomains,
      replay: { enabled: true, maskSelectors: [".customer-name", "td.amount"] },
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.projectId}/config`,
    });

    expect(response.json()).toEqual({
      replay: true,
      maskSelectors: [".customer-name", "td.amount"],
    });
  });

  // 꺼져 있는데 셀렉터가 나가면, 켤 생각이 없는 프로젝트의 내부 클래스 이름을
  // 공개 엔드포인트로 흘리는 것이 된다.
  it("꺼져 있으면 셀렉터를 내보내지 않는다", async () => {
    const store = new MemoryStore();
    const project = await createProject(store);
    await store.updateProject(project.projectId, {
      name: project.name,
      allowedDomains: project.allowedDomains,
      replay: { enabled: false, maskSelectors: [".customer-name"] },
    });
    const app = createApp({ store });

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.projectId}/config`,
    });

    expect(response.json()).toEqual({ replay: false, maskSelectors: [] });
  });

  // 셀렉터를 지웠는데 캐시된 설정으로 기록이 계속되면, 가려야 할 자리가
  // 원문으로 담긴다. 설정은 즉시 반영돼야 한다.
  it("설정을 캐시하지 않는다", async () => {
    const store = new MemoryStore();
    const project = await createProject(store);
    const app = createApp({ store });

    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${project.projectId}/config`,
    });

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("없는 프로젝트는 404 다", async () => {
    const app = createApp({ store: new MemoryStore() });

    const response = await app.inject({ method: "GET", url: "/v1/projects/proj_missing/config" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });

  // 캐시된 404 가 굳으면, 나중에 프로젝트가 생기거나 오타가 고쳐져도 SDK 는
  // 계속 같은 404 를 받아 기록을 영영 시작하지 못한다 - 신호도 없이.
  it("없는 프로젝트의 404 도 캐시하지 않는다", async () => {
    const app = createApp({ store: new MemoryStore() });

    const response = await app.inject({ method: "GET", url: "/v1/projects/proj_missing/config" });

    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("잘못된 형식의 projectId 도 404 이고 캐시하지 않는다", async () => {
    const app = createApp({ store: new MemoryStore() });

    const response = await app.inject({
      method: "GET",
      url: "/v1/projects/not-a-valid-project-id/config",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
