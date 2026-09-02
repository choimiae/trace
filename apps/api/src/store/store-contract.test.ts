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

    it("빈 검색어는 이메일 오름차순으로 limit 만큼 반환한다", async () => {
      const store = open();
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_c",
        email: "carol@example.com",
        emailVerified: true,
        name: "Carol",
        now: "2026-08-31T00:00:00.000Z",
      });
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_a",
        email: "alice@example.com",
        emailVerified: true,
        name: "Alice",
        now: "2026-08-31T00:00:01.000Z",
      });
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_b",
        email: "bob@example.com",
        emailVerified: true,
        now: "2026-08-31T00:00:02.000Z",
      });

      const all = await store.searchAdminUsers({ query: "", limit: 20 });
      expect(all.map((user) => user.email)).toEqual([
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
      ]);

      const limited = await store.searchAdminUsers({ query: "", limit: 2 });
      expect(limited.map((user) => user.email)).toEqual(["alice@example.com", "bob@example.com"]);
    });

    it("이메일 부분 검색은 대소문자를 구분하지 않는다", async () => {
      const store = open();
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_email_alice",
        email: "alice@example.com",
        emailVerified: true,
        name: "Alice",
        now: "2026-08-31T00:00:00.000Z",
      });
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_email_bob",
        email: "bob@other.example.com",
        emailVerified: true,
        name: "Bob",
        now: "2026-08-31T00:00:01.000Z",
      });

      await expect(
        store.searchAdminUsers({ query: "OTHER", limit: 20 }),
      ).resolves.toMatchObject([{ email: "bob@other.example.com" }]);

      const lower = await store.searchAdminUsers({ query: "alice", limit: 20 });
      const upper = await store.searchAdminUsers({ query: "ALICE", limit: 20 });
      expect(lower.map((user) => user.email)).toEqual(["alice@example.com"]);
      expect(upper.map((user) => user.email)).toEqual(lower.map((user) => user.email));
    });

    it("이름 부분 검색은 대소문자를 구분하지 않는다", async () => {
      const store = open();
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_name_kim",
        email: "named@example.com",
        emailVerified: true,
        name: "Alice Kim",
        now: "2026-08-31T00:00:00.000Z",
      });
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_name_none",
        email: "nameless@example.com",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });

      await expect(
        store.searchAdminUsers({ query: "kim", limit: 20 }),
      ).resolves.toMatchObject([{ email: "named@example.com", name: "Alice Kim" }]);
      await expect(
        store.searchAdminUsers({ query: "KIM", limit: 20 }),
      ).resolves.toMatchObject([{ email: "named@example.com" }]);
    });

    it("이름이 없는 사용자도 이메일 검색으로 찾는다", async () => {
      const store = open();
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_nameless",
        email: "nameless@example.com",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });

      const found = await store.searchAdminUsers({ query: "nameless", limit: 20 });
      expect(found.map((user) => user.email)).toEqual(["nameless@example.com"]);
      expect(found[0]).not.toHaveProperty("name");
    });

    it("검색어가 아무것도 일치하지 않으면 빈 배열을 반환한다", async () => {
      const store = open();
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_miss",
        email: "present@example.com",
        emailVerified: true,
        name: "Present",
        now: "2026-08-31T00:00:00.000Z",
      });

      await expect(store.searchAdminUsers({ query: "absent", limit: 20 })).resolves.toEqual([]);
    });

    it("검색 결과도 이메일 오름차순이고 limit이 적용된다", async () => {
      const store = open();
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_order_c",
        email: "c-team@example.com",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_order_b",
        email: "b-team@example.com",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      await store.upsertAdminUserFromGoogle({
        googleSub: "search_order_a",
        email: "a-team@example.com",
        emailVerified: true,
        now: "2026-08-31T00:00:02.000Z",
      });

      const all = await store.searchAdminUsers({ query: "team", limit: 20 });
      expect(all.map((user) => user.email)).toEqual([
        "a-team@example.com",
        "b-team@example.com",
        "c-team@example.com",
      ]);

      const limited = await store.searchAdminUsers({ query: "team", limit: 2 });
      expect(limited.map((user) => user.email)).toEqual(["a-team@example.com", "b-team@example.com"]);
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

    it("역할 변경 audit factory가 예외를 던지면 멤버십과 audit를 변경하지 않는다", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-update-audit-failure@example.com",
        googleSub: "owner-update-audit-failure",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const member = await store.upsertAdminUserFromGoogle({
        email: "member-update-audit-failure@example.com",
        googleSub: "member-update-audit-failure",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      const project = await store.createProject({ name: "Update Audit Failure", allowedDomains: [] });
      const membership = {
        projectId: project.projectId,
        adminUserId: member.adminUserId,
        role: "viewer" as const,
        createdAt: "2026-08-31T00:00:01.000Z",
      };
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      await store.addProjectMembership(membership);

      await expect(
        store.updateProjectMembershipRoleWithAudit({
          projectId: project.projectId,
          targetAdminUserId: member.adminUserId,
          requestedByAdminUserId: owner.adminUserId,
          role: "admin",
          auditLog: () => { throw new Error("audit_factory_failed"); },
        }),
      ).rejects.toThrow("audit_factory_failed");
      await expect(store.getProjectMembership(project.projectId, member.adminUserId)).resolves.toEqual(membership);
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

    it("멤버 제거 audit factory가 예외를 던지면 멤버십과 audit를 변경하지 않는다", async () => {
      const store = open();
      const owner = await store.upsertAdminUserFromGoogle({
        email: "owner-remove-audit-failure@example.com",
        googleSub: "owner-remove-audit-failure",
        emailVerified: true,
        now: "2026-08-31T00:00:00.000Z",
      });
      const member = await store.upsertAdminUserFromGoogle({
        email: "member-remove-audit-failure@example.com",
        googleSub: "member-remove-audit-failure",
        emailVerified: true,
        now: "2026-08-31T00:00:01.000Z",
      });
      const project = await store.createProject({ name: "Remove Audit Failure", allowedDomains: [] });
      const membership = {
        projectId: project.projectId,
        adminUserId: member.adminUserId,
        role: "viewer" as const,
        createdAt: "2026-08-31T00:00:01.000Z",
      };
      await store.addProjectMembership({
        projectId: project.projectId,
        adminUserId: owner.adminUserId,
        role: "owner",
        createdAt: "2026-08-31T00:00:00.000Z",
      });
      await store.addProjectMembership(membership);

      await expect(
        store.removeProjectMembershipWithAudit({
          projectId: project.projectId,
          targetAdminUserId: member.adminUserId,
          requestedByAdminUserId: owner.adminUserId,
          auditLog: () => { throw new Error("audit_factory_failed"); },
        }),
      ).rejects.toThrow("audit_factory_failed");
      await expect(store.getProjectMembership(project.projectId, member.adminUserId)).resolves.toEqual(membership);
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

    it("프로젝트별 활동 이력만 최신순으로 반환한다", async () => {
      const store = open();
      const project = await store.createProject({ name: "Audit", allowedDomains: [] });
      const other = await store.createProject({ name: "Other", allowedDomains: [] });

      await store.createAuditLog({
        adminUserId: "admin_1",
        action: "project.created",
        projectId: project.projectId,
        createdAt: "2026-08-31T00:00:00.000Z",
        metadata: { name: "Audit" },
      });
      await store.createAuditLog({
        adminUserId: "admin_1",
        action: "project.member_added",
        projectId: project.projectId,
        createdAt: "2026-08-31T02:00:00.000Z",
        metadata: { email: "member@example.com", role: "viewer" },
      });
      await store.createAuditLog({
        adminUserId: "admin_1",
        action: "project.updated",
        projectId: other.projectId,
        createdAt: "2026-08-31T03:00:00.000Z",
        metadata: {},
      });
      // projectId 가 없는 auth log 는 제외되어야 한다.
      await store.createAuditLog({
        action: "auth.login_success",
        createdAt: "2026-08-31T04:00:00.000Z",
        metadata: {},
      });

      const entries = await store.listProjectAuditLogs({
        projectId: project.projectId,
        limit: 20,
      });

      expect(entries.map((entry) => entry.action)).toEqual([
        "project.member_added",
        "project.created",
      ]);
    });

    it("createdAt 이 같으면 auditLogId 내림차순으로 반환한다", async () => {
      const store = open();
      const project = await store.createProject({ name: "Audit", allowedDomains: [] });

      for (let i = 0; i < 3; i += 1) {
        await store.createAuditLog({
          action: "project.updated",
          projectId: project.projectId,
          createdAt: "2026-08-31T00:00:00.000Z",
          metadata: { i },
        });
      }

      const entries = await store.listProjectAuditLogs({
        projectId: project.projectId,
        limit: 20,
      });

      expect(entries).toHaveLength(3);
      const ids = entries.map((entry) => entry.auditLogId);
      expect(ids).toEqual([...ids].sort().reverse());
    });

    it("limit 이 적용된다", async () => {
      const store = open();
      const project = await store.createProject({ name: "Audit", allowedDomains: [] });

      await store.createAuditLog({
        action: "project.created",
        projectId: project.projectId,
        createdAt: "2026-08-31T00:00:00.000Z",
        metadata: {},
      });
      await store.createAuditLog({
        action: "project.updated",
        projectId: project.projectId,
        createdAt: "2026-08-31T01:00:00.000Z",
        metadata: {},
      });
      await store.createAuditLog({
        action: "project.member_added",
        projectId: project.projectId,
        createdAt: "2026-08-31T02:00:00.000Z",
        metadata: {},
      });

      const entries = await store.listProjectAuditLogs({
        projectId: project.projectId,
        limit: 2,
      });

      expect(entries.map((entry) => entry.action)).toEqual([
        "project.member_added",
        "project.updated",
      ]);
    });

    it("커서로 다음 페이지가 중복 없이 이어진다", async () => {
      const store = open();
      const project = await store.createProject({ name: "Audit", allowedDomains: [] });

      for (let i = 0; i < 5; i += 1) {
        await store.createAuditLog({
          action: "project.updated",
          projectId: project.projectId,
          createdAt: `2026-08-31T0${i}:00:00.000Z`,
          metadata: { i },
        });
      }

      const firstPage = await store.listProjectAuditLogs({
        projectId: project.projectId,
        limit: 2,
      });
      expect(firstPage).toHaveLength(2);

      const lastOfFirstPage = firstPage[firstPage.length - 1]!;
      const secondPage = await store.listProjectAuditLogs({
        projectId: project.projectId,
        limit: 2,
        cursor: { createdAt: lastOfFirstPage.createdAt, auditLogId: lastOfFirstPage.auditLogId },
      });
      expect(secondPage).toHaveLength(2);

      const merged = [...firstPage, ...secondPage];
      const mergedIds = merged.map((entry) => entry.auditLogId);
      expect(new Set(mergedIds).size).toBe(4);

      const mergedCreatedAts = merged.map((entry) => entry.createdAt);
      expect(mergedCreatedAts).toEqual([...mergedCreatedAts].sort().reverse());
    });

    it("createdAt 이 겹치는 경계에서도 커서가 중복과 누락을 만들지 않는다", async () => {
      const store = open();
      const project = await store.createProject({ name: "Audit", allowedDomains: [] });

      for (let i = 0; i < 4; i += 1) {
        await store.createAuditLog({
          action: "project.updated",
          projectId: project.projectId,
          createdAt: "2026-08-31T00:00:00.000Z",
          metadata: { i },
        });
      }

      const collected: { auditLogId: string; createdAt: string }[] = [];
      let cursor: { createdAt: string; auditLogId: string } | undefined;
      for (let page = 0; page < 10; page += 1) {
        const entries = await store.listProjectAuditLogs({
          projectId: project.projectId,
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (entries.length === 0) break;
        collected.push(...entries);
        const lastEntry = entries[entries.length - 1]!;
        cursor = { createdAt: lastEntry.createdAt, auditLogId: lastEntry.auditLogId };
      }

      const collectedIds = collected.map((entry) => entry.auditLogId);
      expect(collectedIds).toHaveLength(4);
      expect(new Set(collectedIds).size).toBe(4);
    });

    it("마지막 항목을 가리키는 커서는 빈 배열을 반환한다", async () => {
      const store = open();
      const project = await store.createProject({ name: "Audit", allowedDomains: [] });

      await store.createAuditLog({
        action: "project.created",
        projectId: project.projectId,
        createdAt: "2026-08-31T00:00:00.000Z",
        metadata: {},
      });
      await store.createAuditLog({
        action: "project.updated",
        projectId: project.projectId,
        createdAt: "2026-08-31T01:00:00.000Z",
        metadata: {},
      });

      const entries = await store.listProjectAuditLogs({
        projectId: project.projectId,
        limit: 20,
      });
      expect(entries).toHaveLength(2);

      const last = entries[entries.length - 1]!;
      const nextPage = await store.listProjectAuditLogs({
        projectId: project.projectId,
        limit: 20,
        cursor: { createdAt: last.createdAt, auditLogId: last.auditLogId },
      });

      expect(nextPage).toEqual([]);
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

    it("오류 식별자를 타임라인에서 보존한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/checkout",
        events: [
          {
            eventId: "evt_err",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "js_error",
            urlPath: "/checkout",
            errorName: "TypeError",
            errorSource: "/assets/checkout.js",
            errorLine: 412,
            metadata: {},
          },
          {
            eventId: "evt_plain",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.500Z",
            type: "click",
            urlPath: "/checkout",
            metadata: {},
          },
        ],
      });

      const timeline = await store.getSessionTimeline(project.projectId, "sess_1");

      expect(timeline[0]?.errorName).toBe("TypeError");
      expect(timeline[0]?.errorSource).toBe("/assets/checkout.js");
      expect(timeline[0]?.errorLine).toBe(412);
      expect(timeline[1]).not.toHaveProperty("errorName");
    });

    it("이슈 오류 서명을 보존한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.upsertIssues(project.projectId, [
        {
          issueId: "issue_err",
          projectId: project.projectId,
          issueType: "error_friction",
          title: "/checkout 화면에서 오류 기반 막힘이 감지되었습니다",
          summary: "사용자 행동 흐름 중 js_error 이벤트가 발생했습니다.",
          affectedSessionsCount: 1,
          affectedUsersCount: 1,
          severityScore: 45,
          firstSeenAt: "2026-09-02T01:00:00.000Z",
          lastSeenAt: "2026-09-02T01:00:00.000Z",
          trend: "flat",
          relatedUrlPath: "/checkout",
          exampleSessionIds: ["sess_1"],
          status: "new",
          relatedErrorSignature: "TypeError · /assets/checkout.js:412",
        },
      ]);

      const issues = await store.listIssues(project.projectId);

      expect(issues[0]?.relatedErrorSignature).toBe("TypeError · /assets/checkout.js:412");
    });

    it("preserves screen context in session timeline events", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T01:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-02T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
            screenContext: {
              viewport: { width: 1440, height: 900 },
              target: {
                tagName: "button",
                role: "button",
                textMaskedOrLimited: "저장",
                rect: { x: 620, y: 420, width: 96, height: 40 },
              },
              layoutHints: [],
            },
          },
        ],
      });

      const timeline = await store.getSessionTimeline(project.projectId, "sess_1");

      expect(timeline[0]?.screenContext).toMatchObject({
        viewport: { width: 1440, height: 900 },
        target: {
          tagName: "button",
          textMaskedOrLimited: "저장",
          rect: { x: 620, y: 420, width: 96, height: 40 },
        },
      });
    });

    it("세션별로 시간 창·경로에 맞는 첫 화면 맥락 이벤트만 돌려준다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const screenContext = {
        viewport: { width: 1440, height: 900 },
        target: {
          tagName: "button",
          rect: { x: 620, y: 420, width: 96, height: 40 },
        },
        layoutHints: [],
      };
      const event = (
        eventId: string,
        sessionId: string,
        timestamp: string,
        type: "click" | "js_error",
        urlPath: string,
        withScreenContext = true,
      ) => ({
        eventId,
        sessionId,
        pageId: "page_1",
        timestamp,
        type,
        urlPath,
        metadata: {},
        ...(withScreenContext ? { screenContext } : {}),
      });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T03:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          event("evt_too_early", "sess_1", "2026-09-02T01:00:00.000Z", "click", "/settings"),
          event("evt_no_context", "sess_1", "2026-09-02T02:00:00.000Z", "click", "/settings", false),
          event("evt_first_in_window", "sess_1", "2026-09-02T02:00:05.000Z", "click", "/settings"),
          event("evt_other_path", "sess_1", "2026-09-02T02:00:06.000Z", "click", "/billing"),
          event("evt_later_in_window", "sess_1", "2026-09-02T02:00:07.000Z", "click", "/settings"),
          event("evt_too_late", "sess_1", "2026-09-02T02:30:00.000Z", "click", "/settings"),
          event("evt_other_session", "sess_2", "2026-09-02T02:00:08.000Z", "js_error", "/settings"),
          event("evt_unrelated_session", "sess_9", "2026-09-02T02:00:09.000Z", "click", "/settings"),
        ],
      });

      const matched = await store.findScreenContextEvents({
        projectId: project.projectId,
        sessionIds: ["sess_1", "sess_2", "sess_missing"],
        urlPath: "/settings",
        from: "2026-09-02T02:00:00.000Z",
        to: "2026-09-02T02:00:10.000Z",
      });

      expect(matched.map((matchedEvent) => matchedEvent.eventId)).toEqual([
        "evt_first_in_window",
        "evt_other_session",
      ]);
      expect(matched[0]?.screenContext?.target?.tagName).toBe("button");

      const typed = await store.findScreenContextEvents({
        projectId: project.projectId,
        sessionIds: ["sess_1", "sess_2"],
        urlPath: "/settings",
        from: "2026-09-02T02:00:00.000Z",
        to: "2026-09-02T02:00:10.000Z",
        types: ["js_error"],
      });

      expect(typed.map((matchedEvent) => matchedEvent.eventId)).toEqual(["evt_other_session"]);

      const anyPath = await store.findScreenContextEvents({
        projectId: project.projectId,
        sessionIds: ["sess_1"],
        from: "2026-09-02T02:00:06.000Z",
        to: "2026-09-02T02:00:06.000Z",
      });

      expect(anyPath.map((matchedEvent) => matchedEvent.eventId)).toEqual(["evt_other_path"]);

      await expect(
        store.findScreenContextEvents({
          projectId: project.projectId,
          sessionIds: [],
          from: "2026-09-02T02:00:00.000Z",
          to: "2026-09-02T02:00:10.000Z",
        }),
      ).resolves.toEqual([]);
    });

    it("클릭 지점이 있는 이벤트를 먼저 고르고, 없을 때만 프레임뿐인 이벤트를 쓴다", async () => {
      // 뷰포트보다 큰 대상(body·전체 래퍼 등 전형적인 dead click 대상)은 SDK 가
      // target 을 버리고 화면 프레임만 남긴다. 그런 이벤트가 시간상 앞선다는 이유로
      // 뽑히면 대시보드 대표 화면에 클릭 지점이 없는 빈 프레임이 뜬다.
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const frameOnly = { viewport: { width: 1440, height: 900 }, layoutHints: [] };
      const withTarget = {
        viewport: { width: 1440, height: 900 },
        target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
        layoutHints: [],
      };
      const event = (eventId: string, sessionId: string, timestamp: string, screenContext: unknown) => ({
        eventId,
        sessionId,
        pageId: "page_1",
        timestamp,
        type: "click" as const,
        urlPath: "/settings",
        metadata: {},
        screenContext,
      });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-02T03:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          // sess_1: 프레임뿐인 이벤트가 더 이르다 -> 뒤의 target 있는 쪽을 골라야 한다.
          event("evt_frame_only", "sess_1", "2026-09-02T02:00:01.000Z", frameOnly),
          event("evt_has_target", "sess_1", "2026-09-02T02:00:02.000Z", withTarget),
          // sess_2: 프레임뿐인 이벤트만 있다 -> 그거라도 돌려줘야 한다.
          event("evt_only_frame", "sess_2", "2026-09-02T02:00:03.000Z", frameOnly),
        ],
      } as Parameters<typeof store.saveBatch>[0]);

      const matched = await store.findScreenContextEvents({
        projectId: project.projectId,
        sessionIds: ["sess_1", "sess_2"],
        urlPath: "/settings",
        from: "2026-09-02T02:00:00.000Z",
        to: "2026-09-02T02:00:10.000Z",
      });

      expect(matched.map((matchedEvent) => matchedEvent.eventId)).toEqual(["evt_has_target", "evt_only_frame"]);
      expect(matched[0]?.screenContext?.target?.tagName).toBe("button");
      expect(matched[1]?.screenContext?.target).toBeUndefined();
    });

    it("cutoff 이전 이벤트만 삭제한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const otherProject = await store.createProject({
        name: "Other",
        allowedDomains: ["https://other.example.com"],
      });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-08-25T00:00:03.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_old",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-25T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
          {
            eventId: "evt_cutoff",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-26T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
          {
            eventId: "evt_new",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-08-26T00:00:01.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      });
      await store.saveBatch({
        projectId: otherProject.projectId,
        anonymousUserId: "anon_2",
        sessionId: "sess_2",
        sentAt: "2026-08-25T00:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://other.example.com/settings",
        events: [
          {
            eventId: "evt_other_old",
            sessionId: "sess_2",
            pageId: "page_2",
            timestamp: "2026-08-25T00:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            metadata: {},
          },
        ],
      });

      await expect(store.deleteEventsBefore("2026-08-26T00:00:00.000Z")).resolves.toBe(2);

      expect((await store.listEvents(project.projectId)).map((event) => event.eventId)).toEqual([
        "evt_cutoff",
        "evt_new",
      ]);
      expect(await store.listEvents(otherProject.projectId)).toEqual([]);
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
