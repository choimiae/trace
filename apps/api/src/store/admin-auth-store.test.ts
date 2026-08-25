import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store.js";

describe("admin auth store", () => {
  it("upserts Google users by googleSub and updates last login fields", async () => {
    const store = new MemoryStore();
    const first = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      name: "Admin",
      pictureUrl: "https://example.com/avatar.png",
      now: "2026-08-25T00:00:00.000Z",
    });
    const second = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      name: "Admin Two",
      now: "2026-08-25T01:00:00.000Z",
    });

    expect(second.adminUserId).toBe(first.adminUserId);
    expect(second.name).toBe("Admin Two");
    expect(second.lastLoginAt).toBe("2026-08-25T01:00:00.000Z");
  });

  it("stores sessions, revokes sessions, and lists project memberships", async () => {
    const store = new MemoryStore();
    const user = await store.upsertAdminUserFromGoogle({
      googleSub: "google_sub_1",
      email: "admin@example.com",
      emailVerified: true,
      now: "2026-08-25T00:00:00.000Z",
    });
    const project = await store.createProject({ name: "Demo", allowedDomains: ["https://demo.example.com"] });

    await store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: user.adminUserId,
      role: "owner",
      createdAt: "2026-08-25T00:00:00.000Z",
    });
    await store.createAdminSession({
      sessionIdHash: "hash_1",
      adminUserId: user.adminUserId,
      createdAt: "2026-08-25T00:00:00.000Z",
      expiresAt: "2026-08-25T08:00:00.000Z",
      lastSeenAt: "2026-08-25T00:00:00.000Z",
    });

    expect(await store.getProjectMembership(project.projectId, user.adminUserId)).toMatchObject({ role: "owner" });
    expect(await store.listProjectMembershipsForUser(user.adminUserId)).toHaveLength(1);
    await store.revokeAdminSession("hash_1", "2026-08-25T00:10:00.000Z");
    expect((await store.getAdminSession("hash_1"))?.revokedAt).toBe("2026-08-25T00:10:00.000Z");
  });
});
