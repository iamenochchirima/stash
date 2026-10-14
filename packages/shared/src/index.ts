import { z } from "zod";

export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128);
export const profileInput = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(300).default(""),
  interests: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});
export const signupInput = profileInput.extend({ email, password });
export const loginInput = z.object({
  email,
  password: z.string().min(1).max(128),
});
export const collectionInput = z.object({
  name: z.string().trim().min(1).max(80),
});
export const resourceInput = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((value) => {
      try {
        return ["https:", "http:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }, "Use an http or https URL.")
    .refine((value) => {
      try {
        const url = new URL(value);
        return !url.username && !url.password;
      } catch {
        return false;
      }
    }, "URLs cannot contain credentials."),
  title: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(10000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  collectionIds: z.array(z.string().uuid()).max(20).default([]),
  status: z.enum(["unread", "reading", "done"]).default("unread"),
});
export const resourceUpdate = resourceInput.omit({ url: true }).partial();
export const keyInput = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["read", "write"]).default("read"),
});
export const listInput = z.object({
  q: z.string().max(200).default(""),
  collectionId: z.string().uuid().optional(),
  status: z.enum(["unread", "reading", "done"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export type ResourceInput = z.infer<typeof resourceInput>;
export type ResourceUpdate = z.infer<typeof resourceUpdate>;
export type ListInput = z.infer<typeof listInput>;
export type Profile = {
  id: string;
  email: string;
  name: string;
  bio: string;
  interests: string[];
  emailVerified: boolean;
  emailEnabled: boolean;
  avatar: string | null;
  onboarding: {
    profile: boolean;
    saved: boolean;
    organized: boolean;
    connected: boolean;
    retrieved: boolean;
  };
};
export type Collection = { id: string; name: string };
export type Resource = {
  id: string;
  url: string;
  title: string;
  notes: string;
  tags: string[];
  collectionIds: string[];
  description: string;
  metadataStatus: "manual" | "extracted" | "unavailable";
  status: "unread" | "reading" | "done";
  sourceAgent: string;
  createdAt: string;
  updatedAt: string;
};
export type AgentKey = {
  authentication?: "key" | "oauth";
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  createdAt: string;
  lastUsedAt: string | null;
};

export const LIMITS = {
  sessionDays: 30,
  verifyMinutes: 1440,
  resetMinutes: 30,
  resources: 10000,
  collections: 100,
  keys: 20,
  importItems: 10000,
  importBytes: 134217728,
  avatarBytes: 2097152,
  avatarPixels: 16000000,
  metadataBytes: 524288,
  metadataMs: 5000,
  redirects: 3,
} as const;

export * from "./admin";
