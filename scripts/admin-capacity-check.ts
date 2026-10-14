import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir,writeFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { fixture } from "../tests/helpers.js";
import { inviteAdmin } from "../apps/server/src/admin-auth.js";
import { totp } from "../apps/server/src/admin-crypto.js";
const key=randomBytes(32).toString("base64"),f=await fixture({adminEncryptionKey:key,adminOrigin:"http://127.0.0.1:3001"});
const headers={origin:"http://127.0.0.1:3001"};
try{
  await inviteAdmin(f.db,{origin:headers.origin,encryptionKey:key,production:false,mailer:{async send(mail){f.mail.push(mail);}}},{email:"capacity-owner@example.test",name:"Capacity owner",role:"owner",bootstrap:true});
  const link=f.mail.at(-1)!.text.match(/https?:\/\/\S+/)![0],token=new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  const begin=await f.request("POST","/admin-api/enroll/start",{token},undefined,headers);
  const enrolled=await f.request("POST","/admin-api/enroll/finish",{token,password:"capacity-test-password",code:totp(begin.json().secret)},undefined,headers);
  if(enrolled.statusCode!==200)throw Error("Capacity fixture owner enrolment failed");
  const cookie=enrolled.headers["set-cookie"]!.toString().split(";")[0];
  await f.db.execute(sql`insert into users(email,name,password_hash) select 'capacity-'||g||'@example.test','Capacity user '||g,'fixture-only' from generate_series(1,10000) g`);
  await f.db.execute(sql`insert into resources(user_id,url,title) select u.id,'https://example.test/item/'||g,'Capacity fixture '||g from users u cross join generate_series(1,5) g`);
  await f.db.execute(sql`analyze users`);await f.db.execute(sql`analyze resources`);
  const results=[];
  for(const path of ["/admin-api/users?limit=25","/admin-api/users?limit=25&offset=5000","/admin-api/users?q=capacity-2500@","/admin-api/overview?days=30"]){
    const started=performance.now(),response=await f.request("GET",path,undefined,cookie,headers),elapsedMs=performance.now()-started;
    if(response.statusCode!==200)throw Error("Capacity endpoint failed");
    const data=response.json();
    if(path.includes("overview")&&(data.metrics.users!==10000||data.metrics.resources!==50000))throw Error("Capacity metrics did not match persisted fixtures");
    if(data.items?.length&&data.items.some((user:any)=>user.resourceCount!==5))throw Error("Per-account counts did not match persisted fixtures");
    if(elapsedMs>2000)throw Error("Capacity endpoint exceeded the two-second local acceptance threshold");
    results.push({path,status:response.statusCode,elapsedMs:Math.round(elapsedMs),...(response.json().total!==undefined?{total:response.json().total}:{} )});
  }
  const plans = (await f.db.execute(sql`explain (analyze,format json) select u.id,(select count(*) from resources r where r.user_id=u.id) as resources from users u order by u.created_at desc,u.id desc limit 25`)).rows;
  await mkdir("docs/evidence/admin",{recursive:true});await writeFile("docs/evidence/admin/capacity.json",JSON.stringify({users:10000,resources:50000,thresholdMs:2000,results,queryPlan:plans},null,2)+"\n");
  console.log("Admin capacity checks passed for 10,000 accounts and 50,000 resources.");
}finally{await f.close();}
