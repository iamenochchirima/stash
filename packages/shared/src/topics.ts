import { z } from "zod";

export const displayTopicName = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
export const normalizeTopicName = (value: string) => displayTopicName(value).toLowerCase();
const name = z.string().transform(displayTopicName).pipe(z.string().min(1).max(80).refine(value => !/[\x00-\x1f\x7f]/.test(value), "Use a topic name without control characters."));
export const topicInput = z.object({ name, description: z.string().trim().max(4000).default("") });
export const topicUpdate = z.object({ name: name.optional(), description: z.string().trim().max(4000).optional() }).refine(value => value.name !== undefined || value.description !== undefined, "Choose a name or description to update.");
export const topicListInput = z.object({ q: z.string().trim().max(200).default(""), limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(100000).default(0) });
export type Topic = { id: string; name: string; description: string; createdAt: string; updatedAt: string; itemCount: number };
