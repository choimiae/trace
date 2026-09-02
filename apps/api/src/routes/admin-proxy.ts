import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Issue, TraceEvent } from "@trace/shared";
import type { AdminAuthConfig } from "../auth/config.js";
import { parseCookieHeader } from "../auth/cookies.js";
import { verifyCsrfRequest } from "../auth/csrf.js";
import { requireAdminSession, type AuthenticatedAdmin } from "../auth/session.js";
import type { AdminRole, AdminUserRecord, ProjectMembershipRecord, ProjectRecord, TraceStore } from "../store/types.js";
import {
  addProjectMemberSchema,
  auditLogQuerySchema,
  createProjectSchema,
  memberCandidateSearchSchema,
  updateProjectMemberRoleSchema,
  updateProjectSchema,
} from "./admin.js";

const projectParamsSchema = z.object({ projectId: z.string() });
const projectMemberParamsSchema = z.object({ projectId: z.string(), adminUserId: z.string() });
const issueParamsSchema = z.object({ issueId: z.string() });
const sessionParamsSchema = z.object({ sessionId: z.string() });
const projectQuerySchema = z.object({ projectId: z.string() });

export async function registerAdminProxyRoutes(
  app: FastifyInstance,
  options: { store: TraceStore; config: AdminAuthConfig },
) {
  app.post("/admin/api/projects", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_allowed_domains" });

    const project = await options.store.createProject(parsed.data);
    const createdAt = new Date().toISOString();
    await options.store.addProjectMembership({
      projectId: project.projectId,
      adminUserId: authenticated.adminUserId,
      role: "owner",
      createdAt,
    });
    await options.store.createAuditLog({
      adminUserId: authenticated.adminUserId,
      action: "project.created",
      projectId: project.projectId,
      createdAt,
      metadata: { name: project.name },
    });
    return reply.code(201).send({
      ...project,
      installSnippet: `<script src="https://cdn.trace.app/sdk.js" data-project-id="${project.projectId}"></script>`,
    });
  });

  app.get("/admin/api/projects/:projectId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_settings");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    return toProjectSettingsResponse(access.project, access.membership.role);
  });

  app.get("/admin/api/projects/:projectId/members", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_members");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const memberships = await options.store.listProjectMemberships(projectId);
    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await options.store.getAdminUser(membership.adminUserId);
        return toProjectMemberResponse(membership, user);
      }),
    );

    return members.filter((member): member is ProjectMemberResponse => member !== undefined);
  });

  app.get("/admin/api/projects/:projectId/member-candidates", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_member_candidates");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
    // 권한 검사를 schema 검증보다 먼저 둔다. owner 가 아닌 요청자에게
    // limit 검증 결과를 흘리지 않는다.
    if (access.membership.role !== "owner") {
      return reply.code(403).send({ error: "project_role_forbidden" });
    }

    const parsed = memberCandidateSearchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_member_candidate_search" });

    const [users, memberships] = await Promise.all([
      options.store.searchAdminUsers(parsed.data),
      options.store.listProjectMemberships(projectId),
    ]);
    const roleByAdminUserId = new Map(
      memberships.map((membership) => [membership.adminUserId, membership.role]),
    );

    return users.map((user) => {
      const candidate: ProjectMemberCandidateResponse = {
        adminUserId: user.adminUserId,
        email: user.email,
      };
      if (user.name !== undefined) candidate.name = user.name;
      const role = roleByAdminUserId.get(user.adminUserId);
      if (role !== undefined) candidate.membership = { role };
      return candidate;
    });
  });

  app.get("/admin/api/projects/:projectId/audit-logs", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_audit_logs");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
    // 권한 검사를 schema 검증보다 먼저 둔다. owner 가 아닌 요청자에게
    // limit·cursor 검증 결과를 흘리지 않는다.
    if (access.membership.role !== "owner") {
      return reply.code(403).send({ error: "project_role_forbidden" });
    }

    const parsed = auditLogQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_audit_log_query" });

    const cursor = parsed.data.cursor === undefined
      ? undefined
      : parseAuditLogCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && cursor === undefined) {
      return reply.code(400).send({ error: "invalid_audit_log_query" });
    }

    // limit + 1 을 읽어 다음 페이지 존재를 별도 count 없이 판정한다.
    const rows = await options.store.listProjectAuditLogs({
      projectId,
      limit: parsed.data.limit + 1,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const page = rows.slice(0, parsed.data.limit);
    const hasMore = rows.length > parsed.data.limit;

    const actors = await resolveAuditLogActors(options.store, page);
    const entries = page.map((row) => {
      const entry: ProjectAuditLogEntryResponse = {
        auditLogId: row.auditLogId,
        action: row.action,
        createdAt: row.createdAt,
        metadata: row.metadata,
      };
      if (row.adminUserId !== undefined) {
        entry.actor = actors.get(row.adminUserId) ?? { adminUserId: row.adminUserId };
      }
      return entry;
    });

    const lastEntry = page[page.length - 1];
    return hasMore && lastEntry !== undefined
      ? { entries, nextCursor: encodeAuditLogCursor(lastEntry) }
      : { entries };
  });

  app.post("/admin/api/projects/:projectId/members", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_members");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
    if (access.membership.role !== "owner") {
      return reply.code(403).send({ error: "project_role_forbidden" });
    }

    const parsed = addProjectMemberSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_project_member" });

    const user = await options.store.getAdminUserByEmail(parsed.data.email);
    if (!user) return reply.code(404).send({ error: "admin_user_not_found" });

    const existing = await options.store.getProjectMembership(projectId, user.adminUserId);
    if (existing) return reply.code(409).send({ error: "project_member_exists" });

    const createdAt = new Date().toISOString();
    let membership: ProjectMembershipRecord;
    try {
      membership = await options.store.addProjectMembershipWithAudit(
        {
          projectId,
          adminUserId: user.adminUserId,
          role: parsed.data.role,
          createdAt,
        },
        {
          adminUserId: authenticated.adminUserId,
          action: "project.member_added",
          projectId,
          createdAt,
          metadata: {
            addedAdminUserId: user.adminUserId,
            email: user.email,
            role: parsed.data.role,
          },
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "project_member_exists") {
        return reply.code(409).send({ error: "project_member_exists" });
      }
      throw error;
    }

    return reply.code(201).send(toProjectMemberResponse(membership, user));
  });

  app.patch("/admin/api/projects/:projectId/members/:adminUserId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    const params = projectMemberParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "project_not_found" });
    const body = updateProjectMemberRoleSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_project_member" });

    const access = await getProjectAccess(options.store, params.data.projectId, authenticated, "project_members");
    if ("error" in access) return reply.code(access.statusCode).send({ error: access.error });
    if (access.membership.role !== "owner") return reply.code(403).send({ error: "project_role_forbidden" });

    const targetUser = await options.store.getAdminUser(params.data.adminUserId);
    if (!targetUser) return reply.code(404).send({ error: "project_member_not_found" });

    try {
      const updated = await options.store.updateProjectMembershipRoleWithAudit({
        projectId: params.data.projectId,
        targetAdminUserId: params.data.adminUserId,
        requestedByAdminUserId: authenticated.adminUserId,
        role: body.data.role,
        auditLog: (current) => ({
          adminUserId: authenticated.adminUserId,
          projectId: params.data.projectId,
          createdAt: new Date().toISOString(),
          action: "project.member_role_updated",
          metadata: {
            targetAdminUserId: targetUser.adminUserId,
            email: targetUser.email,
            beforeRole: current.role,
            afterRole: body.data.role,
          },
        }),
      });
      if (!updated) return reply.code(404).send({ error: "project_member_not_found" });
      return reply.send(toProjectMemberResponse(updated, targetUser));
    } catch (error) {
      return sendProjectMemberMutationError(reply, error, "project_member_update_failed");
    }
  });

  app.delete("/admin/api/projects/:projectId/members/:adminUserId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    const params = projectMemberParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: "project_not_found" });

    const access = await getProjectAccess(options.store, params.data.projectId, authenticated, "project_members");
    if ("error" in access) return reply.code(access.statusCode).send({ error: access.error });
    if (access.membership.role !== "owner") return reply.code(403).send({ error: "project_role_forbidden" });

    const targetUser = await options.store.getAdminUser(params.data.adminUserId);
    if (!targetUser) return reply.code(404).send({ error: "project_member_not_found" });

    try {
      const removed = await options.store.removeProjectMembershipWithAudit({
        projectId: params.data.projectId,
        targetAdminUserId: params.data.adminUserId,
        requestedByAdminUserId: authenticated.adminUserId,
        auditLog: (current) => ({
          adminUserId: authenticated.adminUserId,
          projectId: params.data.projectId,
          createdAt: new Date().toISOString(),
          action: "project.member_removed",
          metadata: {
            targetAdminUserId: targetUser.adminUserId,
            email: targetUser.email,
            role: current.role,
          },
        }),
      });
      if (!removed) return reply.code(404).send({ error: "project_member_not_found" });
      return reply.code(204).send();
    } catch (error) {
      return sendProjectMemberMutationError(reply, error, "project_member_remove_failed");
    }
  });

  app.patch("/admin/api/projects/:projectId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const csrf = verifyCsrfRequest({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      adminAppOrigin: options.config.adminAppOrigin,
      csrfCookie: parseCookieHeader(request.headers.cookie).get(options.config.csrfCookieName),
      csrfHeader: firstHeaderValue(request.headers["x-trace-csrf"]),
    });
    if (!csrf.ok) return reply.code(csrf.statusCode).send({ error: csrf.error });

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_settings");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }
    if (access.membership.role === "viewer") {
      return reply.code(403).send({ error: "project_role_forbidden" });
    }

    const parsed = updateProjectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_project_settings" });

    const updated = await options.store.updateProject(projectId, parsed.data);
    if (!updated) return reply.code(404).send({ error: "project_not_found" });

    await options.store.createAuditLog({
      adminUserId: authenticated.adminUserId,
      action: "project.updated",
      projectId,
      createdAt: new Date().toISOString(),
      metadata: {
        before: {
          name: access.project.name,
          allowedDomains: access.project.allowedDomains,
        },
        after: {
          name: updated.name,
          allowedDomains: updated.allowedDomains,
        },
      },
    });

    return toProjectSettingsResponse(updated, access.membership.role);
  });

  app.get("/admin/api/projects/:projectId/summary", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_summary");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    return options.store.getDashboardSummary(projectId);
  });

  app.get("/admin/api/projects/:projectId/issues", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { projectId } = projectParamsSchema.parse(request.params);
    const access = await getProjectAccess(options.store, projectId, authenticated, "project_issues");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    const issues = await options.store.listIssues(projectId);
    return attachRepresentativeEvents(options.store, projectId, issues);
  });

  app.get("/admin/api/issues/:issueId", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { issueId } = issueParamsSchema.parse(request.params);
    const { projectId } = projectQuerySchema.parse(request.query);
    const project = await options.store.getProject(projectId);
    if (!project) return reply.code(404).send({ error: "project_not_found" });

    const issue = await options.store.getIssue(issueId);
    if (!issue || issue.projectId !== projectId) return reply.code(404).send({ error: "issue_not_found" });

    const membership = await options.store.getProjectMembership(projectId, authenticated.adminUserId);
    if (!membership) {
      await auditProjectAccessDenied(options.store, projectId, authenticated, "issue_detail");
      return reply.code(403).send({ error: "project_access_denied" });
    }

    const [enrichedIssue] = await attachRepresentativeEvents(options.store, issue.projectId, [issue]);
    return enrichedIssue;
  });

  app.get("/admin/api/sessions/:sessionId/timeline", async (request, reply) => {
    const authenticated = await authenticate(request, options);
    if ("error" in authenticated) return reply.code(401).send(authenticated);

    const { sessionId } = sessionParamsSchema.parse(request.params);
    const { projectId } = projectQuerySchema.parse(request.query);
    const access = await getProjectAccess(options.store, projectId, authenticated, "session_timeline");
    if ("error" in access) {
      return reply.code(access.statusCode).send({ error: access.error });
    }

    return options.store.getSessionTimeline(projectId, sessionId);
  });
}

