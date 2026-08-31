import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store.js";
import { SqliteStore } from "./sqlite-store.js";
import { assertDeployableTraceStore, type TraceStore } from "./types.js";

interface StoreUnderTest {
  store: TraceStore;
  dispose?: () => void;
}

function describeTraceStoreContract(
  name: string,
  createStore: () => StoreUnderTest,
  expectedDurable: boolean,
) {
  describe(`${name} TraceStore 계약`, () => {
    let current: StoreUnderTest | undefined;

    const open = () => {
      current = createStore();
      return current.store;
    };

    afterEach(() => {
      current?.dispose?.();
      current = undefined;
    });

    it("googleSub 기준으로 사용자를 upsert하고 마지막 로그인 정보를 갱신한다", async () => {
      const store = open();
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

    it("정규화한 이메일이 중복되면 거부한다", async () => {
      const store = open();
      const first = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_1",
        email: "Admin@Example.com",
        emailVerified: true,
        now: "2026-08-25T00:00:00.000Z",
      });

      expect(first.email).toBe("admin@example.com");
      await expect(
        store.upsertAdminUserFromGoogle({
          googleSub: "google_sub_2",
          email: "ADMIN@example.com",
          emailVerified: true,
          now: "2026-08-25T01:00:00.000Z",
        }),
      ).rejects.toThrow("admin_email_conflict");
    });

    it("정규화한 이메일로 관리자 사용자를 조회한다", async () => {
      const store = open();
      const user = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_email_lookup",
        email: "Member@Example.com",
        emailVerified: true,
        name: "Member",
        now: "2026-08-25T00:00:00.000Z",
      });

      await expect(store.getAdminUserByEmail("member@example.com")).resolves.toMatchObject({
        adminUserId: user.adminUserId,
        email: "member@example.com",
        name: "Member",
      });
      await expect(store.getAdminUserByEmail("MEMBER@example.com")).resolves.toMatchObject({
        adminUserId: user.adminUserId,
        email: "member@example.com",
      });
      await expect(store.getAdminUserByEmail("missing@example.com")).resolves.toBeUndefined();
    });

    it("프로젝트별 멤버십 목록만 조회한다", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_owner",
        email: "owner@example.com",
        emailVerified: true,
        now: "2026-08-25T00:00:00.000Z",
      });
      const viewer = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_viewer",
        email: "viewer@example.com",
        emailVerified: true,
        now: "2026-08-25T00:01:00.000Z",
      });
      const other = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_other",
        email: "other@example.com",
        emailVerified: true,
        now: "2026-08-25T00:02:00.000Z",
      });
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const otherProject = await store.createProject({
        name: "Other",
        allowedDomains: ["https://other.example.com"],
      });

      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-25T00:00:00.000Z",
      });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: viewer.adminUserId,
        role: "viewer",
        createdAt: "2026-08-25T00:01:00.000Z",
      });
      await store.addProjectMembership({
        projectId: otherProject.projectId,
        adminUserId: other.adminUserId,
        role: "admin",
        createdAt: "2026-08-25T00:02:00.000Z",
      });

      await expect(store.listProjectMemberships(project.projectId)).resolves.toEqual([
        {
          projectId: project.projectId,
          adminUserId: owner.adminUserId,
          role: "owner",
          createdAt: "2026-08-25T00:00:00.000Z",
        },
        {
          projectId: project.projectId,
          adminUserId: viewer.adminUserId,
          role: "viewer",
          createdAt: "2026-08-25T00:01:00.000Z",
        },
      ]);
    });

    it("배포 가능 여부를 isDurable로 판정한다", () => {
      const store = open();

      expect(store.isDurable).toBe(expectedDurable);
      if (expectedDurable) {
        expect(() => assertDeployableTraceStore(store, { NODE_ENV: "production" })).not.toThrow();
      } else {
        expect(() => assertDeployableTraceStore(store, { NODE_ENV: "production" })).toThrow(
          "DURABLE_TRACE_STORE_REQUIRED",
        );
      }
      expect(() => assertDeployableTraceStore(store, { NODE_ENV: "development" })).not.toThrow();
    });

    it("세션을 저장하고 폐기하며 프로젝트 멤버십을 조회한다", async () => {
      const store = open();
      const user = await store.upsertAdminUserFromGoogle({
        googleSub: "google_sub_1",
        email: "admin@example.com",
        emailVerified: true,
        now: "2026-08-25T00:00:00.000Z",
      });
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

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

      expect(await store.getProjectMembership(project.projectId, user.adminUserId)).toMatchObject({
        role: "owner",
      });
      expect(await store.listProjectMembershipsForUser(user.adminUserId)).toHaveLength(1);
      await store.revokeAdminSession("hash_1", "2026-08-25T00:10:00.000Z");
      expect((await store.getAdminSession("hash_1"))?.revokedAt).toBe("2026-08-25T00:10:00.000Z");
    });

    it("멤버십과 감사 로그를 원자적으로 저장하고 중복 멤버십을 보존한다", async () => {
      const store = open();
      const membership = {
        projectId: "proj_1",
        adminUserId: "admin_1",
        role: "viewer" as const,
        createdAt: "2026-08-28T00:00:00.000Z",
      };
      const auditLog = {
        adminUserId: "admin_owner",
        action: "project.member_added",
        projectId: "proj_1",
        createdAt: "2026-08-28T00:00:00.000Z",
        metadata: {
          addedAdminUserId: "admin_1",
          email: "member@example.com",
          role: "viewer",
        },
      };

      await expect(store.addProjectMembershipWithAudit(membership, auditLog)).resolves.toEqual(membership);
      await expect(store.addProjectMembershipWithAudit(
        { ...membership, role: "admin", createdAt: "2026-08-29T00:00:00.000Z" },
        { ...auditLog, createdAt: "2026-08-29T00:00:00.000Z", metadata: { ...auditLog.metadata, role: "admin" } },
      )).rejects.toThrow("project_member_exists");

      await expect(store.getProjectMembership(membership.projectId, membership.adminUserId)).resolves.toEqual(membership);
      await expect(store.listAuditLogs()).resolves.toEqual([
        expect.objectContaining({
          action: "project.member_added",
          metadata: {
            addedAdminUserId: "admin_1",
            email: "member@example.com",
            role: "viewer",
          },
        }),
      ]);
    });

    it("updates a project member role with audit and keeps createdAt", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-role-update@example.com",
        name: "Owner",
        googleSub: "owner-role-update",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const member = await store.upsertAdminUserFromGoogle({
        email: "member-role-update@example.com",
        name: "Member",
        googleSub: "member-role-update",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      const project = await store.createProject({ name: "Role Update", allowedDomains: [] });

      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      const created = await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: member.adminUserId,
        role: "viewer",
        createdAt: "2026-08-31T00:00:01.000Z",
      });

      const updated = await store.updateProjectMembershipRoleWithAudit({
        projectId: project.projectId,
        targetAdminUserId: member.adminUserId,
        requestedByAdminUserId: owner.adminUserId,
        role: "admin",
        auditLog: () => ({
          adminUserId: owner.adminUserId,
          projectId: project.projectId,
          createdAt: "2026-08-31T00:00:00.000Z",
          action: "project.member_role_updated",
          metadata: {
            targetAdminUserId: member.adminUserId,
            email: member.email,
            beforeRole: "viewer",
            afterRole: "admin",
          },
        }),
      });

      expect(updated).toEqual({
        projectId: project.projectId,
        adminUserId: member.adminUserId,
        role: "admin",
        createdAt: created.createdAt,
      });
      expect(await store.listAuditLogs()).toEqual([
        expect.objectContaining({
          action: "project.member_role_updated",
          metadata: {
            targetAdminUserId: member.adminUserId,
            email: member.email,
            beforeRole: "viewer",
            afterRole: "admin",
          },
        }),
      ]);
    });

    it("returns the current member without audit when role is unchanged", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-unchanged@example.com",
        googleSub: "owner-unchanged",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const member = await store.upsertAdminUserFromGoogle({
        email: "member-unchanged@example.com",
        googleSub: "member-unchanged",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      const project = await store.createProject({ name: "Unchanged Role", allowedDomains: [] });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      const membership = await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: member.adminUserId,
        role: "viewer",
        createdAt: "2026-08-31T00:00:01.000Z",
      });

      await expect(
        store.updateProjectMembershipRoleWithAudit({
          projectId: project.projectId,
          targetAdminUserId: member.adminUserId,
          requestedByAdminUserId: owner.adminUserId,
          role: "viewer",
        }),
      ).resolves.toEqual(membership);
      await expect(store.listAuditLogs()).resolves.toEqual([]);
    });

    it("returns undefined when updating a missing project member", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-missing-update@example.com",
        googleSub: "owner-missing-update",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const project = await store.createProject({ name: "Missing Update", allowedDomains: [] });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-31T00:00:00.000Z",
      });

      await expect(
        store.updateProjectMembershipRoleWithAudit({
          projectId: project.projectId,
          targetAdminUserId: "admin_missing",
          requestedByAdminUserId: owner.adminUserId,
          role: "admin",
        }),
      ).resolves.toBeUndefined();
      await expect(store.listAuditLogs()).resolves.toEqual([]);
    });

    it("removes a project member with audit", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-remove@example.com",
        googleSub: "owner-remove",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const member = await store.upsertAdminUserFromGoogle({
        email: "member-remove@example.com",
        googleSub: "member-remove",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      const project = await store.createProject({ name: "Remove Member", allowedDomains: [] });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: member.adminUserId,
        role: "viewer",
        createdAt: "2026-08-31T00:00:01.000Z",
      });

      await expect(
        store.removeProjectMembershipWithAudit({
          projectId: project.projectId,
          targetAdminUserId: member.adminUserId,
          requestedByAdminUserId: owner.adminUserId,
          auditLog: () => ({
            adminUserId: owner.adminUserId,
            projectId: project.projectId,
            createdAt: "2026-08-31T00:00:02.000Z",
            action: "project.member_removed",
            metadata: { targetAdminUserId: member.adminUserId, email: member.email },
          }),
        }),
      ).resolves.toBe(true);
      await expect(store.listProjectMemberships(project.projectId)).resolves.toEqual([
        expect.objectContaining({ adminUserId: owner.adminUserId, role: "owner" }),
      ]);
      await expect(store.listAuditLogs()).resolves.toEqual([
        expect.objectContaining({ action: "project.member_removed" }),
      ]);
    });

    it("returns false when removing a missing project member", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-missing-remove@example.com",
        googleSub: "owner-missing-remove",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const project = await store.createProject({ name: "Missing Remove", allowedDomains: [] });
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-31T00:00:00.000Z",
      });

      await expect(
        store.removeProjectMembershipWithAudit({
          projectId: project.projectId,
          targetAdminUserId: "admin_missing",
          requestedByAdminUserId: owner.adminUserId,
          auditLog: () => ({
            adminUserId: owner.adminUserId,
            projectId: project.projectId,
            createdAt: "2026-08-31T00:00:01.000Z",
            action: "project.member_removed",
            metadata: { targetAdminUserId: "admin_missing" },
          }),
        }),
      ).resolves.toBe(false);
      await expect(store.listAuditLogs()).resolves.toEqual([]);
    });

    it("rejects self owner demotion and removal without mutation or audit", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-self-forbidden@example.com",
        googleSub: "owner-self-forbidden",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const otherOwner = await store.upsertAdminUserFromGoogle({
        email: "other-owner-self-forbidden@example.com",
        googleSub: "other-owner-self-forbidden",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      const project = await store.createProject({ name: "Self Owner", allowedDomains: [] });
      const ownerMembership = {
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner" as const,
        createdAt: "2026-08-31T00:00:00.000Z",
      };
      const otherOwnerMembership = {
        projectId: project.projectId,
        adminUserId: otherOwner.adminUserId,
        role: "owner" as const,
        createdAt: "2026-08-31T00:00:01.000Z",
      };
      await store.addProjectMembership(ownerMembership);
      await store.addProjectMembership(otherOwnerMembership);

      await expect(
        store.updateProjectMembershipRoleWithAudit({
          projectId: project.projectId,
          targetAdminUserId: owner.adminUserId,
          requestedByAdminUserId: owner.adminUserId,
          role: "admin",
          auditLog: () => ({
            adminUserId: owner.adminUserId,
            projectId: project.projectId,
            createdAt: "2026-08-31T00:00:02.000Z",
            action: "project.member_role_updated",
            metadata: {},
          }),
        }),
      ).rejects.toThrow("self_owner_change_forbidden");
      await expect(
        store.removeProjectMembershipWithAudit({
          projectId: project.projectId,
          targetAdminUserId: owner.adminUserId,
          requestedByAdminUserId: owner.adminUserId,
          auditLog: () => ({
            adminUserId: owner.adminUserId,
            projectId: project.projectId,
            createdAt: "2026-08-31T00:00:03.000Z",
            action: "project.member_removed",
            metadata: {},
          }),
        }),
      ).rejects.toThrow("self_owner_change_forbidden");
      await expect(store.listProjectMemberships(project.projectId)).resolves.toEqual([
        ownerMembership,
        otherOwnerMembership,
      ]);
      await expect(store.listAuditLogs()).resolves.toEqual([]);
    });

    it("requires the requester to be an owner when mutating project members", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-requester-check@example.com",
        googleSub: "owner-requester-check",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const viewer = await store.upsertAdminUserFromGoogle({
        email: "viewer-requester-check@example.com",
        googleSub: "viewer-requester-check",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      const member = await store.upsertAdminUserFromGoogle({
        email: "member-requester-check@example.com",
        googleSub: "member-requester-check",
        emailVerified: true,
        now: "2026-08-31T00:00:02.000Z",
      });
      const project = await store.createProject({ name: "Requester Check", allowedDomains: [] });
      await store.addProjectMembership({ projectId: project.projectId, adminUserId: owner.adminUserId, role: "owner", createdAt: "2026-08-31T00:00:00.000Z" });
      await store.addProjectMembership({ projectId: project.projectId, adminUserId: viewer.adminUserId, role: "viewer", createdAt: "2026-08-31T00:00:01.000Z" });
      await store.addProjectMembership({ projectId: project.projectId, adminUserId: member.adminUserId, role: "viewer", createdAt: "2026-08-31T00:00:02.000Z" });

      await expect(store.updateProjectMembershipRoleWithAudit({
        projectId: project.projectId,
        targetAdminUserId: member.adminUserId,
        requestedByAdminUserId: viewer.adminUserId,
        role: "admin",
      })).rejects.toThrow("project_role_forbidden");
      await expect(store.removeProjectMembershipWithAudit({
        projectId: project.projectId,
        targetAdminUserId: member.adminUserId,
        requestedByAdminUserId: viewer.adminUserId,
        auditLog: () => ({
          adminUserId: viewer.adminUserId,
          projectId: project.projectId,
          createdAt: "2026-08-31T00:00:03.000Z",
          action: "project.member_removed",
          metadata: {},
        }),
      })).rejects.toThrow("project_role_forbidden");
      await expect(store.getProjectMembership(project.projectId, member.adminUserId)).resolves.toMatchObject({ role: "viewer" });
    });

    it("rejects a non-owner requester before last owner mutation checks", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-last-forbidden@example.com",
        googleSub: "owner-last-forbidden",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const viewer = await store.upsertAdminUserFromGoogle({
        email: "viewer-last-forbidden@example.com",
        googleSub: "viewer-last-forbidden",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      const project = await store.createProject({ name: "Last Owner", allowedDomains: [] });
      const ownerMembership = {
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner" as const,
        createdAt: "2026-08-31T00:00:00.000Z",
      };
      const viewerMembership = {
        projectId: project.projectId,
        adminUserId: viewer.adminUserId,
        role: "viewer" as const,
        createdAt: "2026-08-31T00:00:01.000Z",
      };
      await store.addProjectMembership(ownerMembership);
      await store.addProjectMembership(viewerMembership);

      await expect(
        store.updateProjectMembershipRoleWithAudit({
          projectId: project.projectId,
          targetAdminUserId: owner.adminUserId,
          requestedByAdminUserId: viewer.adminUserId,
          role: "admin",
          auditLog: () => ({
            adminUserId: viewer.adminUserId,
            projectId: project.projectId,
            createdAt: "2026-08-31T00:00:02.000Z",
            action: "project.member_role_updated",
            metadata: {},
          }),
        }),
      ).rejects.toThrow("project_role_forbidden");
      await expect(
        store.removeProjectMembershipWithAudit({
          projectId: project.projectId,
          targetAdminUserId: owner.adminUserId,
          requestedByAdminUserId: viewer.adminUserId,
          auditLog: () => ({
            adminUserId: viewer.adminUserId,
            projectId: project.projectId,
            createdAt: "2026-08-31T00:00:03.000Z",
            action: "project.member_removed",
            metadata: {},
          }),
        }),
      ).rejects.toThrow("project_role_forbidden");
      await expect(store.listProjectMemberships(project.projectId)).resolves.toEqual([
        ownerMembership,
        viewerMembership,
      ]);
      await expect(store.listAuditLogs()).resolves.toEqual([]);
    });

    it("세션 활동 시각을 갱신한다", async () => {
      const store = open();
      await store.createAdminSession({
        sessionIdHash: "hash_1",
        adminUserId: "admin_1",
        createdAt: "2026-08-25T00:00:00.000Z",
        expiresAt: "2026-08-25T08:00:00.000Z",
        lastSeenAt: "2026-08-25T00:00:00.000Z",
      });

      await store.touchAdminSession("hash_1", "2026-08-25T00:05:00.000Z");

      expect((await store.getAdminSession("hash_1"))?.lastSeenAt).toBe("2026-08-25T00:05:00.000Z");
    });

    it("감사 로그를 기록하고 조회한다", async () => {
      const store = open();

      await store.createAuditLog({
        adminUserId: "admin_1",
        action: "project.created",
        projectId: "proj_1",
        createdAt: "2026-08-25T00:00:00.000Z",
        metadata: { source: "test" },
      });

      const auditLogs = await store.listAuditLogs();
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]).toMatchObject({
        adminUserId: "admin_1",
        action: "project.created",
        projectId: "proj_1",
        metadata: { source: "test" },
      });
      expect(auditLogs[0]?.auditLogId).toMatch(/^audit_[A-Za-z0-9_-]{10}$/);
    });

    it("이벤트를 저장하고 eventId 중복을 무시한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const event = {
        eventId: "evt_1",
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp: "2026-08-25T00:00:00.000Z",
        type: "click" as const,
        urlPath: "/settings",
        metadata: {},
      };

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-25T00:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [event],
      });
      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-25T00:00:02.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [event],
      });

      expect(await store.listEvents(project.projectId)).toHaveLength(1);
      expect(await store.getSessionTimeline(project.projectId, "sess_1")).toHaveLength(1);
    });

    it("대시보드 요약에 이벤트 총 개수를 담는다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      expect((await store.getDashboardSummary(project.projectId)).totalEventsCount).toBe(0);

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-25T00:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-25T00:00:00.000Z",
            type: "page_view",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      });

      expect((await store.getDashboardSummary(project.projectId)).totalEventsCount).toBe(1);
    });

    it("프로젝트 이름과 허용 도메인을 수정한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Old",
        allowedDomains: ["https://old.example.com"],
      });

      const updated = await store.updateProject(project.projectId, {
        name: "New",
        allowedDomains: ["https://new.example.com", "https://app.example.com"],
      });

      expect(updated).toMatchObject({
        projectId: project.projectId,
        name: "New",
        allowedDomains: ["https://new.example.com", "https://app.example.com"],
        privacyConfig: project.privacyConfig,
        createdAt: project.createdAt,
      });
      expect(await store.getProject(project.projectId)).toEqual(updated);
    });

    it("없는 프로젝트 수정은 undefined를 반환한다", async () => {
      const store = open();

      await expect(
        store.updateProject("proj_missing", {
          name: "Missing",
          allowedDomains: ["https://missing.example.com"],
        }),
      ).resolves.toBeUndefined();
    });

    it("프로젝트 수정 시 허용 도메인을 origin으로 정규화하고 중복을 제거한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Old",
        allowedDomains: ["https://old.example.com"],
      });

      const updated = await store.updateProject(project.projectId, {
        name: "New",
        allowedDomains: [
          "https://example.com/path?source=docs",
          "https://example.com",
          "https://example.com/other",
          "https://app.example.com/settings#overview",
        ],
      });

      expect(updated?.allowedDomains).toEqual(["https://example.com", "https://app.example.com"]);
      expect((await store.getProject(project.projectId))?.allowedDomains).toEqual([
        "https://example.com",
        "https://app.example.com",
      ]);
    });
  });
}

describeTraceStoreContract("MemoryStore", () => ({ store: new MemoryStore() }), false);
describeTraceStoreContract(
  "SqliteStore",
  () => {
    const store = new SqliteStore(":memory:");
    return { store, dispose: () => store.close() };
  },
  true,
);
