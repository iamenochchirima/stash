import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { adminUsers, adminSessions, adminInvites, adminRecoveryCodes, adminAudit, adminEmailJobs, users, resources, collections, resourceCollections, apiKeys } from "@stash/db";
import { fixture } from "./helpers.js";
import { inviteAdmin } from "../apps/server/src/admin-auth.js";
import { base32, totp, totpStep, mfaCipher } from "../apps/server/src/admin-crypto.js";
import { digest } from "../apps/server/src/auth.js";
const encryptionKey = randomBytes(32).toString("base64");
const origin = "http://127.0.0.1:3001";
async function setup(mailFailure?:()=>boolean,deletionJournalDir?:string) {
  const f = await fixture({ adminEncryptionKey: encryptionKey, adminOrigin: origin, mailFailure, deletionJournalDir });
  const options = { origin, encryptionKey, production: false, mailer: { async send(message: any) { f.mail.push(message); } } };
  const request = (method: any, path: string, body?: unknown, cookie?: string, headers = {}) => f.request(method, path, body, cookie, { origin, ...headers });
  return { ...f, options, request };
}
async function enroll(f: Awaited<ReturnType<typeof setup>>, email = "owner@example.test", role: "owner" | "operator" | "viewer" = "owner", invitedBy?: string) {
  await inviteAdmin(f.db, f.options, { email, name: role, role, bootstrap: role === "owner", invitedBy });
  const link = f.mail.at(-1)!.text.match(/https?:\/\/\S+/)![0];
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
  const started = await f.request("POST", "/admin-api/enroll/start", { token });
  assert.equal(started.statusCode, 200);
  const secret = started.json().secret;
  const result = await f.request("POST", "/admin-api/enroll/finish", { token, password: "owner-password-for-test", code: totp(secret) });
  assert.equal(result.statusCode, 200);
  return { ...result.json(), secret, invitation: token, cookie: result.headers["set-cookie"]!.toString().split(";")[0] };
}
test("AT02 TOTP matches RFC 6238 SHA1 vectors and rejects replay/tampered encrypted secrets", () => {
  const secret = base32(Buffer.from("12345678901234567890"));
  for (const [seconds, expected] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]] as const) assert.equal(totp(secret, seconds * 1000, 8), expected);
  const now = 1234567890000, step = Math.floor(now / 30000);
  assert.equal(totpStep(secret, totp(secret, now), -1, now), step);
  assert.equal(totpStep(secret, totp(secret, now), step, now), null);
  const cipher = mfaCipher(encryptionKey), encoded = cipher.encrypt(secret);
  assert.ok(encoded !== secret); assert.ok(cipher.decrypt(encoded) === secret);
  const bytes = Buffer.from(encoded,"base64"); bytes[15] ^= 1;
  assert.throws(() => cipher.decrypt(bytes.toString("base64")));
});
test("AT01/AT02 dedicated invitation/MFA sign-in rejects customer sessions and stores no plain factors", async () => {
  const f = await setup();
  try {
    const customer = await f.signup();
    assert.equal((await f.request("GET", "/admin-api/me", undefined, customer.cookie)).statusCode, 401);
    assert.equal((await f.request("POST", "/admin-api/login", { email: customer.email, password: "correct horse battery staple", code: "000000" })).statusCode, 401);
    const owner = await enroll(f);
    assert.equal((await f.request("GET", "/admin-api/me", undefined, owner.cookie)).json().admin.role, "owner");
    assert.equal((await f.request("GET", "/api/me", undefined, owner.cookie, { origin: "http://127.0.0.1:3000" })).statusCode, 401);
    assert.equal((await f.request("POST", "/admin-api/enroll/start", { token: owner.invitation })).statusCode, 400);
    const [row] = await f.db.select().from(adminUsers);
    assert.ok(row.mfaSecret !== owner.secret); assert.ok(!row.passwordHash.includes("owner-password-for-test"));
    const codes = await f.db.select().from(adminRecoveryCodes); assert.equal(codes.length, 8); assert.ok(codes.every(c => !owner.recoveryCodes.includes(c.hash)));
    const response = (await f.request("GET", "/admin-api/me", undefined, owner.cookie)).json();
    assert.ok(!JSON.stringify(response).includes(row.mfaSecret)); assert.ok(!JSON.stringify(response).includes(row.passwordHash));
    const replay = await f.request("POST", "/admin-api/login", { email: row.email, password: "owner-password-for-test", code: totp(owner.secret) });
    assert.equal(replay.statusCode, 401);
    const login = await f.request("POST", "/admin-api/login", { email: row.email, password: "owner-password-for-test", code: owner.recoveryCodes[0] });
    assert.equal(login.statusCode, 200);
    const reused = await f.request("POST", "/admin-api/login", { email: row.email, password: "owner-password-for-test", code: owner.recoveryCodes[0] });
    assert.equal(reused.statusCode, 401);
    assert.equal((await f.request("POST", "/admin-api/logout", {}, owner.cookie, { origin: "https://wrong.example" })).statusCode, 403);
    await f.request("POST", "/admin-api/logout", {}, owner.cookie);
    assert.equal((await f.request("GET", "/admin-api/me", undefined, owner.cookie)).statusCode, 401);
    assert.ok((await f.db.select().from(adminAudit)).some(r => r.action === "admin.login"));
  } finally { await f.close(); }
});
test("AT02 admin idle/absolute expiry, role changes and disabling take effect on the next request", async () => {
  const f = await setup();
  try {
    const owner = await enroll(f);
    await f.db.update(adminSessions).set({ lastActiveAt: new Date(Date.now() - 31*60_000) });
    assert.equal((await f.request("GET", "/admin-api/me", undefined, owner.cookie)).statusCode, 401);
    await f.db.update(adminSessions).set({ lastActiveAt: new Date(), expiresAt: new Date(Date.now()-1) });
    assert.equal((await f.request("GET", "/admin-api/me", undefined, owner.cookie)).statusCode, 401);
    await f.db.update(adminSessions).set({ expiresAt: new Date(Date.now()+60_000) });
    await f.db.update(adminUsers).set({ role: "viewer" }).where(eq(adminUsers.id, owner.admin.id));
    assert.equal((await f.request("GET", "/admin-api/me", undefined, owner.cookie)).json().admin.role, "viewer");
    await f.db.update(adminUsers).set({ disabledAt: new Date() }).where(eq(adminUsers.id, owner.admin.id));
    assert.equal((await f.request("GET", "/admin-api/me", undefined, owner.cookie)).statusCode, 401);
  } finally { await f.close(); }
});
test("AT03 bootstrap is operator-only, invitations expire and disabled delivery creates no working invite", async () => {
  const f = await setup();
  try {
    assert.equal((await f.request("POST", "/admin-api/signup", {})).statusCode, 404);
    const owner = await enroll(f);
    await assert.rejects(() => inviteAdmin(f.db, f.options, { email: "other@example.test", name: "other", role: "owner", bootstrap: true }));
    await assert.rejects(() => inviteAdmin(f.db, f.options, { email: "other@example.test", name: "other", role: "owner", invitedBy: owner.admin.id }));
    await inviteAdmin(f.db, f.options, { email: "viewer@example.test", name: "viewer", role: "viewer", invitedBy: owner.admin.id });
    const link = f.mail.at(-1)!.text.match(/https?:\/\/\S+/)![0], token = new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
    await f.db.update(adminInvites).set({ expiresAt: new Date(Date.now()-1) }).where(eq(adminInvites.hash,digest(token)));
    assert.equal((await f.request("POST", "/admin-api/enroll/start", { token })).statusCode, 400);
    await assert.rejects(() => inviteAdmin(f.db, { ...f.options, mailer: { async send() { throw Error("offline"); } } }, { email: "failed@example.test", name: "failed", role: "viewer", invitedBy: owner.admin.id }));
    assert.equal((await f.db.select().from(adminInvites).where(eq(adminInvites.email,"failed@example.test"))).length,0);
  } finally { await f.close(); }
});

