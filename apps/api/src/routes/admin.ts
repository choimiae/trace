import { z } from "zod";

export const projectSettingsSchema = z.object({
  name: z.string().trim().min(1),
  allowedDomains: z.array(z.string().url()).min(1).transform((domains) => Array.from(new Set(
    domains.map((domain) => new URL(domain).origin),
  ))),
});

export const createProjectSchema = projectSettingsSchema;
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
