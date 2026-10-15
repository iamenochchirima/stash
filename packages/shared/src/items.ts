import { z } from "zod";
const httpUrl = z.string().trim().url().max(2048).refine(value => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Use an HTTP or HTTPS URL without credentials.");
const common = {
  projectId: z.string().uuid().optional(),
  title: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(10000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  collectionIds: z.array(z.string().uuid()).max(20).default([]),
  requestId: z.string().uuid().optional(),
};
export const itemInput = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("link"), url: httpUrl, status: z.enum(["unread", "reading", "done"]).default("unread") }),
  z.object({ ...common, kind: z.literal("note"), body: z.string().trim().min(1).max(500000) }),
  z.object({ ...common, kind: z.literal("idea"), body: z.string().trim().min(1).max(500000) }),
  z.object({ ...common, kind: z.literal("pdf"), attachmentId: z.string().uuid(), status: z.enum(["unread", "reading", "done"]).default("unread") }),
]);
export const itemUpdate = z.object({
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(10000).optional(),
  body: z.string().trim().min(1).max(500000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  collectionIds: z.array(z.string().uuid()).max(20).optional(),
  status: z.enum(["unread", "reading", "done"]).optional(),
  favourite: z.boolean().optional(),
});
export const itemListInput = z.object({
  projectId: z.string().uuid().optional(),
  includeProjects: z.enum(["true", "false"]).optional(),
  q: z.string().max(200).default(""),
  collectionId: z.string().uuid().optional(),
  kind: z.enum(["link", "note", "idea", "pdf"]).optional(),
  status: z.enum(["unread", "reading", "done"]).optional(),
  favourite: z.enum(["true", "false"]).optional(),
  location: z.enum(["library", "archive", "trash"]).default("library"),
  includeArchived: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export type ItemInput = z.infer<typeof itemInput>;
export type ItemUpdate = z.infer<typeof itemUpdate>;
export type ItemListInput = z.infer<typeof itemListInput>;
export type Item = {
  pdf?: { hasOriginal: boolean; filename: string; byteSize: number; state: "pending" | "uploading" | "queued" | "processing" | "ready" | "failed" | "missing"; pageCount: number | null; errorCode: string | null } | null;
  projectId: string | null; projectSourceId: string | null;
  id: string; kind: "link" | "note" | "idea" | "pdf"; url: string | null;
  title: string; body: string; notes: string; tags: string[]; collectionIds: string[];
  description: string; status: "unread" | "reading" | "done"; sourceAgent: string;
  metadataStatus: "manual" | "extracted" | "unavailable";
  sourceRevision: number; revision: number; favourite: boolean; archivedAt: string | null; deletedAt: string | null;
  createdAt: string; updatedAt: string;
};
