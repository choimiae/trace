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
});
