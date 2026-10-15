// Synthetic originals and disposable PostgreSQL schemas only. Never print SDK/request errors.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fixture } from "../tests/helpers.js";
import { pdf } from "../tests/pdf-fixture.js";
import { backblazeFileStore } from "../apps/server/src/file-store.js";
import { processPdfJob } from "../apps/server/src/pdf-worker.js";
import { createBackupExport } from "../apps/server/src/backup-export.js";
import { openBackup,type OpenBackup } from "../apps/web/lib/backups/archive.js";
const evidence:Record<string,unknown>={checkedAt:new Date().toISOString(),provider:"Backblaze B2",fixture:"Synthetic PDF, two disposable accounts and a disposable PostgreSQL schema"};
const store=backblazeFileStore({endpoint:process.env.B2_ENDPOINT!,region:process.env.B2_REGION!,bucket:process.env.B2_BUCKET!,keyId:process.env.B2_KEY_ID!,applicationKey:process.env.B2_APPLICATION_KEY!}),keys=new Set<string>();
const tracked={...store,async put(key:string,bytes:Buffer){keys.add(key);await store.put(key,bytes);}};
let f:Awaited<ReturnType<typeof fixture>>|undefined,backup:OpenBackup|undefined;
function requireResult(ok:unknown){if(!ok)throw new Error("BackupAcceptanceFailed");}
try{
 f=await fixture({fileStore:tracked});const a=await f.signup(),b=await f.signup(),bytes=pdf("Synthetic original survives a full Backblaze backup and restore.");
 const ticketResponse=await f.request("POST","/api/items/uploads",{filename:"Synthetic.pdf",byteSize:bytes.length},a.cookie);requireResult(ticketResponse.statusCode===200);const ticket=ticketResponse.json();
 const saved=await f.request("POST",`/uploads/${ticket.id}`,bytes,undefined,{authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"});requireResult(saved.statusCode===200);await processPdfJob(f.db,tracked);
 const exported=await createBackupExport(f.db,a.user.id,tracked),chunks:Buffer[]=[];for await(const part of exported.stream)chunks.push(Buffer.from(part));backup=await openBackup(new Blob([Buffer.concat(chunks)]));
 requireResult(backup.manifest.items.length===1);const ref=backup.manifest.items[0];requireResult(Buffer.from(await backup.readOriginal(ref.id)).equals(bytes));evidence.exportOriginalMatches=true;
 const transferResponse=await f.request("POST","/api/backups/restore",{manifestHash:createHash("sha256").update(backup.manifestBytes).digest("hex")},b.cookie);requireResult(transferResponse.statusCode===200);const transfer=transferResponse.json(),headers={authorization:`Bearer ${transfer.token}`,"content-type":"application/vnd.stash.backup+json"};
 requireResult((await f.request("POST","/backup-transfers/restore/manifest",Buffer.from(backup.manifestBytes),undefined,headers)).statusCode===200);
 const metadata=await backup.readItem(ref.id),restored=await f.request("POST",`/backup-transfers/restore/items/${ref.id}`,Buffer.from(metadata.bytes),undefined,headers);requireResult(restored.statusCode===200);const restoredId=restored.json().id;
 const permission=await f.request("POST",`/backup-transfers/restore/originals/${ref.id}`,{},undefined,{authorization:headers.authorization});requireResult(permission.statusCode===200);const originalTicket=permission.json();
 requireResult((await f.request("POST",new URL(originalTicket.uploadUrl).pathname,Buffer.from(await backup.readOriginal(ref.id)),undefined,{authorization:`Bearer ${originalTicket.token}`,"content-type":"application/pdf"})).statusCode===200);
 await processPdfJob(f.db,tracked);
 const pages=(await f.request("GET",`/api/items/${restoredId}/pages`,undefined,b.cookie)).json();requireResult(pages.state==="ready"&&pages.pages[0].text.includes("Synthetic original survives"));evidence.restoredTextMatches=true;
 const grant=(await f.request("POST",`/api/items/${restoredId}/download`,{},b.cookie)).json(),download=await f.request("GET",new URL(grant.downloadUrl).pathname,undefined,undefined,{authorization:`Bearer ${grant.token}`});requireResult(download.statusCode===200&&download.rawPayload.equals(bytes));evidence.restoredOriginalMatches=true;
 requireResult((await f.request("GET",`/api/items/${restoredId}`,undefined,a.cookie)).statusCode===404);evidence.accountIsolation=true;
 requireResult((await f.request("POST","/backup-transfers/restore/finish",{},undefined,{authorization:headers.authorization})).statusCode===200);
 for(const account of[a,b])requireResult((await f.request("DELETE","/api/me",{password:"correct horse battery staple",confirmation:"DELETE"},account.cookie)).statusCode===200);
 evidence.accountsDeleted=true;evidence.passed=true;
}catch(error){evidence.passed=false;evidence.errorType=error instanceof Error?error.name:"AcceptanceFailed";}
finally{
 try{await backup?.close();await f?.close();}catch{evidence.passed=false;evidence.localCleanup="retry_required";}let cleaned=0;for(const key of keys)try{await store.remove(key);cleaned++;}catch{evidence.passed=false;}
 evidence.originalsWritten=keys.size;evidence.originalsRemoved=cleaned;evidence.allVersionsCleanup=cleaned===keys.size;
}
await writeFile("docs/evidence/library-v2/backblaze-backup-restore.json",JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify(evidence));if(!evidence.passed)process.exitCode=1;
