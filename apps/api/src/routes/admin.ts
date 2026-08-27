import { z } from "zod";

export const projectSettingsSchema = z.object({
  name: z.string().trim().min(1),
  allowedDomains: z.array(z.string().url()).min(1).transform((domains) => Array.from(new Set(
    domains.map((domain) => new URL(domain).origin),
  ))),
});

export const createProjectSchema = projectSettingsSchema;
export const updateProjectSchema = projectSettingsSchema;
