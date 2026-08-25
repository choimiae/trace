import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { MemoryStore } from "../store/memory-store";

describe("admin routes", () => {
  it("creates a project and returns an install snippet", async () => {
    const app = createApp({ store: new MemoryStore() });

    const response = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Demo SaaS",
        allowedDomains: ["https://demo.example.com"],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.projectId).toMatch(/^proj_/);
    expect(body.installSnippet).toContain("data-project-id");
    expect(body.allowedDomains).toEqual(["https://demo.example.com"]);
  });

  it("returns dashboard summary, issues, issue detail, and session timeline", async () => {
    const store = new MemoryStore();
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });
    await store.saveBatch({
      projectId: project.projectId,
      anonymousUserId: "anon_1",
      sessionId: "sess_1",
      sentAt: "2026-08-24T00:00:03.000Z",
      sdkVersion: "0.1.0",
      url: "https://demo.example.com/settings",
      events: [
        {
          eventId: "evt_1",
          sessionId: "sess_1",
          pageId: "page_1",
          timestamp: "2026-08-24T00:00:00.000Z",
          type: "click",
          urlPath: "/settings",
          elementSelectorHash: "button_hash",
          metadata: {},
        },
      ],
    });
    await store.upsertIssues(project.projectId, [
      {
        issueId: "issue_1",
        projectId: project.projectId,
        issueType: "rage_click",
        title: "설정 화면에서 반복 클릭",
        summary: "같은 버튼을 반복 클릭했습니다.",
        affectedSessionsCount: 1,
        affectedUsersCount: 1,
        severityScore: 70,
        firstSeenAt: "2026-08-24T00:00:00.000Z",
        lastSeenAt: "2026-08-24T00:00:00.000Z",
        trend: "flat",
        relatedUrlPath: "/settings",
        exampleSessionIds: ["sess_1"],
        status: "new",
      },
    ]);
    const app = createApp({ store });

    const summaryResponse = await app.inject({ method: "GET", url: `/api/projects/${project.projectId}/summary` });
    const issuesResponse = await app.inject({ method: "GET", url: `/api/projects/${project.projectId}/issues` });
    const issueResponse = await app.inject({ method: "GET", url: "/api/issues/issue_1" });
    const timelineResponse = await app.inject({
      method: "GET",
      url: `/api/sessions/sess_1/timeline?projectId=${project.projectId}`,
    });

    expect(summaryResponse.statusCode).toBe(200);
    expect(summaryResponse.json().frictionScore).toBe(70);
    expect(issuesResponse.json()[0].issueId).toBe("issue_1");
    expect(issueResponse.json().title).toBe("설정 화면에서 반복 클릭");
    expect(timelineResponse.json()[0].eventId).toBe("evt_1");
  });
});