async function authenticate(
  request: FastifyRequest,
  options: { store: TraceStore; config: AdminAuthConfig },
): Promise<AuthenticatedAdmin | { error: "admin_auth_required" }> {
  return requireAdminSession({
    store: options.store,
    config: options.config,
    cookieHeader: request.headers.cookie,
  });
}

async function getProjectAccess(
  store: TraceStore,
  projectId: string,
  authenticated: AuthenticatedAdmin,
  resourceType: ProjectResourceType,
): Promise<ProjectAccess | ProjectAccessError> {
  const project = await store.getProject(projectId);
  if (!project) return { statusCode: 404, error: "project_not_found" };

  const membership = await store.getProjectMembership(projectId, authenticated.adminUserId);
  if (!membership) {
    await auditProjectAccessDenied(store, projectId, authenticated, resourceType);
    return { statusCode: 403, error: "project_access_denied" };
  }

  return { project, membership };
}

async function attachRepresentativeEvents(
  store: TraceStore,
  projectId: string,
  issues: Issue[],
): Promise<Issue[]> {
  return Promise.all(
    issues.map(async (issue) => {
      const representativeEvent = await findRepresentativeEvent(store, projectId, issue);
      return representativeEvent === undefined ? issue : { ...issue, representativeEvent };
    }),
  );
}

