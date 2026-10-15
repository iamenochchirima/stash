// Explicit hosted acceptance. Only labelled Resend test recipients and synthetic content.
import { chromium, expect, type BrowserContext } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { pdf } from '../tests/pdf-fixture.js';
import { openBackup } from '../apps/web/lib/backups/archive.js';
if(process.env.STASH_HOSTED_ACCEPTANCE!=='true')throw Error('Explicit hosted acceptance flag required');
const web='https://stash.kasitek.co.za',api='https://api.stash.kasitek.co.za',headers={origin:web};
const password=randomBytes(24).toString('base64url'),label=randomUUID(),report:Record<string,unknown>={checkedAt:new Date().toISOString(),fixture:'Synthetic content and labelled Resend test recipients',passed:false};
const privateEnv=JSON.parse(execFileSync('railway',['variable','list','--service','stash-api','--json'],{encoding:'utf8'}));
const browser=await chromium.launch(),contexts:BrowserContext[]=[],customers:{context:BrowserContext,id:string}[]=[],clients:Client[]=[];
async function json(response:any,status=200){if(response.status()!==status)throw Error(`HTTP ${response.status()} expected ${status} at ${new URL(response.url()).pathname}`);return response.json();}
async function signup(suffix:string){
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);
 const email=`delivered+stash-${label}-${suffix}@resend.dev`;
 const result=await json(await context.request.post(`${web}/api/auth/signup`,{headers,data:{name:'Hosted acceptance',email,password}}),201);customers.push({context,id:result.user.id});expect(result.emailSent).toBe(true);
 let token:string|undefined;
 for(let attempt=0;attempt<15&&!token;attempt++){
  const list=await fetch('https://api.resend.com/emails',{headers:{authorization:`Bearer ${privateEnv.RESEND_API_KEY}`}});if(!list.ok)throw Error('Cannot inspect acceptance email');
  const messages=await list.json() as any,match=messages.data?.find((m:any)=>m.to?.includes(email)&&m.subject==='Verify your Stash email');
  if(match){const response=await fetch(`https://api.resend.com/emails/${match.id}`,{headers:{authorization:`Bearer ${privateEnv.RESEND_API_KEY}`}});if(!response.ok)throw Error('Cannot read acceptance email');const mail=await response.json() as any;token=mail.text?.match(/[?&]verify=([A-Za-z0-9_-]+)/)?.[1];}
  if(!token)await new Promise(resolve=>setTimeout(resolve,1500));
 }
 if(!token)throw Error('Acceptance verification email unavailable');
 await json(await context.request.post(`${web}/api/auth/verify`,{headers,data:{token}}));
 return context;
}
try{
 const a=await signup('a'),page=await a.newPage();report.emailVerification=true;
 const created=[];
 for(const input of [{kind:'link',url:'https://example.com/stash-hosted-acceptance',title:'Hosted saved link',notes:'Synthetic source for acceptance.'},{kind:'note',title:'Hosted note',body:'Synthetic notes stay readable without a URL.'},{kind:'idea',title:'Hosted idea',body:'A quiet reading list for research.'}]){
  const result=await json(await a.request.post(`${web}/api/items`,{headers,data:input}));created.push(result.item);
 }
 report.mixedCapture=true;
 await page.goto(web);await page.getByRole('link',{name:'Hosted idea',exact:true}).click();await expect(page).toHaveURL(url=>url.pathname===`/items/${created[2].id}`);await expect(page.getByText('A quiet reading list for research.',{exact:true})).toBeVisible();report.cardNavigation=true;
 const bytes=pdf('Synthetic trial: paper filters removed 82 percent of sediment; cloth filters removed 61 percent. This trial does not establish drinking-water safety.');
 const ticket=await json(await a.request.post(`${web}/api/items/uploads`,{headers,data:{filename:'Hosted research.pdf',title:'Hosted PDF',byteSize:bytes.length}}));
 const original=(await json(await a.request.post(ticket.uploadUrl,{headers:{...headers,authorization:`Bearer ${ticket.token}`,'content-type':'application/pdf'},data:bytes}))).item;
 await expect.poll(async()=>(await json(await a.request.get(`${web}/api/items/${original.id}/pages`))).state,{timeout:90000}).toBe('ready');report.searchableExtraction=(await json(await a.request.get(`${web}/api/items?q=sediment`))).total===1;expect(report.searchableExtraction).toBe(true);
 const grant=await json(await a.request.post(`${web}/api/items/${original.id}/download`,{headers,data:{}}));const download=await a.request.get(grant.downloadUrl,{headers:{...headers,authorization:`Bearer ${grant.token}`}});expect((await download.body()).equals(bytes)).toBe(true);report.originalBytesMatch=true;
 await page.goto(`${web}/items/${original.id}`);const summary=page.getByRole('region',{name:'AI summary'});await expect(summary.getByRole('button',{name:'Summarise',exact:true})).toBeEnabled({timeout:30000});await summary.getByRole('button',{name:'Summarise',exact:true}).click();
 await expect.poll(async()=>(await json(await a.request.get(`${web}/api/items/${original.id}/summary`))).job?.state,{timeout:120000}).toBe('succeeded');await expect(summary.getByRole('button',{name:'Regenerate',exact:true})).toBeVisible();report.realSummary=true;
 await page.screenshot({path:'docs/evidence/library-v2/hosted-pdf-summary.png',fullPage:true});
 const key=await json(await a.request.post(`${web}/api/keys`,{headers,data:{name:'Hosted acceptance reader',scope:'read'}}));const client=new Client({name:'Hosted library acceptance',version:'1'});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(`${api}/mcp`),{requestInit:{headers:{authorization:`Bearer ${key.token}`}}}));const found:any=await client.callTool({name:'get_item',arguments:{id:created[2].id}});expect(JSON.parse(found.content[0].text).data.body).toBe('A quiet reading list for research.');report.hostedMcpRetrieval=true;
 for(const action of ['archive','unarchive','trash','restore'])await json(await a.request.post(`${web}/api/items/${created[1].id}/lifecycle`,{headers,data:{action}}));report.lifecycle=true;
 await page.goto(web);await page.getByRole('button',{name:'Import / export',exact:true}).click();const dialog=page.getByRole('dialog'),pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download full backup',exact:true}).click();const zip=await pending;expect(await zip.failure()).toBeNull();const archiveBytes=await readFile((await zip.path())!);const archive=await openBackup(new Blob([archiveBytes]));try{expect(archive.manifest.items.length).toBe(4);expect(Buffer.from(await archive.readOriginal(original.id)).equals(bytes)).toBe(true);}finally{await archive.close();}report.backupDownload=true;
 const b=await signup('b'),other=await b.newPage();expect((await b.request.get(`${web}/api/items/${original.id}`)).status()).toBe(404);report.accountIsolation=true;
 await other.goto(web);await other.getByRole('button',{name:'Import / export',exact:true}).click();const restore=other.getByRole('dialog');await restore.getByLabel('Choose an import file').setInputFiles({name:'stash-backup.zip',mimeType:'application/zip',buffer:archiveBytes});await restore.getByRole('button',{name:'Restore backup',exact:true}).click();await expect(restore.getByText(/4 restored, 0 existing, 1 original added/)).toBeVisible({timeout:90000});report.fullRestore=true;
 await restore.getByRole('button',{name:'Close dialog',exact:true}).click();await other.getByRole('link',{name:'Hosted PDF',exact:true}).click();await expect(other.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled({timeout:90000});
 const pdfDownload=other.waitForEvent('download');await other.getByRole('button',{name:'Download PDF',exact:true}).click();const restored=await pdfDownload;expect((await readFile((await restored.path())!)).equals(bytes)).toBe(true);report.restoredBytesMatch=true;
 await other.setViewportSize({width:375,height:1000});expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await other.screenshot({path:'docs/evidence/library-v2/hosted-restored-mobile.png',fullPage:true});
 const cachePaths=await other.evaluate(async()=>{const paths:string[]=[];for(const key of await caches.keys())for(const request of await(await caches.open(key)).keys())paths.push(new URL(request.url).pathname);return paths;});expect(cachePaths.every(path=>path==='/offline.html'||path.startsWith('/icons/'))).toBe(true);report.privateCachesEmpty=true;
 report.passed=true;
}catch(error){report.failedAt=error instanceof Error?error.message.split('\n')[0].replace(/https?:\/\/\S+/g,'[URL]').slice(0,200):'Acceptance failed';process.exitCode=1;}
finally{
 for(const client of clients)await client.close().catch(()=>{});
 const removed=[];for(const customer of customers){try{const response=await customer.context.request.delete(`${web}/api/me`,{headers,data:{password,confirmation:'DELETE'}});removed.push(response.status()===200);}catch{removed.push(false);}}
 report.disposableAccountsDeleted=removed.length===customers.length&&removed.every(Boolean);report.accountIdsForCleanup=customers.map(c=>c.id);if(!report.disposableAccountsDeleted){report.passed=false;process.exitCode=1;}
 for(const context of contexts)await context.close();await browser.close();await mkdir('docs/evidence/library-v2',{recursive:true});await writeFile('docs/evidence/library-v2/hosted-library.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
