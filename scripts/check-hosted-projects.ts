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
 const a=await signup('project-a'),page=await a.newPage();
 await page.goto(web);await page.getByRole('link',{name:'Projects',exact:true}).click();await page.getByRole('button',{name:'New project',exact:true}).click();await page.getByLabel('Project name',{exact:true}).fill('Hosted research project');await page.getByRole('button',{name:'Create project',exact:true}).click();await expect(page.getByRole('heading',{name:'Hosted research project',exact:true})).toBeVisible();
 const project=(await json(await a.request.get(`${web}/api/projects`))).items[0];
 const body='## Synthetic research\n\n'+'Research notes remain separate from the library. '.repeat(1200);
 const item=(await json(await a.request.post(`${web}/api/items`,{headers,data:{kind:'note',projectId:project.id,title:'Hosted working document',body}}))).item;
 expect((await json(await a.request.get(`${web}/api/items`))).total).toBe(0);expect((await json(await a.request.get(`${web}/api/items?projectId=${project.id}`))).total).toBe(1);report.projectScope=true;
 await page.reload();await page.getByRole('heading',{name:'Hosted working document',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic research',exact:true})).toBeVisible();report.longDocumentReading=true;
 const appended=await json(await a.request.post(`${web}/api/items/${item.id}/append`,{headers,data:{revision:item.revision,requestId:randomUUID(),body:'A later synthetic finding.'}}));
 const history=await json(await a.request.get(`${web}/api/items/${item.id}/history`));expect(history.items.length).toBeGreaterThan(0);report.appendAndHistory=true;
 const promoted=await json(await a.request.post(`${web}/api/items/${item.id}/promote`,{headers,data:{requestId:randomUUID(),body:'A useful synthetic excerpt.'}}));expect((await json(await a.request.get(`${web}/api/items`))).total).toBe(1);report.explicitPromotion=true;
 const b=await signup('project-b');expect((await b.request.get(`${web}/api/projects/${project.id}`)).status()).toBe(404);expect((await b.request.get(`${web}/api/items/${item.id}`)).status()).toBe(404);report.accountIsolation=true;
 const current=(await json(await a.request.get(`${web}/api/projects/${project.id}`))).project;
 await json(await a.request.patch(`${web}/api/projects/${project.id}`,{headers,data:{revision:current.revision,archived:true}}));expect((await a.request.post(`${web}/api/items`,{headers,data:{kind:'idea',projectId:project.id,body:'Should remain read-only'}})).status()).toBe(409);report.archivedReadOnly=true;
 await page.setViewportSize({width:375,height:1000});await page.reload();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/evidence/library-v2/hosted-project-mobile.png',fullPage:false});report.passed=true;

}catch(error){report.failedAt=error instanceof Error?error.message.split('\n')[0].replace(/https?:\/\/\S+/g,'[URL]').slice(0,200):'Acceptance failed';process.exitCode=1;}
finally{
 for(const client of clients)await client.close().catch(()=>{});
 const removed=[];for(const customer of customers){try{const response=await customer.context.request.delete(`${web}/api/me`,{headers,data:{password,confirmation:'DELETE'}});removed.push(response.status()===200);}catch{removed.push(false);}}
 report.disposableAccountsDeleted=removed.length===customers.length&&removed.every(Boolean);report.accountIdsForCleanup=customers.map(c=>c.id);if(!report.disposableAccountsDeleted){report.passed=false;process.exitCode=1;}
 for(const context of contexts)await context.close();await browser.close();await mkdir('docs/evidence/library-v2',{recursive:true});await writeFile('docs/evidence/library-v2/hosted-projects.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}