test("AT01/AT04/AT05/AT08 role boundaries, private-content redaction, suspension and independent restoration", async () => {
  const f = await setup();
  const customerRequest = (method:any,path:string,body?:unknown,cookie?:string)=>f.request(method,path,body,cookie,{origin:"http://127.0.0.1:3000"});
  const operation = (action:string,confirmation:string)=>({action,confirmation,reason:"Account support verification",operationId:crypto.randomUUID()});
  try {
    const owner = await enroll(f);
    const operator = await enroll(f,"operator@example.test","operator",owner.admin.id);
    const viewer = await enroll(f,"viewer@example.test","viewer",owner.admin.id);
    const customer = await f.signup();
    await customerRequest("POST","/api/auth/verify",{token:f.token("verify",customer.email)});
    await customerRequest("POST","/api/resources",{url:"https://private.example/secret-resource",title:"DO NOT EXPOSE PRIVATE TITLE",notes:"DO NOT EXPOSE PRIVATE NOTES"},customer.cookie);
    const key=(await customerRequest("POST","/api/keys",{name:"Customer assistant",scope:"write"},customer.cookie)).json();
    assert.equal((await f.request("GET","/admin-api/me",undefined,undefined,{authorization:`Bearer ${key.token}`})).statusCode,401);
    const listed=await f.request("GET","/admin-api/users",undefined,viewer.cookie);
    assert.equal(listed.statusCode,200);
    assert.equal(listed.json().items[0].resourceCount,1);
    assert.ok(!listed.body.includes("DO NOT EXPOSE")); assert.ok(!listed.body.includes("private.example"));
    const detail=await f.request("GET",`/admin-api/users/${customer.user.id}`,undefined,operator.cookie);
    assert.equal(detail.statusCode,200); assert.ok(!detail.body.includes("passwordHash"));
    assert.equal((await f.request("GET","/admin-api/admins",undefined,operator.cookie)).statusCode,403);
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,operation("suspend",customer.email),viewer.cookie)).statusCode,403);
    const input=operation("suspend",customer.email);
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,input,operator.cookie)).statusCode,200);
    assert.equal((await customerRequest("GET","/api/me",undefined,customer.cookie)).statusCode,401);
    assert.equal((await customerRequest("POST","/api/auth/login",{email:customer.email,password:"correct horse battery staple"})).statusCode,401);
    assert.equal((await f.request("POST","/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"},undefined,{host:"127.0.0.1:4000",accept:"application/json, text/event-stream",authorization:`Bearer ${key.token}`})).statusCode,401);
    const repeat=await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,input,operator.cookie);
    assert.equal(repeat.statusCode,200);assert.equal(repeat.json().repeated,true);
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,operation("restore",customer.email),operator.cookie)).statusCode,200);
    assert.equal((await customerRequest("GET","/api/me",undefined,customer.cookie)).statusCode,401);
    const login=await customerRequest("POST","/api/auth/login",{email:customer.email,password:"correct horse battery staple"});assert.equal(login.statusCode,200);
    const restored=login.headers["set-cookie"]!.toString().split(";")[0];
    assert.equal((await customerRequest("GET","/api/resources",undefined,restored)).json().total,1);
    assert.equal((await customerRequest("GET","/api/keys",undefined,restored)).json().items.length,0);
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,operation("delete",customer.email),operator.cookie)).statusCode,403);
    const auditRows=(await f.request("GET",`/admin-api/activity?targetId=${customer.user.id}`,undefined,owner.cookie)).json().items;
    assert.equal(auditRows.filter((r:any)=>r.action==="user.suspend"&&r.outcome==="success").length,1);
    assert.ok(auditRows.some((r:any)=>r.action==="user.restore"));
    const searched=(await f.request("GET",`/admin-api/activity?q=${encodeURIComponent("Account suspended")}`,undefined,owner.cookie)).json();
    assert.equal(searched.total,1);assert.equal(searched.items[0].action,"user.suspend");
    assert.ok(!JSON.stringify(auditRows).includes(customer.email));
    const overview=(await f.request("GET","/admin-api/overview",undefined,viewer.cookie)).json();assert.equal(overview.metrics.users,1);assert.equal(overview.metrics.resources,1);
  } finally {await f.close();}
});
test("AT03/AT08 final-owner protection, changed permissions, wrong confirmations and stale action authentication", async () => {
  const f=await setup();
  try {
    const owner=await enroll(f),input={action:"disable",confirmation:owner.admin.email,reason:"Administrative access review",operationId:crypto.randomUUID()};
    assert.equal((await f.request("POST",`/admin-api/admins/${owner.admin.id}/actions`,input,owner.cookie)).statusCode,409);
    assert.equal((await f.request("GET","/admin-api/me",undefined,owner.cookie)).statusCode,200);
    const operator=await enroll(f,"operator@example.test","operator",owner.admin.id);
    assert.equal((await f.request("POST",`/admin-api/admins/${operator.admin.id}/actions`,{...input,confirmation:"wrong@example.test",operationId:crypto.randomUUID()},owner.cookie)).statusCode,400);
    assert.equal((await f.request("GET","/admin-api/me",undefined,operator.cookie)).statusCode,200);
    assert.equal((await f.request("POST",`/admin-api/admins/${operator.admin.id}/actions`,{...input,confirmation:operator.admin.email,operationId:crypto.randomUUID()},owner.cookie)).statusCode,200);
    assert.equal((await f.request("GET","/admin-api/me",undefined,operator.cookie)).statusCode,401);
    await f.db.update(adminSessions).set({authenticatedAt:new Date(Date.now()-6*60_000)}).where(eq(adminSessions.hash,digest(owner.cookie.split("=")[1])));
    assert.equal((await f.request("POST","/admin-api/admins/invite",{email:"later@example.test",name:"Later",role:"viewer",reason:"Operational access needed"},owner.cookie)).statusCode,428);
    assert.equal((await f.request("POST","/admin-api/reauthenticate",{password:"owner-password-for-test",code:owner.recoveryCodes[0]},owner.cookie)).statusCode,200);
    assert.equal((await f.request("POST","/admin-api/admins/invite",{email:"later@example.test",name:"Later",role:"viewer",reason:"Operational access needed"},owner.cookie)).statusCode,200);
  } finally {await f.close();}
});

