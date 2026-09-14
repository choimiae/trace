import { z } from "zod";
import { replayConfigSchema } from "@trace/shared";

export const projectSettingsSchema = z.object({
  name: z.string().trim().min(1),
  allowedDomains: z.array(z.string().url()).min(1).transform((domains) => Array.from(new Set(
    domains.map((domain) => new URL(domain).origin),
  ))),
  // 생략 가능하다. 넘기지 않은 요청은 저장된 설정을 그대로 둔다(store 계약).
  replay: replayConfigSchema.optional(),
});

// 생성 시점에는 replay 를 받지 않는다. 새 프로젝트는 항상 기본 꺼짐으로
// 시작한다(Task 2 의 store 계약). 리플레이를 켜는 것은 프로젝트 설정(PATCH)
// 경로의 일이므로, 생성 라우트가 지킬 수 없는 필드를 검증하게 두지 않는다.
export const createProjectSchema = projectSettingsSchema.omit({ replay: true });
export const updateProjectSchema = projectSettingsSchema;

export const addProjectMemberSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  role: z.enum(["admin", "viewer"]),
});

export const updateProjectMemberRoleSchema = z.object({
  role: z.enum(["owner", "admin", "viewer"]),
});

export const memberCandidateSearchSchema = z.object({
  query: z.string().trim().default(""),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
