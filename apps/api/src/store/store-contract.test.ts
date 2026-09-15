import { afterEach, describe, expect, it } from "vitest";
import type { TraceEvent } from "@trace/shared";
import { elementKey } from "../detection/element-identity.js";
import { MemoryStore } from "./memory-store.js";
import { SqliteStore } from "./sqlite-store.js";
import { assertDeployableTraceStore, SCREEN_CONTEXT_CANDIDATE_LIMIT, type TraceStore } from "./types.js";

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

    // INSERT OR REPLACE 의 컬럼 목록·플레이스홀더·run() 인자 셋이 어긋나도
    // 타입 오류가 아니라 실행 시점 오류다. 왕복으로 잡는다.
    it("이슈의 요소 키가 저장 후 그대로 돌아온다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });

      await store.upsertIssues(project.projectId, [
        {
          issueId: "issue__settings|0fd2102e520470ad|rage_click",
          projectId: project.projectId,
          issueType: "rage_click",
          title: "제목",
          summary: "요약",
          affectedSessionsCount: 1,
          affectedUsersCount: 1,
          severityScore: 70,
          firstSeenAt: "2026-09-04T00:00:00.000Z",
          lastSeenAt: "2026-09-04T00:00:01.000Z",
          trend: "flat",
          relatedUrlPath: "/settings",
          exampleSessionIds: ["sess_1"],
          status: "new",
          elementKey: "0fd2102e520470ad",
        },
        {
          issueId: "issue__settings|page|error_friction",
          projectId: project.projectId,
          issueType: "error_friction",
          title: "오류",
          summary: "요약",
          affectedSessionsCount: 1,
          affectedUsersCount: 1,
          severityScore: 60,
          firstSeenAt: "2026-09-04T00:00:00.000Z",
          lastSeenAt: "2026-09-04T00:00:00.000Z",
          trend: "flat",
          relatedUrlPath: "/settings",
          exampleSessionIds: ["sess_1"],
          status: "new",
        },
      ]);

      const issues = await store.listIssues(project.projectId);
      const rage = issues.find((issue) => issue.issueType === "rage_click");
      const error = issues.find((issue) => issue.issueType === "error_friction");

      expect(rage?.elementKey).toBe("0fd2102e520470ad");
      expect(error?.elementKey).toBeUndefined();
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

    it("요소 키를 넘기면 그 요소의 클릭만 돌려준다", async () => {
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const screenContext = {
        viewport: { width: 1440, height: 900 },
        target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
        layoutHints: [],
      };
      const click = (eventId: string, timestamp: string, hash: string | undefined, text: string) => ({
        eventId,
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp,
        type: "click" as const,
        urlPath: "/settings",
        ...(hash === undefined ? {} : { elementSelectorHash: hash }),
        elementTextMaskedOrLimited: text,
        metadata: {},
        screenContext,
      });

      // 리포트 내보내기와 오류 발생은 지문이 같고 글자만 다르다. 실제 데모에서
      // 관측된 형태이고, 이번 결함이 이 둘을 뭉갰다.
      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-04T00:00:10.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [
          click("evt_save", "2026-09-04T00:00:01.000Z", "1111111111111111", "저장"),
          click("evt_report", "2026-09-04T00:00:02.000Z", "2222222222222222", "리포트 내보내기"),
          click("evt_error", "2026-09-04T00:00:03.000Z", "2222222222222222", "오류 발생"),
          click("evt_legacy", "2026-09-04T00:00:04.000Z", undefined, "지문 없음"),
        ],
      });

      const query = {
        projectId: project.projectId,
        sessionIds: ["sess_1"],
        urlPath: "/settings",
        from: "2026-09-04T00:00:00.000Z",
        to: "2026-09-04T00:00:09.000Z",
      };

      const reportKey = elementKey(click("x", "2026-09-04T00:00:02.000Z", "2222222222222222", "리포트 내보내기") as TraceEvent)!;
      const errorKey = elementKey(click("x", "2026-09-04T00:00:03.000Z", "2222222222222222", "오류 발생") as TraceEvent)!;
      expect(reportKey).not.toBe(errorKey);

      const report = await store.findScreenContextEvents({ ...query, elementKey: reportKey });
      expect(report.map((event) => event.eventId)).toEqual(["evt_report"]);

      const error = await store.findScreenContextEvents({ ...query, elementKey: errorKey });
      expect(error.map((event) => event.eventId)).toEqual(["evt_error"]);

      // 키를 안 넘기면 지금 그대로 — 세션당 가장 이른 후보 하나.
      const unfiltered = await store.findScreenContextEvents(query);
      expect(unfiltered.map((event) => event.eventId)).toEqual(["evt_save"]);

      // 지문이 없는 옛 이벤트는 element_key 가 NULL 이라 어떤 키 조회에도 걸리지
      // 않는다. 위 두 단정이 evt_legacy 를 빼고 있지만, 요소 신원 마이그레이션이
      // 과거 지문을 전부 NULL 로 만들었으므로 이 성질을 따로 못박는다.
      const legacyKey = elementKey(click("x", "2026-09-04T00:00:04.000Z", undefined, "지문 없음") as TraceEvent);
      expect(legacyKey).toBeUndefined();

      const everyKeyed = await Promise.all(
        [reportKey, errorKey].map((key) => store.findScreenContextEvents({ ...query, elementKey: key })),
      );
      // element_key 가 NULL 인 evt_legacy 는 두 키 조회 어느 쪽에도 들어오지
      // 않아야 한다. 스토어가 elementKey 필터를 아예 무시하고 세션의 이벤트를
      // 죄다 돌려주는 결함이 있다면 evt_legacy 도 섞여 나온다 — 그래서 이 배열이
      // report·error 두 건만으로 정확히 채워지는지까지 함께 확인한다("아무것도
      // 안 돌아온다" 로도 통과해 버리는 단정이면 그 결함을 못 잡는다).
      expect(everyKeyed.flat().map((event) => event.eventId).sort()).toEqual(["evt_error", "evt_report"]);
    });

    it("후보가 SCREEN_CONTEXT_CANDIDATE_LIMIT 를 넘어도 요소 필터가 LIMIT 보다 먼저 적용된다", async () => {
      // 대상 요소의 유일한 클릭을 시간순 11번째(상한 10건 밖)에 둔다. 요소 필터가
      // SQL 의 LIMIT 뒤로 밀리는 구현(상위 10건만 읽고 그 다음 JS 에서 걸러내는
      // 방식)이라면 그 클릭은 애초에 읽히지도 않아 결과가 비어 버린다. 지금
      // 픽스처(4건)는 SCREEN_CONTEXT_CANDIDATE_LIMIT(10) 을 넘지 않아 이 순서
      // 회귀를 구분하지 못했다.
      const store = open();
      const project = await store.createProject({
        name: "Demo",
        allowedDomains: ["https://demo.example.com"],
      });
      const screenContext = {
        viewport: { width: 1440, height: 900 },
        target: { tagName: "button", rect: { x: 620, y: 420, width: 96, height: 40 } },
        layoutHints: [],
      };
      const click = (eventId: string, timestamp: string, hash: string, text: string) => ({
        eventId,
        sessionId: "sess_1",
        pageId: "page_1",
        timestamp,
        type: "click" as const,
        urlPath: "/settings",
        elementSelectorHash: hash,
        elementTextMaskedOrLimited: text,
        metadata: {},
        screenContext,
      });

      const noise = Array.from({ length: SCREEN_CONTEXT_CANDIDATE_LIMIT }, (_, index) =>
        click(
          `evt_noise_${index}`,
          `2026-09-04T00:00:${String(index).padStart(2, "0")}.000Z`,
          "9999999999999999",
          "다른 버튼",
        ),
      );
      const target = click("evt_target", `2026-09-04T00:00:${SCREEN_CONTEXT_CANDIDATE_LIMIT}.000Z`, "1111111111111111", "대상 버튼");

      await store.saveBatch({
        projectId: project.projectId,
        anonymousUserId: "anon_1",
        sessionId: "sess_1",
        sentAt: "2026-09-04T00:01:00.000Z",
        sdkVersion: "0.1.0",
        url: "https://demo.example.com/settings",
        events: [...noise, target],
      });

      const targetKey = elementKey(target as TraceEvent)!;

      const matched = await store.findScreenContextEvents({
        projectId: project.projectId,
        sessionIds: ["sess_1"],
        urlPath: "/settings",
        from: "2026-09-04T00:00:00.000Z",
        to: "2026-09-04T00:01:00.000Z",
        elementKey: targetKey,
      });

      expect(matched.map((event) => event.eventId)).toEqual(["evt_target"]);
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