test("AT02 MFA replacement invalidates prior sessions/codes and operator-assisted recovery preserves role", async()=>{
  const f=await setup();
  try{
    const owner=await enroll(f);
    const start=await f.request("POST","/admin-api/mfa/start",{},owner.cookie);assert.equal(start.statusCode,200);
    const finish=await f.request("POST","/admin-api/mfa/finish",{code:totp(start.json().secret)},owner.cookie);assert.equal(finish.statusCode,200);
    assert.equal((await f.request("GET","/admin-api/me",undefined,owner.cookie)).statusCode,401);
    assert.equal((await f.request("POST","/admin-api/login",{email:owner.admin.email,password:"owner-password-for-test",code:owner.recoveryCodes[0]})).statusCode,401);
    const newCookie=finish.headers["set-cookie"]!.toString().split(";")[0];
    assert.equal((await f.request("GET","/admin-api/me",undefined,newCookie)).statusCode,200);
    await inviteAdmin(f.db,f.options,{email:owner.admin.email,name:"owner",role:"owner",recover:true});
    assert.equal((await f.request("GET","/admin-api/me",undefined,newCookie)).statusCode,401);
    assert.equal((await f.request("POST","/admin-api/login",{email:owner.admin.email,password:"owner-password-for-test",code:finish.json().recoveryCodes[0]})).statusCode,401);
    const link=f.mail.at(-1)!.text.match(/https?:\/\/\S+/)![0],token=new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
    const setupResponse=await f.request("POST","/admin-api/enroll/start",{token});assert.equal(setupResponse.statusCode,200);
    const recovered=await f.request("POST","/admin-api/enroll/finish",{token,password:"recovered-owner-password",code:totp(setupResponse.json().secret)});assert.equal(recovered.statusCode,200);
    assert.equal(recovered.json().admin.id,owner.admin.id);assert.equal(recovered.json().admin.role,"owner");
    assert.equal((await f.db.select().from(adminUsers)).length,1);
    assert.equal((await f.request("POST","/admin-api/enroll/start",{token})).statusCode,400);
  }finally{await f.close();}
});
test("AT06 support emails use the customer's address, cooldown/idempotency and never expose delivery payloads",async()=>{
  const f=await setup();
  try{
    const owner=await enroll(f),customer=await f.signup();
    const input={purpose:"verify",confirmation:customer.email,reason:"User requested verification help",operationId:randomUUID()};
    const before=f.mail.length;
    const sent=await f.request("POST",`/admin-api/users/${customer.user.id}/email`,input,owner.cookie);assert.equal(sent.statusCode,200);
    assert.equal(f.mail.length,before+1);assert.equal(f.mail.at(-1)!.to,customer.email);
    assert.ok(f.mail.at(-1)!.idempotencyKey?.startsWith("stash-admin-email-"));
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/email`,input,owner.cookie)).statusCode,200);
    assert.equal(f.mail.length,before+1);
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/email`,{...input,operationId:randomUUID()},owner.cookie)).statusCode,429);
    const [job]=await f.db.select().from(adminEmailJobs);assert.equal(job.status,"sent");assert.equal(job.payload,null);
    const log=(await f.request("GET",`/admin-api/activity?targetId=${customer.user.id}`,undefined,owner.cookie)).body;
    assert.ok(!log.includes(customer.email));assert.ok(!log.includes("?verify="));
    const [stored]=await f.db.select().from(adminUsers);
    assert.ok(!log.includes(stored.mfaSecret));
  }finally{await f.close();}
});
test("AT05/AT07 suspension and deletion leave no credentials from racing login/key/OAuth requests",async()=>{
 for(const action of ["suspend","delete"] as const){
  const f=await setup();
  const customerRequest=(method:any,path:string,body?:unknown,cookie?:string,headers={})=>f.request(method,path,body,cookie,{origin:"http://127.0.0.1:3000",...headers});
  try{
    const owner=await enroll(f),customer=await f.signup();
    await customerRequest("POST","/api/auth/verify",{token:f.token("verify",customer.email)});
    const registered=await customerRequest("POST","/oauth/register",{client_name:"Customer OAuth",redirect_uris:["https://client.example/callback"],token_endpoint_auth_method:"none"});const client=registered.json().client_id;
    async function authorization(){
      const verifier=randomBytes(32).toString("base64url"),resource="http://127.0.0.1:4000/mcp";
      const query=new URLSearchParams({response_type:"code",client_id:client,redirect_uri:"https://client.example/callback",resource,scope:"stash:read",code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"});
      const start=await customerRequest("GET",`/oauth/authorize?${query}`);assert.equal(start.statusCode,302);
      const nonce=new URL(start.headers.location!).searchParams.get("request")!;
      await customerRequest("GET",`/api/oauth/requests/${nonce}`,undefined,customer.cookie);
      const consent=await customerRequest("POST",`/api/oauth/requests/${nonce}`,{approve:true},customer.cookie);assert.equal(consent.statusCode,200);
      const code=new URL(consent.json().redirect).searchParams.get("code");
      return {grant_type:"authorization_code",client_id:client,redirect_uri:"https://client.example/callback",resource,code_verifier:verifier,code};
    }
    const exchange=await authorization(),token=await customerRequest("POST","/oauth/token",exchange);assert.equal(token.statusCode,200);
    assert.equal((await f.request("GET","/admin-api/me",undefined,undefined,{authorization:`Bearer ${token.json().access_token}`})).statusCode,401);
    const pending=await authorization();
    const suspension={action,confirmation:customer.email,reason:"Verify OAuth suspension boundaries",operationId:randomUUID()};
    const [suspended,login]=await Promise.all([
      f.request("POST",`/admin-api/users/${customer.user.id}/actions`,suspension,owner.cookie),
      customerRequest("POST","/api/auth/login",{email:customer.email,password:"correct horse battery staple"}),
      customerRequest("POST","/api/keys",{name:"Racing key",scope:"read"},customer.cookie),
      customerRequest("POST","/oauth/token",pending),
      customerRequest("POST","/oauth/token",{grant_type:"refresh_token",client_id:client,resource:exchange.resource,refresh_token:token.json().refresh_token})
    ]);assert.equal(suspended.statusCode,200);
    if(login.statusCode===200){
      const racingCookie=login.headers["set-cookie"]!.toString().split(";")[0];
      assert.equal((await customerRequest("GET","/api/me",undefined,racingCookie)).statusCode,401);
    }else assert.equal(login.statusCode,401);
    assert.equal((await f.db.execute(sql`select count(*)::int AS count from sessions where user_id=${customer.user.id}`)).rows[0].count,0);
    assert.equal((await customerRequest("GET","/api/keys",undefined,customer.cookie)).statusCode,401);
    assert.equal((await customerRequest("POST","/oauth/token",pending)).json().error,"invalid_grant");
    assert.equal((await customerRequest("POST","/oauth/token",{grant_type:"refresh_token",client_id:client,resource:exchange.resource,refresh_token:token.json().refresh_token})).json().error,"invalid_grant");
    assert.equal((await customerRequest("POST","/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"},undefined,{host:"127.0.0.1:4000",accept:"application/json, text/event-stream",authorization:`Bearer ${token.json().access_token}`})).statusCode,401);
    assert.equal((await f.db.execute(sql`select count(*)::int AS count from api_keys where user_id=${customer.user.id}`)).rows[0].count,0);
  }finally{await f.close();}
 }
});
test("AT03 concurrent final-owner removals preserve a usable owner and audit failure prevents account mutation",async()=>{
  const f=await setup();
  try{
    const owner=await enroll(f),second=await enroll(f,"second@example.test","operator",owner.admin.id);
    await f.db.update(adminUsers).set({role:"owner"}).where(eq(adminUsers.id,second.admin.id));
    const change=(target:any)=>({action:"disable",confirmation:target.admin.email,reason:"Concurrent access-management check",operationId:randomUUID()});
    const result=await Promise.all([f.request("POST",`/admin-api/admins/${owner.admin.id}/actions`,change(owner),owner.cookie),f.request("POST",`/admin-api/admins/${second.admin.id}/actions`,change(second),second.cookie)]);
    assert.equal(result.filter(r=>r.statusCode===200).length,1);assert.equal(result.filter(r=>r.statusCode===409).length,1);
    const remaining=(await f.db.select().from(adminUsers)).find(u=>!u.disabledAt)!;
    const cookie=remaining.id===owner.admin.id?owner.cookie:second.cookie;
    const customer=await f.signup();
    await f.db.execute(sql`create function fail_admin_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$`);
    await f.db.execute(sql`create trigger fail_admin_audit before insert on admin_audit for each row execute function fail_admin_audit()`);
    const suspended=await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,{action:"suspend",confirmation:customer.email,reason:"Audit failure should prevent mutation",operationId:randomUUID()},cookie);
    assert.equal(suspended.statusCode,500);
    const [user]=await f.db.select().from(users).where(eq(users.id,customer.user.id));assert.equal(user.suspendedAt,null);
    const deleted=await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,{action:"delete",confirmation:customer.email,reason:"Audit failure should prevent deletion intent",operationId:randomUUID()},cookie);assert.equal(deleted.statusCode,500);
    assert.equal((await f.db.select().from(users).where(eq(users.id,customer.user.id))).length,1);
  }finally{await f.close();}
});