async function findRepresentativeEvent(
  store: TraceStore,
  projectId: string,
  issue: Issue,
): Promise<TraceEvent | undefined> {
  for (const sessionId of issue.exampleSessionIds.slice(0, 3)) {
    const timeline = await store.getSessionTimeline(projectId, sessionId);
    const matchingEvent = timeline.find((event) => {
      const samePath = issue.relatedUrlPath ? event.urlPath === issue.relatedUrlPath : true;
      return samePath && Boolean(event.screenContext);
    });

    if (matchingEvent) {
      return matchingEvent;
    }
  }

  return undefined;
}

type ProjectAccess = {
  project: ProjectRecord;
  membership: ProjectMembershipRecord;
};

type ProjectAccessError =
  | { statusCode: 404; error: "project_not_found" }
  | { statusCode: 403; error: "project_access_denied" };

type ProjectResourceType =
  | "project_settings"
  | "project_members"
  | "project_member_candidates"
  | "project_audit_logs"
  | "project_summary"
  | "project_issues"
  | "issue_detail"
  | "session_timeline";

async function auditProjectAccessDenied(
  store: TraceStore,
  projectId: string,
  authenticated: AuthenticatedAdmin,
  resourceType: ProjectResourceType,
): Promise<void> {
  await store.createAuditLog({
    adminUserId: authenticated.adminUserId,
    action: "project.access_denied",
    projectId,
    createdAt: new Date().toISOString(),
    metadata: { resourceType },
  });
}

