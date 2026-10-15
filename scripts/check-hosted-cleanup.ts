// Read-only verification of deletion for accounts created by the hosted acceptance scripts.
import pg from 'pg';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));
const {S3Client,ListObjectVersionsCommand}=require('@aws-sdk/client-s3');
if(process.env.STASH_HOSTED_ACCEPTANCE!=='true')throw Error('Explicit hosted acceptance flag required');
const files=['hosted-library-first-run.json','hosted-library-origin-check.json','hosted-library.json','hosted-projects-first-run.json','hosted-projects.json'],ids:string[]=[];
for(const file of files){const report=JSON.parse(await readFile(new URL(`../docs/evidence/library-v2/${file}`,import.meta.url),'utf8'));ids.push(...report.accountIdsForCleanup);}
if(!ids.length||ids.some(id=>! /^[a-f0-9-]{36}$/.test(id)))throw Error('Invalid fixture references');
const variables=JSON.parse(execFileSync('railway',['variable','list','--service','Postgres','--json'],{encoding:'utf8'}));
const pool=new pg.Pool({host:'127.0.0.1',port:55439,database:variables.PGDATABASE,user:variables.PGUSER,password:variables.PGPASSWORD,ssl:false,connectionTimeoutMillis:10000});
const report:Record<string,unknown>={checkedAt:new Date().toISOString(),fixtureAccounts:ids.length,passed:false};
let stage="connect";
try{
 const counts:Record<string,number>={};
 for(const table of ['users','resources','attachments','projects','project_item_history','item_jobs','item_summaries','blob_cleanup']){
  stage=table; const column=table==='users'?'id':'user_id';counts[table]=Number((await pool.query(`select count(*) from ${table} where ${column}=any($1::uuid[])`,[ids])).rows[0].count);
 }
 report.remaining=counts;
 stage="ledger";const ledger=(await pool.query('select storage_key,state from storage_file_ledger where user_id=any($1::uuid[])',[ids])).rows;report.trackedFileKeys=ledger.length;report.removalAcknowledgements=ledger.filter(row=>row.state==='removed').length;
 const s3=new S3Client({endpoint:process.env.B2_ENDPOINT,region:process.env.B2_REGION,forcePathStyle:true,maxAttempts:1,credentials:{accessKeyId:process.env.B2_KEY_ID,secretAccessKey:process.env.B2_APPLICATION_KEY}});
 stage="provider";let versions=0;
 for(const row of ledger){const result=await s3.send(new ListObjectVersionsCommand({Bucket:process.env.B2_BUCKET,Prefix:row.storage_key,MaxKeys:1000}),{abortSignal:AbortSignal.timeout(30000)});versions+=[...(result.Versions||[]),...(result.DeleteMarkers||[])].filter((v:any)=>v.Key===row.storage_key).length;}
 s3.destroy();report.backblazeVersionsRemaining=versions;
 stage="usage";const usage=(await pool.query('select count(*)::int requests,coalesce(sum(cost_usd),0)::text cost from summary_usage where user_id=any($1::uuid[])',[ids])).rows[0];report.summaryUsage=usage;
 report.passed=Object.values(counts).every(n=>n===0)&&ledger.length>=2&&ledger.every(row=>row.state==='removed')&&versions===0&&Number(usage.cost)===0;
}catch(error){report.stage=stage;report.errorCode=(error as {code?:string}).code||'connection_or_provider';report.error='Hosted cleanup check could not complete; private connection/provider output suppressed';}
finally{await pool.end();await writeFile('docs/evidence/library-v2/hosted-cleanup.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;}