test("AT08/AT09 retention removes expired metadata only and paginated aggregate views stay accurate",async()=>{
  const {maintainAdmin}=await import("../apps/server/src/admin-maintenance.js");
  const f=await setup();
  try{
    const owner=await enroll(f);
    await f.db.insert(users).values(Array.from({length:80},(_,i)=>({email:`person${i}@example.test`,name:`Person ${i}`,passwordHash:"fixture-only",createdAt:new Date(Date.now()-i*60000)})));
    const first=await f.request("GET","/admin-api/users?limit=25",undefined,owner.cookie),next=await f.request("GET","/admin-api/users?limit=25&offset=25",undefined,owner.cookie);
    assert.equal(first.json().total,80);assert.equal(first.json().items.length,25);assert.equal(next.json().items.length,25);
    assert.ok(first.json().items.every((a:any)=>!next.json().items.some((b:any)=>a.id===b.id)));
    assert.equal((await f.request("GET","/admin-api/users?limit=1000",undefined,owner.cookie)).statusCode,400);
    assert.equal((await f.request("GET","/admin-api/users?q=person1@",undefined,owner.cookie)).json().total,1);
    assert.equal((await f.request("GET","/admin-api/overview?days=30",undefined,owner.cookie)).json().metrics.users,80);
    await f.db.insert(adminAudit).values({actorId:owner.admin.id,action:"retention.fixture",reason:"Expired record fixture",outcome:"success",createdAt:new Date(Date.now()-91*86400_000)});
    await maintainAdmin(f.db);
    assert.equal((await f.db.select().from(adminAudit).where(eq(adminAudit.action,"retention.fixture"))).length,0);
    assert.equal((await f.db.select().from(users)).length,80);
    assert.equal((await f.request("GET","/admin-api/me",undefined,owner.cookie)).statusCode,200);
  }finally{await f.close();}
});