function sendProjectMemberMutationError(reply: FastifyReply, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (message === "self_owner_change_forbidden") {
    return reply.code(403).send({ error: "self_owner_change_forbidden" });
  }
  if (message === "last_owner_forbidden") {
    return reply.code(403).send({ error: "last_owner_forbidden" });
  }
  if (message === "project_role_forbidden") {
    return reply.code(403).send({ error: "project_role_forbidden" });
  }
  throw error;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toProjectSettingsResponse(
  project: NonNullable<Awaited<ReturnType<TraceStore["getProject"]>>>,
  role: NonNullable<Awaited<ReturnType<TraceStore["getProjectMembership"]>>>["role"],
) {
  return {
    projectId: project.projectId,
    name: project.name,
    allowedDomains: project.allowedDomains,
    role,
  };
}

type ProjectMemberResponse = {
  adminUserId: string;
  email: string;
  name?: string;
  role: AdminRole;
  createdAt: string;
};

type ProjectMemberCandidateResponse = {
  adminUserId: string;
  email: string;
  name?: string;
  membership?: { role: AdminRole };
};

type ProjectAuditLogActorResponse = {
  adminUserId: string;
  email?: string;
  name?: string;
};

type ProjectAuditLogEntryResponse = {
  auditLogId: string;
  action: string;
  createdAt: string;
  actor?: ProjectAuditLogActorResponse;
  metadata: Record<string, unknown>;
};

function toProjectMemberResponse(
  membership: ProjectMembershipRecord,
  user: AdminUserRecord | undefined,
): ProjectMemberResponse | undefined {
  if (!user) return undefined;
  const response: ProjectMemberResponse = {
    adminUserId: membership.adminUserId,
    email: user.email,
    role: membership.role,
    createdAt: membership.createdAt,
  };
  if (user.name !== undefined) response.name = user.name;
  return response;
}

function encodeAuditLogCursor(entry: { createdAt: string; auditLogId: string }): string {
  return `${entry.createdAt}|${entry.auditLogId}`;
}

function parseAuditLogCursor(
  cursor: string,
): { createdAt: string; auditLogId: string } | undefined {
  const separator = cursor.indexOf("|");
  if (separator <= 0 || separator === cursor.length - 1) return undefined;

  const createdAt = cursor.slice(0, separator);
  const auditLogId = cursor.slice(separator + 1);
  if (Number.isNaN(Date.parse(createdAt))) return undefined;

  return { createdAt, auditLogId };
}

async function resolveAuditLogActors(
  store: TraceStore,
  rows: Array<{ adminUserId?: string }>,
): Promise<Map<string, ProjectAuditLogActorResponse>> {
  const distinct = [...new Set(
    rows
      .map((row) => row.adminUserId)
      .filter((adminUserId): adminUserId is string => adminUserId !== undefined),
  )];

  const resolved = await Promise.all(
    distinct.map(async (adminUserId) => {
      const user = await store.getAdminUser(adminUserId);
      const actor: ProjectAuditLogActorResponse = { adminUserId };
      if (user !== undefined) {
        actor.email = user.email;
        if (user.name !== undefined) actor.name = user.name;
      }
      return [adminUserId, actor] as const;
    }),
  );

  return new Map(resolved);
}
