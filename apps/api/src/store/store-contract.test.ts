import { afterEach, describe, expect, it } from "vitest";
import type { TraceEvent } from "@trace/shared";
import { elementKey } from "./element-key.js";
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

      expect(await store.getSessionTimeline(project.projectId, "sess_1")).toHaveLength(1);
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

      expect((await store.getSessionTimeline(project.projectId, "sess_1")).map((event) => event.eventId)).toEqual([
        "evt_cutoff",
        "evt_new",
      ]);
      expect(await store.getSessionTimeline(otherProject.projectId, "sess_2")).toEqual([]);
    });

    it("요소 지문과 마스킹 글자를 모두 왕복 보존한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-03T01:00:01.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          {
            eventId: "evt_identity",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-03T01:00:00.000Z",
            type: "click",
            urlPath: "/settings",
            elementSelectorHash: "aaaaaaaabbbbbbbb",
            elementTextMaskedOrLimited: "오류 발생",
            metadata: {},
          },
        ],
      });

      const timeline = await store.getSessionTimeline(project.projectId, "sess_1");
      const event = timeline.find((candidate) => candidate.eventId === "evt_identity");

      expect(event?.elementSelectorHash).toBe("aaaaaaaabbbbbbbb");
      expect(event?.elementTextMaskedOrLimited).toBe("오류 발생");
    });

    // INSERT OR REPLACE 의 컬럼 목록·플레이스홀더·run() 인자 셋이 어긋나도
    // 타입 오류가 아니라 실행 시점 오류다. 왕복으로 잡는다.

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

    it("새 프로젝트는 리플레이가 꺼진 채로 시작한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      expect(project.replay).toEqual({ enabled: false, maskSelectors: [] });
      expect((await store.getProject(project.projectId))?.replay).toEqual({
        enabled: false,
        maskSelectors: [],
      });
    });

    it("리플레이를 켜고 마스킹 셀렉터를 저장한다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      const updated = await store.updateProject(project.projectId, {
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
        replay: { enabled: true, maskSelectors: [".customer-name"] },
      });

      expect(updated?.replay).toEqual({ enabled: true, maskSelectors: [".customer-name"] });
      expect((await store.getProject(project.projectId))?.replay.enabled).toBe(true);
    });

    // 관리자 화면은 아직 리플레이 항목을 보내지 않는다. 이름만 고치는 요청이
    // 리플레이를 조용히 꺼 버리면 기록이 그 순간 멈춘다.
    it("replay 를 빼고 수정하면 기존 설정이 남는다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      await store.updateProject(project.projectId, {
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
        replay: { enabled: true, maskSelectors: [".customer-name"] },
      });

      const renamed = await store.updateProject(project.projectId, {
        name: "Demo 2",
        allowedDomains: ["https://demo.example.com"],
      });

      expect(renamed?.name).toBe("Demo 2");
      expect(renamed?.replay).toEqual({ enabled: true, maskSelectors: [".customer-name"] });
    });

    it("세션 기록 청크를 seq 순서로 돌려준다", async () => {
      const store = open();
      const chunk = (seq: number, startedAt: string) => ({
        sessionId: "sess_1",
        projectId: "proj_1",
        seq,
        startedAt,
        receivedAt: "2026-09-14T00:05:00.000Z",
        eventCount: 2,
        bytes: new Uint8Array([seq, 9, 9]),
      });

      await store.saveSessionRecordingChunk(chunk(1, "2026-09-14T00:02:00.000Z"));
      await store.saveSessionRecordingChunk(chunk(0, "2026-09-14T00:00:00.000Z"));

      const stored = await store.listSessionRecordingChunks("proj_1", "sess_1");
      expect(stored.map((item) => item.seq)).toEqual([0, 1]);
      expect(Array.from(stored[0]!.bytes)).toEqual([0, 9, 9]);
      expect(stored[0]!.eventCount).toBe(2);
    });

    // 재전송은 네트워크가 불안정하면 평범하게 일어난다. 두 번 저장하면 재생할 때
    // 같은 구간이 두 번 나온다.
    it("같은 seq 를 다시 보내면 무시한다", async () => {
      const store = open();
      const chunk = {
        sessionId: "sess_1",
        projectId: "proj_1",
        seq: 0,
        startedAt: "2026-09-14T00:00:00.000Z",
        receivedAt: "2026-09-14T00:00:01.000Z",
        eventCount: 1,
        bytes: new Uint8Array([1, 2, 3]),
      };

      await store.saveSessionRecordingChunk(chunk);
      await store.saveSessionRecordingChunk({ ...chunk, bytes: new Uint8Array([4, 5, 6]) });

      const stored = await store.listSessionRecordingChunks("proj_1", "sess_1");
      expect(stored).toHaveLength(1);
      expect(Array.from(stored[0]!.bytes)).toEqual([1, 2, 3]);
    });

    it("다른 세션의 청크를 섞지 않는다", async () => {
      const store = open();
      const base = {
        projectId: "proj_1",
        seq: 0,
        startedAt: "2026-09-14T00:00:00.000Z",
        receivedAt: "2026-09-14T00:00:01.000Z",
        eventCount: 1,
        bytes: new Uint8Array([1]),
      };
      await store.saveSessionRecordingChunk({ ...base, sessionId: "sess_1" });
      await store.saveSessionRecordingChunk({ ...base, sessionId: "sess_2" });

      expect(await store.listSessionRecordingChunks("proj_1", "sess_1")).toHaveLength(1);
    });

    // 청크 라우트는 seq 하나만 있으면 된다. listSessionRecordingChunks 로 세션
    // 전체를 읽고 .find() 로 골라내면 재생 한 번에 세션의 모든 BLOB 을 SELECT·
    // 복사한다 - SDK 가 10초마다 flush 하므로 30분 세션이면 청크 약 180개다.
    it("seq 하나만 골라 돌려준다", async () => {
      const store = open();
      const chunk = (seq: number) => ({
        sessionId: "sess_1",
        projectId: "proj_1",
        seq,
        startedAt: "2026-09-14T00:00:00.000Z",
        receivedAt: "2026-09-14T00:05:00.000Z",
        eventCount: 2,
        bytes: new Uint8Array([seq, 9, 9]),
      });
      await store.saveSessionRecordingChunk(chunk(0));
      await store.saveSessionRecordingChunk(chunk(1));

      const found = await store.getSessionRecordingChunk("proj_1", "sess_1", 1);
      expect(found?.seq).toBe(1);
      expect(Array.from(found!.bytes)).toEqual([1, 9, 9]);
      expect(found!.eventCount).toBe(2);
    });

    it("없는 seq 는 undefined 를 돌려준다", async () => {
      const store = open();
      await store.saveSessionRecordingChunk({
        sessionId: "sess_1",
        projectId: "proj_1",
        seq: 0,
        startedAt: "2026-09-14T00:00:00.000Z",
        receivedAt: "2026-09-14T00:05:00.000Z",
        eventCount: 1,
        bytes: new Uint8Array([1]),
      });

      expect(await store.getSessionRecordingChunk("proj_1", "sess_1", 9)).toBeUndefined();
    });

    it("다른 프로젝트로는 청크를 넘기지 않는다", async () => {
      const store = open();
      const base = {
        seq: 0,
        startedAt: "2026-09-15T00:00:00.000Z",
        receivedAt: "2026-09-15T00:00:00.000Z",
        eventCount: 1,
        bytes: new Uint8Array([1]),
      };
      await store.saveSessionRecordingChunk({ ...base, sessionId: "sess_a", projectId: "proj_a" });
      await store.saveSessionRecordingChunk({ ...base, sessionId: "sess_b", projectId: "proj_b" });

      // sess_b 는 proj_b 소속이다 - proj_a 로 물으면 project_id 가 걸러야 한다.
      expect(await store.getSessionRecordingChunk("proj_a", "sess_b", 0)).toBeUndefined();
      expect(await store.getSessionRecordingChunk("proj_b", "sess_a", 0)).toBeUndefined();
      expect((await store.getSessionRecordingChunk("proj_a", "sess_a", 0))?.sessionId).toBe("sess_a");
    });

    // 보존 스윕은 **서버가 받은 시각**으로 판정한다. startedAt 은 브라우저 시계가
    // 적어 보낸 값이고 봉투 검증은 "날짜 문자열이다" 까지만 본다. 그 값으로
    // 판정하면 두 가지가 실제로 일어난다 - 시계가 미래로 어긋난 기기의 기록은
    // 7일 창을 영원히 살아남고, 과거로 어긋난 기기의 기록은 저장되자마자 같은
    // 요청 안의 스윕에 지워져 202 를 받고도 아무것도 남지 않는다(조용한 유실).
    it("보존 기한을 서버가 받은 시각으로 판정한다", async () => {
      const store = open();
      const base = {
        projectId: "proj_1",
        sessionId: "sess_1",
        eventCount: 1,
        bytes: new Uint8Array([1]),
      };
      // 시계가 미래로 어긋난 기기. 오래전에 받았으니 지워져야 한다.
      await store.saveSessionRecordingChunk({
        ...base,
        seq: 0,
        startedAt: "2999-01-01T00:00:00.000Z",
        receivedAt: "2026-09-01T00:00:00.000Z",
      });
      // 시계가 과거로 어긋난 기기. 방금 받았으니 남아야 한다.
      await store.saveSessionRecordingChunk({
        ...base,
        seq: 1,
        startedAt: "2020-01-01T00:00:00.000Z",
        receivedAt: "2026-09-13T00:00:00.000Z",
      });

      const deleted = await store.deleteSessionRecordingsBefore("2026-09-07T00:00:00.000Z");

      expect(deleted).toBe(1);
      const kept = await store.listSessionRecordingChunks("proj_1", "sess_1");
      expect(kept.map((chunk) => chunk.seq)).toEqual([1]);
      // 두 시각을 접지 않고 각각 돌려줘야 한다 - 재생은 startedAt 을 쓰고
      // 보존은 receivedAt 을 쓴다.
      expect(kept[0]!.startedAt).toBe("2020-01-01T00:00:00.000Z");
      expect(kept[0]!.receivedAt).toBe("2026-09-13T00:00:00.000Z");
    });

    it("모든 세션을 최근 순으로 집계하고 기록 유무를 알려준다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const event = (eventId: string, timestamp: string) => ({
        eventId,
        sessionId: "",
        pageId: "page_1",
        timestamp,
        type: "click" as const,
        urlPath: "/settings",
        metadata: {},
      });
      const batch = (sessionId: string, timestamps: string[]) => ({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId,
        sentAt: "2026-09-15T02:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: timestamps.map((t, i) => ({ ...event(`evt_${sessionId}_${i}`, t), sessionId })),
      });

      await store.saveBatch(batch("sess_old", ["2026-09-15T00:00:00.000Z", "2026-09-15T00:01:00.000Z"]));
      await store.saveBatch(batch("sess_new", ["2026-09-15T01:00:00.000Z"]));
      // sess_new 에만 리플레이 기록이 있다.
      await store.saveSessionRecordingChunk({
        sessionId: "sess_new",
        projectId: project.projectId,
        seq: 0,
        startedAt: "2026-09-15T01:00:00.000Z",
        receivedAt: "2026-09-15T01:00:10.000Z",
        eventCount: 3,
        bytes: new Uint8Array([1, 2, 3]),
      });

      const sessions = await store.listSessions(project.projectId, 50);

      expect(sessions.map((s) => s.sessionId)).toEqual(["sess_new", "sess_old"]);
      expect(sessions[0]).toEqual({
        sessionId: "sess_new",
        startedAt: "2026-09-15T01:00:00.000Z",
        lastSeenAt: "2026-09-15T01:00:00.000Z",
        eventCount: 1,
        hasRecording: true,
      });
      expect(sessions[1]).toEqual({
        sessionId: "sess_old",
        startedAt: "2026-09-15T00:00:00.000Z",
        lastSeenAt: "2026-09-15T00:01:00.000Z",
        eventCount: 2,
        hasRecording: false,
      });
    });

    it("다른 프로젝트의 세션은 섞이지 않는다", async () => {
      const store = open();
      const a = await store.createProject({ name: "A", allowedDomains: ["https://a.example.com"] });
      const b = await store.createProject({ name: "B", allowedDomains: ["https://b.example.com"] });
      const batch = (projectId: string, sessionId: string) => ({
        projectId,
        anonymousUserId: "anon_1",
        sessionId,
        sentAt: "2026-09-15T02:00:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [{
          eventId: `evt_${sessionId}`,
          sessionId,
          pageId: "page_1",
          timestamp: "2026-09-15T00:00:00.000Z",
          type: "click" as const,
          urlPath: "/settings",
          metadata: {},
        }],
      });

      await store.saveBatch(batch(a.projectId, "sess_a"));
      await store.saveBatch(batch(b.projectId, "sess_b"));

      expect((await store.listSessions(a.projectId, 50)).map((s) => s.sessionId)).toEqual(["sess_a"]);
    });

    it("페이지별 방문·체류·이탈·스크롤 도달을 센다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const event = (
        sessionId: string,
        eventId: string,
        type: "page_view" | "page_leave" | "scroll",
        urlPath: string,
        timestamp: string,
        metadata: Record<string, unknown> = {},
      ) => ({ eventId, sessionId, pageId: "page_1", timestamp, type, urlPath, metadata });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-15T00:10:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/",
        events: [
          event("sess_1", "evt_1", "page_view", "/home", "2026-09-15T00:00:00.000Z"),
          event("sess_1", "evt_2", "scroll", "/home", "2026-09-15T00:00:05.000Z", {
            metric: "scroll_depth",
            score: 50,
          }),
          event("sess_1", "evt_3", "page_leave", "/home", "2026-09-15T00:00:10.000Z"),
          event("sess_1", "evt_4", "page_view", "/report", "2026-09-15T00:00:10.000Z"),
          event("sess_1", "evt_5", "page_leave", "/report", "2026-09-15T00:00:40.000Z"),
        ],
      });

      const stats = await store.listPageStats(project.projectId, 50);
      const home = stats.find((row) => row.urlPath === "/home")!;
      const report = stats.find((row) => row.urlPath === "/report")!;

      expect(home.views).toBe(1);
      expect(home.averageDwellMs).toBe(10_000);
      // /home 은 세션의 마지막 page_view 가 아니다.
      expect(home.exitRate).toBe(0);
      expect(home.scrollReach).toEqual([
        { depth: 25, ratio: 0 },
        { depth: 50, ratio: 1 },
        { depth: 75, ratio: 0 },
        { depth: 100, ratio: 0 },
      ]);

      expect(report.views).toBe(1);
      expect(report.averageDwellMs).toBe(30_000);
      // /report 가 세션의 마지막 page_view 다.
      expect(report.exitRate).toBe(1);
    });

    // 라우팅으로 페이지를 옮기면 이전 경로의 page_leave·scroll 과 다음
    // page_view 가 같은 동기 tick 에서 나가 같은 밀리초를 찍을 수 있다.
    // urlPath 가 이미 페이지를 가르므로, 그 경계 밀리초의 스크롤도 이전
    // 페이지 몫으로 세어야 한다 — < 로 좁히면 이 경우를 놓친다.
    it("라우팅 경계와 같은 밀리초의 스크롤도 도달로 센다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const event = (
        sessionId: string,
        eventId: string,
        type: "page_view" | "page_leave" | "scroll",
        urlPath: string,
        timestamp: string,
        metadata: Record<string, unknown> = {},
      ) => ({ eventId, sessionId, pageId: "page_1", timestamp, type, urlPath, metadata });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-15T00:10:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/",
        events: [
          event("sess_1", "evt_1", "page_view", "/home", "2026-09-15T00:00:00.000Z"),
          event("sess_1", "evt_2", "scroll", "/home", "2026-09-15T00:00:10.000Z", {
            metric: "scroll_depth",
            score: 50,
          }),
          event("sess_1", "evt_3", "page_leave", "/home", "2026-09-15T00:00:10.000Z"),
          event("sess_1", "evt_4", "page_view", "/report", "2026-09-15T00:00:10.000Z"),
        ],
      });

      const stats = await store.listPageStats(project.projectId, 50);
      const home = stats.find((row) => row.urlPath === "/home")!;

      expect(home.scrollReach).toEqual([
        { depth: 25, ratio: 0 },
        { depth: 50, ratio: 1 },
        { depth: 75, ratio: 0 },
        { depth: 100, ratio: 0 },
      ]);
    });

    // 브라우저가 강제 종료되면 page_leave 가 못 나간다. 0 으로 세면 평균이
    // 끌려 내려간다.
    it("짝 없는 방문은 평균 체류에서 뺀다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-15T00:10:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-15T00:00:00.000Z",
            type: "page_view" as const,
            urlPath: "/home",
            metadata: {},
          },
          {
            eventId: "evt_2",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-15T00:00:10.000Z",
            type: "page_leave" as const,
            urlPath: "/home",
            metadata: {},
          },
          {
            eventId: "evt_3",
            sessionId: "sess_2",
            pageId: "page_1",
            timestamp: "2026-09-15T00:01:00.000Z",
            type: "page_view" as const,
            urlPath: "/home",
            metadata: {},
          },
        ],
      });

      const stats = await store.listPageStats(project.projectId, 50);
      const home = stats.find((row) => row.urlPath === "/home")!;

      expect(home.views).toBe(2);
      // 짝이 있는 방문 하나만 평균에 들어간다.
      expect(home.averageDwellMs).toBe(10_000);
    });

    it("page_leave 가 하나도 없으면 평균 체류가 undefined 다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-15T00:10:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/",
        events: [
          {
            eventId: "evt_1",
            sessionId: "sess_1",
            pageId: "page_1",
            timestamp: "2026-09-15T00:00:00.000Z",
            type: "page_view" as const,
            urlPath: "/home",
            metadata: {},
          },
        ],
      });

      const stats = await store.listPageStats(project.projectId, 50);

      expect(stats[0]!.averageDwellMs).toBeUndefined();
    });

    it("프로젝트에 이벤트가 없으면 빈 배열이다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      expect(await store.listPageStats(project.projectId, 50)).toEqual([]);
    });

    it("limit 을 넘으면 방문이 많은 페이지부터 자르지 않고 남긴다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const view = (sessionId: string, eventId: string, urlPath: string) => ({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId,
        sentAt: "2026-09-15T00:10:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/",
        events: [
          {
            eventId,
            sessionId,
            pageId: "page_1",
            timestamp: "2026-09-15T00:00:00.000Z",
            type: "page_view" as const,
            urlPath,
            metadata: {},
          },
        ],
      });

      // /a: 3 views, /b: 2 views, /c: 1 view, /d: 1 view — 서로 다른 세션.
      // 저장 순서를 방문 수 내림차순과 반대로 둔다 - 정렬을 빼먹은 구현이
      // 삽입 순서(=/d,/c,/b,/a)를 그대로 돌려줘도 이 순서로는 우연히
      // 기대값(/a,/b)과 맞아떨어지지 않는다.
      await store.saveBatch(view("sess_d1", "evt_d1", "/d"));
      await store.saveBatch(view("sess_c1", "evt_c1", "/c"));
      await store.saveBatch(view("sess_b1", "evt_b1", "/b"));
      await store.saveBatch(view("sess_b2", "evt_b2", "/b"));
      await store.saveBatch(view("sess_a1", "evt_a1", "/a"));
      await store.saveBatch(view("sess_a2", "evt_a2", "/a"));
      await store.saveBatch(view("sess_a3", "evt_a3", "/a"));

      const stats = await store.listPageStats(project.projectId, 2);

      expect(stats).toHaveLength(2);
      expect(stats.map((row) => row.urlPath)).toEqual(["/a", "/b"]);
      expect(stats.map((row) => row.views)).toEqual([3, 2]);
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