test("AT06 delivery failures retain encrypted retry state and bounded retries succeed without duplicate issuance",async()=>{
  let failed=false;const f=await setup(()=>failed);
  try{
    const owner=await enroll(f),customer=await f.signup();failed=true;
    const input={purpose:"reset",confirmation:customer.email,reason:"Test recovery sender outage",operationId:randomUUID()};
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/email`,input,owner.cookie)).statusCode,503);
    const [job]=await f.db.select().from(adminEmailJobs);assert.equal(job.status,"pending");assert.equal(job.attempts,1);
    assert.ok(job.payload&&!job.payload.includes("reset="));assert.ok(!job.payload?.includes(customer.email));
    const auditResponse=(await f.request("GET",`/admin-api/activity?targetId=${customer.user.id}`,undefined,owner.cookie)).json();
    assert.ok(auditResponse.items.some((r:any)=>r.action==="user.email.reset.delivery"&&r.outcome==="failed"));
    failed=false;const before=f.mail.length;
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/email`,input,owner.cookie)).statusCode,200);assert.equal(f.mail.length,before+1);
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/email`,input,owner.cookie)).statusCode,200);assert.equal(f.mail.length,before+1);
    const [sent]=await f.db.select().from(adminEmailJobs);assert.equal(sent.payload,null);assert.equal(sent.attempts,2);
    const reset=await f.request("POST","/api/auth/reset",{token:f.token("reset",customer.email),password:"recovered-customer-password"},undefined,{origin:"http://127.0.0.1:3000"});assert.equal(reset.statusCode,200);
    assert.equal((await f.request("POST","/api/auth/reset",{token:f.token("reset",customer.email),password:"recovered-customer-password"},undefined,{origin:"http://127.0.0.1:3000"})).statusCode,400);
  }finally{await f.close();}
});

test("AT07 administrative deletion cascades and the durable journal removes restored account/library data",async()=>{
  const {createDeletionJournal}=await import("../apps/server/src/deletions.js");
  const {rm}=await import("node:fs/promises");
  const directory=`.data/admin-deletion-recovery-${randomUUID()}`,f=await setup(undefined,directory);
  try{
    const owner=await enroll(f),customer=await f.signup();
    const call=(method:any,path:string,body?:unknown)=>f.request(method,path,body,customer.cookie,{origin:"http://127.0.0.1:3000"});
    await call("POST","/api/auth/verify",{token:f.token("verify",customer.email)});
    const inbox=(await call("GET","/api/collections")).json().items[0];
    const additional=(await call("POST","/api/collections",{name:"Restore collection"})).json().item;
    assert.equal((await call("POST","/api/resources",{url:"https://example.test/deletion-replay",title:"Restore fixture",notes:"Restore fixture private note",collectionIds:[inbox.id,additional.id]})).statusCode,200);
    await call("POST","/api/keys",{name:"Restore fixture key",scope:"read"});
    const [snapshot]=await f.db.select().from(users).where(eq(users.id,customer.user.id));
    const oldCollections=await f.db.select().from(collections).where(eq(collections.userId,customer.user.id));
    const oldResources=await f.db.select().from(resources).where(eq(resources.userId,customer.user.id));
    const oldMemberships=await f.db.select().from(resourceCollections).where(eq(resourceCollections.userId,customer.user.id));
    const oldKeys=await f.db.select().from(apiKeys).where(eq(apiKeys.userId,customer.user.id));
    assert.equal(oldMemberships.length,2);assert.equal(oldKeys.length,1);
    const input={action:"delete",confirmation:customer.email,reason:"Verify durable administrative deletion",operationId:randomUUID()};
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,input,owner.cookie)).statusCode,200);
    assert.equal((await f.db.select().from(users).where(eq(users.id,customer.user.id))).length,0);
    assert.equal((await f.db.select().from(apiKeys).where(eq(apiKeys.userId,customer.user.id))).length,0);
    const events=(await f.request("GET",`/admin-api/activity?targetId=${customer.user.id}`,undefined,owner.cookie)).json().items;
    assert.ok(events.some((e:any)=>e.action==="user.delete.requested"));assert.ok(events.some((e:any)=>e.action==="user.delete"));
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,input,owner.cookie)).statusCode,200);
    await f.db.insert(users).values(snapshot);await f.db.insert(collections).values(oldCollections);await f.db.insert(resources).values(oldResources);
    await f.db.insert(resourceCollections).values(oldMemberships);await f.db.insert(apiKeys).values(oldKeys);
    assert.equal((await f.db.select().from(resources).where(eq(resources.userId,customer.user.id))).length,1);
    const journal=createDeletionJournal(directory);assert.equal(await journal.apply(f.db),1);assert.equal(await journal.apply(f.db),0);
    assert.equal((await f.db.select().from(users).where(eq(users.id,customer.user.id))).length,0);
    assert.equal((await f.db.select().from(resources).where(eq(resources.userId,customer.user.id))).length,0);
    assert.equal((await f.db.select().from(adminUsers)).length,1);
  }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});

test("AT01 encoded admin route aliases cannot bypass origin or authentication boundaries",async()=>{
  const f=await setup();
  try{
    const owner=await enroll(f),customer=await f.signup();
    const input={action:"suspend",confirmation:customer.email,reason:"Encoded-route boundary verification",operationId:randomUUID()};
    for(const prefix of ["/admin-api","/%61dmin-api","/admin%2dapi"]){
      const response=await f.request("POST",`${prefix}/users/${customer.user.id}/actions`,input,owner.cookie,{origin:"http://127.0.0.1:3000"});
      assert.ok([403,404].includes(response.statusCode));
    }
    const [user]=await f.db.select().from(users).where(eq(users.id,customer.user.id));assert.equal(user.suspendedAt,null);
  }finally{await f.close();}
});

test("AT01 production admin sessions are host-only secure cookies independent from customer sessions",async()=>{
  const {createApp}=await import("../apps/server/src/app.js");const f=await setup();let app:Awaited<ReturnType<typeof createApp>>|undefined;
  try{
    const owner=await enroll(f);
    app=await createApp(f.db,{production:true,origin:"https://stash.example",publicApiUrl:"https://api.stash.example",adminOrigin:"https://admin.stash.example",adminEncryptionKey:encryptionKey,mailer:{async send(){}}});await app.ready();
    const response=await app.inject({method:"POST",url:"/admin-api/login",headers:{origin:"https://admin.stash.example"},payload:{email:owner.admin.email,password:"owner-password-for-test",code:owner.recoveryCodes[0]}});assert.equal(response.statusCode,200);
    const cookie=response.headers["set-cookie"]!.toString();
    assert.ok(cookie.startsWith("__Host-stash_admin="));assert.ok(cookie.includes("HttpOnly"));assert.ok(cookie.includes("Secure"));assert.ok(cookie.includes("SameSite=Strict"));assert.ok(cookie.includes("Path=/"));assert.ok(!cookie.includes("Domain="));
    assert.ok(!cookie.startsWith("stash_session="));
  }finally{await app?.close();await f.close();}
});

test("AT06 delivery and suspension share admin/customer lock ordering without a deadlock",async()=>{
  const f=await setup();
  try{
    const owner=await enroll(f),customer=await f.signup();
    await f.db.execute(sql`create function pause_email_audit() returns trigger language plpgsql as $$begin if NEW.action LIKE 'user.email.%.attempt' then perform pg_sleep(0.2); end if; return NEW; end$$`);
    await f.db.execute(sql`create trigger pause_email_audit before insert on admin_audit for each row execute function pause_email_audit()`);
    const sending=f.request("POST",`/admin-api/users/${customer.user.id}/email`,{purpose:"reset",confirmation:customer.email,reason:"Delivery lock-order verification",operationId:randomUUID()},owner.cookie);
    const deadline=Date.now()+3000;
    let sleeping=false;
    while(Date.now()<deadline&&!sleeping){
      sleeping=Boolean((await f.db.execute(sql`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='PgSleep' and query like '%admin_audit%') AS sleeping`)).rows[0].sleeping);
      if(!sleeping)await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(sleeping,true);
    const suspending=f.request("POST",`/admin-api/users/${customer.user.id}/actions`,{action:"suspend",confirmation:customer.email,reason:"Suspend after in-flight delivery",operationId:randomUUID()},owner.cookie);
    const [sent,suspended]=await Promise.all([sending,suspending]);
    assert.equal(sent.statusCode,200);assert.equal(suspended.statusCode,200);
    const [user]=await f.db.select().from(users).where(eq(users.id,customer.user.id));assert.ok(user.suspendedAt);
    const [job]=await f.db.select().from(adminEmailJobs);assert.equal(job.status,"sent");
  }finally{await f.close();}
});


test("AT02 admin login rate limiting rejects continued password/factor attempts",async()=>{
  const f=await setup();
  try{
    for(let i=0;i<10;i++)assert.equal((await f.request("POST","/admin-api/login",{email:"unknown@example.test",password:"invalid-password",code:"000000"})).statusCode,401);
    const limited=await f.request("POST","/admin-api/login",{email:"unknown@example.test",password:"invalid-password",code:"000000"});
    assert.equal(limited.statusCode,429);assert.ok(limited.headers["retry-after"]);
    assert.equal((await f.db.select().from(adminSessions)).length,0);
  }finally{await f.close();}
});

test("AT07 journal failure preserves a live account and an authorised SQL failure is completed by replay",async()=>{
  const {writeFile,readFile,rm}=await import("node:fs/promises"),{createDeletionJournal}=await import("../apps/server/src/deletions.js");
  const directory=`.data/admin-deletion-failure-${randomUUID()}`,f=await setup(undefined,directory);
  try{
    const owner=await enroll(f),customer=await f.signup();
    const input={action:"delete",confirmation:customer.email,reason:"Disposable deletion failure verification",operationId:randomUUID()};
    await writeFile(directory,"Deliberately prevent journal directory creation");
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,input,owner.cookie)).statusCode,500);
    assert.equal((await f.db.select().from(users).where(eq(users.id,customer.user.id))).length,1);
    assert.ok((await f.db.select().from(adminAudit)).some(e=>e.action==="user.delete.requested"&&e.targetId===customer.user.id));
    await rm(directory);
    await f.db.execute(sql`create function reject_deletion_completion() returns trigger language plpgsql as $$begin if NEW.action='user.delete' and NEW.outcome='success' then raise exception 'completion audit unavailable'; end if; return NEW; end$$`);
    await f.db.execute(sql`create trigger reject_deletion_completion before insert on admin_audit for each row execute function reject_deletion_completion()`);
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,input,owner.cookie)).statusCode,500);
    assert.equal((await f.db.select().from(users).where(eq(users.id,customer.user.id))).length,1);
    const journalEntry=JSON.parse((await readFile(`${directory}/account-deletions.jsonl`,"utf8")).trim());
    assert.equal(journalEntry.userId,customer.user.id);
    assert.equal(await createDeletionJournal(directory).apply(f.db),1);
    assert.equal((await f.db.select().from(users).where(eq(users.id,customer.user.id))).length,0);
    assert.equal((await f.request("GET","/admin-api/me",undefined,owner.cookie)).statusCode,200);
  }finally{await f.close();await rm(directory,{recursive:true,force:true});}
});


test("AT06 administrator sign-out and disconnect target independent credentials on one account",async()=>{
  const f=await setup();
  const call=(method:any,path:string,body?:unknown,cookie?:string,headers={})=>f.request(method,path,body,cookie,{origin:"http://127.0.0.1:3000",...headers});
  try{
    const owner=await enroll(f),customer=await f.signup();
    await call("POST","/api/auth/verify",{token:f.token("verify",customer.email)});
    const key=(await call("POST","/api/keys",{name:"Independent credential",scope:"read"},customer.cookie)).json();
    const input=(action:string)=>({action,confirmation:customer.email,reason:"Verify independent support revocation",operationId:randomUUID()});
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,input("signout"),owner.cookie)).statusCode,200);
    assert.equal((await call("GET","/api/me",undefined,customer.cookie)).statusCode,401);
    const tools=()=>call("POST","/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"},undefined,{host:"127.0.0.1:4000",accept:"application/json, text/event-stream",authorization:`Bearer ${key.token}`});
    assert.equal((await tools()).statusCode,200);
    const login=await call("POST","/api/auth/login",{email:customer.email,password:"correct horse battery staple"});assert.equal(login.statusCode,200);
    const cookie=login.headers["set-cookie"]!.toString().split(";")[0];
    assert.equal((await f.request("POST",`/admin-api/users/${customer.user.id}/actions`,input("disconnect"),owner.cookie)).statusCode,200);
    assert.equal((await call("GET","/api/me",undefined,cookie)).statusCode,200);
    assert.equal((await tools()).statusCode,401);
    assert.equal((await call("GET","/api/keys",undefined,cookie)).json().items.length,0);
    assert.equal((await f.request("GET","/admin-api/me",undefined,owner.cookie)).statusCode,200);
  }finally{await f.close();}
});
