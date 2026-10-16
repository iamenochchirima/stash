import { z } from "zod";
const repositoryUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => {
    const u = new URL(value);
    return (
      ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
    );
  }, "Use an HTTP or HTTPS repository URL.")
  .nullable()
  .optional();
export const projectInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(""),
  repositoryUrl,
});
export const projectUpdate = projectInput
  .partial()
  .extend({
    revision: z.number().int().positive(),
    archived: z.boolean().optional(),
  });
export type Project = {
  id: string;
  name: string;
  description: string;
  repositoryUrl: string | null;
  revision: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

export const projectDelete = z.object({
  revision: z.number().int().positive(),
  confirmation: z.literal("DELETE"),
});
export const projectItemMove = z.object({
  revision: z.number().int().positive(),
  projectId: z.string().uuid(),
});
export const projectDocumentRestore = z.object({
  revision: z.number().int().positive(),
  historicalRevision: z.number().int().positive(),
});
