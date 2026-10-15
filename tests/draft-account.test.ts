import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
test("An editor bound to another account cannot write through a changed browser session",async()=>{
 const f=await fixture();try{
  const a=await f.signup(),b=await f.signup(),headers={"x-stash-account":a.user.id};
  const wrong=await f.request("POST","/api/items",{kind:"note",body:"Unsaved account A draft"},b.cookie,headers);
  assert.equal(wrong.statusCode,403,wrong.body);assert.match(wrong.json().error,/account changed/);
  assert.equal((await f.request("GET","/api/items",undefined,b.cookie)).json().total,0);
  const right=await f.request("POST","/api/items",{kind:"note",body:"Account B note"},b.cookie,{"x-stash-account":b.user.id});assert.equal(right.statusCode,200,right.body);
  const legacy=await f.request("POST","/api/items",{kind:"idea",body:"Compatible old client"},b.cookie);assert.equal(legacy.statusCode,200,legacy.body);
  // A stale tab must not delete the newly signed-in account, even if passwords happen to match.
  const deletion=await f.request("DELETE","/api/me",{password:"correct horse battery staple",confirmation:"DELETE"},b.cookie,headers);assert.equal(deletion.statusCode,403,deletion.body);
  assert.equal((await f.request("GET","/api/me",undefined,b.cookie)).statusCode,200);
 }finally{await f.close();}
});
