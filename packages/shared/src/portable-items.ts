import { z } from "zod";
import { summaryResult } from "./summaries";
import { normalizeTopicName, topicInput } from "./topics";
const text = (max:number) => z.string().max(max);
function hasNull(value:unknown):boolean { return typeof value==="string" ? value.includes("\u0000") : Array.isArray(value) ? value.some(hasNull) : !!value && typeof value==="object" ? Object.values(value).some(hasNull) : false; }
const httpUrl=text(2048).url().refine(value=>{const url=new URL(value);return["http:","https:"].includes(url.protocol)&&!url.username&&!url.password;},"Use an HTTP or HTTPS URL without credentials.");
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const portablePdf=z.object({
 filename:text(200).min(1).refine(v=>/\.pdf$/i.test(v)&&!/[\x00-\x1f/\\]/.test(v),"Invalid PDF filename"),byteSize:z.number().int().min(1).max(20971520),sha256:hash.nullable().default(null),
 state:z.enum(["queued","processing","ready","failed","missing"]),pages:z.array(z.object({page:z.number().int().min(1).max(100),text:text(250000)}).strict()).max(100),pageCount:z.number().int().min(1).max(100).nullable(),parserVersion:text(100).nullable().default(null),errorCode:z.string().regex(/^[a-z0-9_]{1,80}$/).nullable().default(null),
}).strict().superRefine((pdf,ctx)=>{
 if(pdf.pages.reduce((n,p)=>n+p.text.length,0)>250000)ctx.addIssue({code:"custom",message:"PDF text exceeds the extraction limit"});
 if(pdf.pages.some((p,i)=>p.page!==i+1)||pdf.pages.length&&(pdf.pageCount!==pdf.pages.length))ctx.addIssue({code:"custom",message:"PDF page references are inconsistent"});
});
export const portableSummary=z.object({
 sourceRevision:z.number().int().min(1).max(1000000000),sourceHash:hash,
 snapshot:z.object({kind:z.enum(["link","pdf"]),url:httpUrl.optional(),sources:z.array(z.object({id:z.string().regex(/^s[1-9][0-9]?$/),label:text(100).min(1),text:text(12000).min(1),page:z.number().int().min(1).max(100).optional()}).strict()).min(1).max(40),partial:z.boolean(),totalCharacters:z.number().int().min(1).max(1000000),includedCharacters:z.number().int().min(1).max(12000)}).strict(),
 result:summaryResult,model:text(200).min(1),promptVersion:text(100).min(1),createdAt:z.string().datetime(),
}).strict().superRefine((summary,ctx)=>{
 const snapshot=summary.snapshot,ids=new Set(snapshot.sources.map(s=>s.id));
 if(ids.size!==snapshot.sources.length||snapshot.sources.reduce((n,s)=>n+s.text.length,0)!==snapshot.includedCharacters||snapshot.includedCharacters>snapshot.totalCharacters||!snapshot.partial&&snapshot.includedCharacters!==snapshot.totalCharacters)ctx.addIssue({code:"custom",message:"Summary source coverage is inconsistent"});
 const normal=(s:string)=>s.replace(/\s+/g," ").trim();
 for(const claim of[summary.result.overview,...summary.result.points])if(new Set(claim.sourceIds).size!==claim.sourceIds.length||claim.sourceIds.some(id=>!ids.has(id))||!snapshot.sources.some(s=>claim.sourceIds.includes(s.id)&&normal(s.text).includes(normal(claim.quote))))ctx.addIssue({code:"custom",message:"Summary references do not match the saved source"});
 if(snapshot.kind==="pdf"&&snapshot.sources.some(s=>!s.page))ctx.addIssue({code:"custom",message:"PDF summary references need page numbers"});
});
export const portableItem=z.object({
 projectId:z.string().uuid().nullable().optional(),projectSourceId:z.string().uuid().nullable().optional(),revision:z.number().int().positive().default(1),
 history:z.array(z.object({revision:z.number().int().positive(),body:text(500000),actor:text(80),createdAt:z.string().datetime()}).strict()).max(20).default([]),
 id:z.string().uuid().optional(),kind:z.enum(["link","note","idea","pdf"]),title:text(200).default(""),url:httpUrl.nullable().optional(),body:text(500000).default(""),notes:text(10000).default(""),tags:z.array(text(40).trim().min(1)).max(20).default([]),collections:z.array(text(80).trim().min(1)).max(20).default([]),topics:z.array(topicInput.shape.name).max(20).default([]),
 status:z.enum(["unread","reading","done"]).default("unread"),favourite:z.boolean().default(false),archivedAt:z.string().datetime().nullable().default(null),deletedAt:z.string().datetime().nullable().default(null),createdAt:z.string().datetime().optional(),updatedAt:z.string().datetime().optional(),sourceAgent:text(80).default("import"),description:text(1000).default(""),metadataStatus:z.enum(["manual","extracted","unavailable"]).default("manual"),sourceRevision:z.number().int().min(1).max(1000000000).default(1),
 pdf:portablePdf.nullable().optional(),summary:portableSummary.nullable().optional(),
}).strict().superRefine((item,ctx)=>{
 if(new Set(item.topics.map(normalizeTopicName)).size!==item.topics.length)ctx.addIssue({code:"custom",message:"Item contains duplicate topics"});
 if(item.history.length&&(!item.projectId||!["note","idea"].includes(item.kind)))ctx.addIssue({code:"custom",message:"Body history belongs to project notes and ideas"});
 if(new Set(item.history.map(h=>h.revision)).size!==item.history.length||item.history.some(h=>h.revision>=item.revision))ctx.addIssue({code:"custom",message:"Document history revisions are inconsistent"});
 if(item.projectId&&item.projectSourceId)ctx.addIssue({code:"custom",message:"Project-source references belong to library copies"});
 if(!item.projectId&&item.body.length>50000)ctx.addIssue({code:"custom",message:"Library notes support up to 50,000 characters"});
 if(item.projectId&&(item.collections.length||item.topics.length))ctx.addIssue({code:"custom",message:"Project items cannot belong to library collections or topics"});
 if(hasNull(item))ctx.addIssue({code:"custom",message:"Unsupported control character"});
 if(item.kind==="link"&&!item.url)ctx.addIssue({code:"custom",message:"Links need a source URL"});
 if(item.kind!=="link"&&item.url)ctx.addIssue({code:"custom",message:"Only links have a source URL"});
 if(["note","idea"].includes(item.kind)&&!item.body.trim())ctx.addIssue({code:"custom",message:"Notes and ideas need content"});
 if(item.kind==="pdf"&&!item.pdf)ctx.addIssue({code:"custom",message:"This export is missing PDF metadata. Use a full backup or a newer export."});
 if(item.kind!=="pdf"&&item.pdf)ctx.addIssue({code:"custom",message:"Only PDFs have file metadata"});
 if(item.summary&&(!["link","pdf"].includes(item.kind)||item.summary.snapshot.kind!==item.kind||item.summary.sourceRevision>item.sourceRevision))ctx.addIssue({code:"custom",message:"Summary does not match the item type or source revision"});
});
export type PortableItem=z.infer<typeof portableItem>;
