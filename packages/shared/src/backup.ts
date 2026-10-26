import { z } from "zod";
import { projectInput } from "./projects";
import { topicInput, normalizeTopicName } from "./topics";
export const BACKUP_LIMITS={manifestBytes:8*1024*1024,itemBytes:64*1024*1024,pdfBytes:20*1024*1024,entries:20001,archiveBytes:24*1024*1024*1024,uncompressedBytes:24*1024*1024*1024,directoryBytes:8*1024*1024} as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().uuid();
export const backupProject=projectInput.extend({id,archivedAt:z.string().datetime().nullable().default(null)}).strict();
export const portableTopic=topicInput.strict();
const manifestFields={
 format:z.literal("stash-backup"),exportedAt:z.string().datetime(),
 profile:z.object({name:z.string().max(100),email:z.string().email().max(254),bio:z.string().max(300),interests:z.array(z.string().max(40)).max(10)}).strict(),
 collections:z.array(z.object({name:z.string().min(1).max(80)}).strict()).max(100),projects:z.array(backupProject).max(100).default([]),
 items:z.array(z.object({id,path:z.string().max(80),sha256:hash,original:z.object({path:z.string().max(80),sha256:hash,byteSize:z.number().int().min(1).max(BACKUP_LIMITS.pdfBytes)}).strict().nullable().default(null)}).strict()).max(10000),
};
export const backupManifest=z.union([
 z.object({...manifestFields,version:z.literal(2)}).strict().transform(value=>({...value,topics:[] as z.infer<typeof portableTopic>[]})),
 z.object({...manifestFields,version:z.literal(3),topics:z.array(portableTopic).max(100)}).strict(),
]).superRefine((manifest,ctx)=>{
 if(manifest.collections.length+manifest.topics.length>100)ctx.addIssue({code:"custom",message:"Backup exceeds the combined collection and topic limit"});
 if(new Set(manifest.topics.map(t=>normalizeTopicName(t.name))).size!==manifest.topics.length)ctx.addIssue({code:"custom",message:"Backup contains duplicate topics"});
 const ids=new Set<string>();
 for(const row of manifest.items){if(ids.has(row.id)||row.path!==`items/${row.id}.json`||row.original&&row.original.path!==`originals/${row.id}.pdf`)ctx.addIssue({code:"custom",message:"Backup item paths or identities are inconsistent"});ids.add(row.id);}
 if(new Set(manifest.projects.map(p=>p.id)).size!==manifest.projects.length||new Set(manifest.collections.map(c=>c.name)).size!==manifest.collections.length)ctx.addIssue({code:"custom",message:"Backup contains duplicate projects or collections"});
});
export type BackupManifest=z.infer<typeof backupManifest>;
