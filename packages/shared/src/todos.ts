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
  sort: z.enum(["due", "manual"]).default("due"),
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
export const todoReorderInput = z.object({
  tasks: z.array(z.object({ id:z.string().uuid(),revision:z.number().int().positive(),position:z.number().int().min(0) })).length(2),
  requestId:z.string().uuid(),
}).refine(value=>new Set(value.tasks.map(task=>task.id)).size===2,{path:["tasks"],message:"Choose two different tasks."});
export const todoRecurrenceRule = z.object({
  frequency:z.enum(["daily","weekly","monthly"]),
  interval:z.number().int().min(1).max(365),
  weekdays:z.array(z.number().int().min(0).max(6)).max(7).optional(),
}).superRefine((value,ctx)=>{
  if(new Set(value.weekdays||[]).size!==(value.weekdays||[]).length)ctx.addIssue({code:"custom",path:["weekdays"],message:"Choose each weekday only once."});
  if(value.frequency!=="weekly"&&value.weekdays?.length)ctx.addIssue({code:"custom",path:["weekdays"],message:"Weekdays apply to weekly recurrence only."});
});
export const todoRecurrenceInput = z.object({
  revision:z.number().int().positive(),
  requestId:z.string().uuid(),
  rule:todoRecurrenceRule,
  timezone,
  anchorDate:localDate.optional(),
  localTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  endsOn:localDate.nullable().optional(),
  count:z.number().int().positive().max(10000).nullable().optional(),
}).refine(value=>!value.anchorDate||!value.endsOn||value.endsOn>=value.anchorDate,{path:["endsOn"],message:"Choose an end date on or after the first occurrence."});
export const todoRecurrenceStopInput=z.object({revision:z.number().int().positive(),requestId:z.string().uuid()});
export const todoBulkInput = z.object({
  action: z.enum(["complete", "move", "trash"]),
  tasks: z.array(z.object({ id: z.string().uuid(), revision: z.number().int().positive() })).min(1).max(100),
  requestId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  listId: z.string().uuid().nullable().optional(),
  subtasks: z.enum(["parent_only", "complete_all"]).optional(),
}).superRefine((value,ctx)=>{
  if(new Set(value.tasks.map(task=>task.id)).size!==value.tasks.length)ctx.addIssue({code:"custom",path:["tasks"],message:"Choose each task only once."});
  if(value.action==="move"&&(value.projectId===undefined||value.listId===undefined))ctx.addIssue({code:"custom",path:["projectId"],message:"Choose a destination workspace and list."});
  if(value.action!=="move"&&(value.projectId!==undefined||value.listId!==undefined))ctx.addIssue({code:"custom",path:["projectId"],message:"Only move actions can include a destination."});
  if(value.action!=="complete"&&value.subtasks!==undefined)ctx.addIssue({code:"custom",path:["subtasks"],message:"Only complete actions can include subtask behavior."});
});
export const todoDeleteInput = z.object({ revision: z.number().int().positive(), confirmation: z.literal("DELETE") });
export const todoPreferencesInput = z.object({ timezone, emailReminders:z.boolean().optional(), inAppReminders:z.boolean().optional() });
export const todoReminderScheduleInput=z.object({requestId:z.string().uuid(),scheduledAt:z.string().datetime({offset:true}),channels:z.array(z.enum(["in_app","email"])).min(1).max(2)}).refine(value=>new Set(value.channels).size===value.channels.length,{path:["channels"],message:"Choose each reminder channel once."});
export const todoReminderActionInput=z.discriminatedUnion("action",[
  z.object({action:z.literal("read")}),
  z.object({action:z.literal("dismiss")}),
  z.object({action:z.literal("snooze"),scheduledAt:z.string().datetime({offset:true})}),
]);

export type TodoState = z.infer<typeof todoState>;
export type TodoPriority = z.infer<typeof todoPriority>;
export type TodoPreferences = { timezone: string; emailReminders: boolean; inAppReminders: boolean; emailVerified?:boolean; emailConfigured?:boolean; configured: boolean };
export type Todo = {
  id: string; userId: string; projectId: string | null; listId: string | null; recurrenceId: string | null;
  title: string; description: string; state: TodoState; priority: TodoPriority; plannedDate: string | null; deadlineDate: string | null;
  deadlineAt: string | null; timezone: string; completedAt: string | null; trashedAt: string | null; position: number; revision: number;
  createdAt: string; updatedAt: string; subtasks: { id: string; title: string; completedAt: string | null; position: number; revision: number }[];
  sources: { id: string; resourceId: string | null; title: string | null; kind: string | null; url: string | null; projectId: string | null }[];
};
