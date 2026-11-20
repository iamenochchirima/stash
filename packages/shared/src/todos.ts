import { z } from "zod";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;},{message:"Enter a real calendar date."});
const timezone = z.string().trim().min(1).max(100);
const resourceIds = z.array(z.string().uuid()).max(50).default([]);
export const todoState = z.enum(["todo", "in_progress", "done"]);
export const todoPriority = z.enum(["low", "normal", "high"]);
export const todoListInput = z.object({
  name: z.string().trim().min(1).max(100),
  projectId: z.string().uuid().nullable().default(null),
});
export const todoListUpdate = z.object({ name: z.string().trim().min(1).max(100), revision: z.number().int().positive() });
export const todoCreateInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).default(""),
  projectId: z.string().uuid().nullable().default(null),
  listId: z.string().uuid().nullable().default(null),
  priority: todoPriority.default("normal"),
  plannedDate: localDate.nullable().default(null),
  deadlineDate: localDate.nullable().default(null),
  deadlineAt: z.string().datetime({ offset: true }).nullable().default(null),
  timezone: timezone.optional(),
  sourceIds: resourceIds,
  requestId: z.string().uuid(),
}).superRefine((value, ctx) => {
  if (value.deadlineDate && value.deadlineAt) ctx.addIssue({ code: "custom", path: ["deadlineAt"], message: "Choose a date-only deadline or a timed deadline." });
});
export const todoUpdateInput = z.object({
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  projectId: z.string().uuid().nullable().optional(),
  listId: z.string().uuid().nullable().optional(),
  state: todoState.optional(),
  priority: todoPriority.optional(),
  plannedDate: localDate.nullable().optional(),
  deadlineDate: localDate.nullable().optional(),
  deadlineAt: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: timezone.optional(),
  position: z.number().int().min(0).optional(),
}).superRefine((value, ctx) => {
  if (value.deadlineDate && value.deadlineAt) ctx.addIssue({ code: "custom", path: ["deadlineAt"], message: "Choose a date-only deadline or a timed deadline." });
});
export const todoListQuery = z.object({
  view: z.enum(["inbox", "all", "today", "upcoming", "completed", "trash"]).default("all"),
  q: z.string().trim().max(200).default(""),
  projectId: z.string().uuid().optional(),
  listId: z.string().uuid().optional(),
  state: todoState.optional(),
  priority: todoPriority.optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const todoSubtaskInput = z.object({ title: z.string().trim().min(1).max(200) });
export const todoSubtaskUpdate = z.object({ revision: z.number().int().positive(), title: z.string().trim().min(1).max(200).optional(), completed: z.boolean().optional(), position: z.number().int().min(0).optional() }).refine(v => v.title !== undefined || v.completed !== undefined || v.position !== undefined);
export const todoReferenceInput = z.object({ sourceIds: resourceIds });
export const todoMoveInput = z.object({ revision: z.number().int().positive(), projectId: z.string().uuid().nullable(), listId: z.string().uuid().nullable() });
export const todoDeleteInput = z.object({ revision: z.number().int().positive(), confirmation: z.literal("DELETE") });
export const todoPreferencesInput = z.object({ timezone });

export type TodoState = z.infer<typeof todoState>;
export type TodoPriority = z.infer<typeof todoPriority>;
export type TodoPreferences = { timezone: string; emailReminders: boolean; inAppReminders: boolean; configured: boolean };
export type Todo = {
  id: string; userId: string; projectId: string | null; listId: string | null; recurrenceId: string | null;
  title: string; description: string; state: TodoState; priority: TodoPriority; plannedDate: string | null; deadlineDate: string | null;
  deadlineAt: string | null; timezone: string; completedAt: string | null; trashedAt: string | null; position: number; revision: number;
  createdAt: string; updatedAt: string; subtasks: { id: string; title: string; completedAt: string | null; position: number; revision: number }[];
  sources: { id: string; resourceId: string | null; title: string | null; kind: string | null; url: string | null; projectId: string | null }[];
};
