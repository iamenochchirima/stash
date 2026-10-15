import { api,ApiError } from "./api";
import { openBackup,sha256,type OpenBackup } from "./backup-archive";
const mime="application/vnd.stash.backup+json";
export async function prepareBackup(file:File,signal:AbortSignal,progress:(message:string)=>void){
 const archive=await openBackup(file,signal);let pdfs=0,missingOriginals=0;
 try{
  for(const[index,ref]of archive.manifest.items.entries()){
   progress(`Checking item ${index+1} of ${archive.manifest.items.length}…`);
   const{item}=await archive.readItem(ref.id);
   if(ref.original){await archive.readOriginal(ref.id);pdfs++;}else if(item.kind==="pdf")missingOriginals++;
  }
  return{archive,pdfs,missingOriginals};
 }catch(error){await archive.close();throw error;}
}
export async function restoreBackup(archive:OpenBackup,signal:AbortSignal,progress:(message:string)=>void){
 const ticket=await api<{token:string;restoreUrl:string}>("/backups/restore",{method:"POST",body:JSON.stringify({manifestHash:await sha256(archive.manifestBytes)}),signal});
 async function send<T>(path:string,body:BodyInit,type=mime):Promise<T>{
  const response=await fetch(ticket.restoreUrl+path,{method:"POST",headers:{Authorization:`Bearer ${ticket.token}`,"Content-Type":type},body,credentials:"omit",redirect:"error",cache:"no-store",signal});
  let result;try{result=await response.json();}catch{throw new Error("Restore interrupted. Choose the same backup to continue.");}
  if(!response.ok)throw new ApiError(result.error||"Could not restore this backup.",response.status);return result;
 }
 const blob=(value:Uint8Array)=>new Blob([value as Uint8Array<ArrayBuffer>]);
 await send("/manifest",blob(archive.manifestBytes));let saved=0,duplicates=0,originals=0;
 for(const[index,ref]of archive.manifest.items.entries()){
  progress(`Restoring item ${index+1} of ${archive.manifest.items.length}…`);
  const metadata=await archive.readItem(ref.id),result=await send<{duplicate:boolean}>(`/items/${ref.id}`,blob(metadata.bytes));
  if(result.duplicate)duplicates++;else saved++;
  if(ref.original){
   const grant=await send<{skipped?:boolean;token:string;uploadUrl:string}>(`/originals/${ref.id}`,"{}","application/json");
   if(!grant.skipped){
    const content=await archive.readOriginal(ref.id),response=await fetch(grant.uploadUrl,{method:"POST",headers:{Authorization:`Bearer ${grant.token}`,"Content-Type":"application/pdf"},body:blob(content),credentials:"omit",redirect:"error",signal});
    if(!response.ok){let message="Could not restore the PDF original. Choose the same backup to continue.";try{const result=await response.json();message=result.error||message;}catch{}throw new Error(message);}
    originals++;
   }
  }
 }
 await send("/finish","{}","application/json");return{saved,duplicates,originals};
}
