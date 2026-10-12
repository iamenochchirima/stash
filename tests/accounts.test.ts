import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { accountTokens, users, sessions, apiKeys } from "@stash/db";
import sharp from "sharp";
import { fixture } from "./helpers.js";
import { digest } from "../apps/server/src/auth.js";
test("T04/T05/T09 signup, verification, session handling, and browser origin protection", async () => {
  const f = await fixture();
  try {
    const weak = await f.request("POST", "/api/auth/signup", {
      email: "bad",
      password: "short",
      name: "A",
    });
    assert.equal(weak.statusCode, 400);
    for (const fields of [{ name:"n".repeat(81),password:"correct horse battery staple" },{ name:"Valid",password:"p".repeat(129) }]) {
      assert.equal((await f.request("POST","/api/auth/signup",{ email:"invalid@example.test",...fields })).statusCode,400);
    }
    assert.equal(f.mail.length,0);
    const u = await f.signup("  FIRST@EXAMPLE.TEST  ");
    assert.equal(u.user.email, "first@example.test");
    assert.equal(u.user.emailVerified, false);
    assert.equal(u.user.onboarding.profile, true);
    const duplicate = await f.request("POST", "/api/auth/signup", {
      email: "first@example.test",
      password: "correct horse battery staple",
      name: "Other",
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(
      (await f.request("POST", "/api/keys", { name: "Agent" }, u.cookie))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await f.request("PATCH", "/api/me", { name: "Evil" }, u.cookie, {
          origin: "https://evil.test",
        })
      ).statusCode,
      403,
    );
    const token = f.token("verify", "first@example.test");
    assert.equal(
      (await f.request("POST", "/api/auth/verify", { token })).statusCode,
      200,
    );
    assert.equal(
      (await f.request("POST", "/api/auth/verify", { token })).statusCode,
      400,
    );
    assert.equal(
      (await f.request("GET", "/api/me", undefined, u.cookie)).json().user
        .emailVerified,
      true,
    );
    assert.equal(
      (
        await f.request("POST", "/api/auth/login", {
          email: u.user.email,
          password: "wrong password",
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.request("POST", "/api/auth/login", {
          email: "missing@example.test",
          password: "wrong password",
        })
      ).statusCode,
      401,
    );
    const login = await f.request("POST", "/api/auth/login", {
      email: u.user.email,
      password: "correct horse battery staple",
    });
    assert.equal(login.statusCode, 200);
    assert.match(login.headers["set-cookie"]!.toString(), /HttpOnly/);
    assert.match(login.headers["set-cookie"]!.toString(), /SameSite=Lax/);
    assert.equal(
      (await f.request("POST", "/api/auth/logout", {}, u.cookie)).statusCode,
      200,
    );
    assert.equal(
      (await f.request("GET", "/api/me", undefined, u.cookie)).statusCode,
      401,
    );
    const loginCookie = login.headers["set-cookie"]!.toString().split(";")[0];
    await f.db.update(sessions).set({ expiresAt: new Date(0) });
    assert.equal(
      (await f.request("GET", "/api/me", undefined, loginCookie)).statusCode,
      401,
    );
  } finally {
    await f.close();
  }
});
test("T04 verification expiry and resend replace previous tokens; delivery failure remains recoverable", async () => {
  const f = await fixture();
  try {
    const u = await f.signup();
    const old = f.token("verify", u.email);
    await f.db.update(accountTokens).set({ expiresAt: new Date(0) });
    assert.equal(
      (await f.request("POST", "/api/auth/verify", { token: old })).statusCode,
      400,
    );
    assert.equal(
      (await f.request("POST", "/api/auth/resend", {}, u.cookie)).statusCode,
      200,
    );
    const latest = f.token("verify", u.email);
    assert.notEqual(old, latest);
    assert.equal(
      (await f.request("POST", "/api/auth/verify", { token: old })).statusCode,
      400,
    );
    assert.equal(
      (await f.request("POST", "/api/auth/verify", { token: latest }))
        .statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});
test("T06/E05 recovery hides unknown accounts, is single-use, and invalidates sessions and keys", async () => {
  const f = await fixture();
  try {
    const u = await f.signup();
    await f.request("POST", "/api/auth/verify", {
      token: f.token("verify", u.email),
    });
    await f.request(
      "POST",
      "/api/keys",
      { name: "Before reset", scope: "write" },
      u.cookie,
    );
    const known = await f.request("POST", "/api/auth/forgot", {
        email: u.email,
      }),
      unknown = await f.request("POST", "/api/auth/forgot", {
        email: "unknown@example.test",
      });
    assert.deepEqual(known.json(), unknown.json());
    const expired = f.token("reset", u.email);
    await f.db
      .update(accountTokens)
      .set({ expiresAt: new Date(0) })
      .where(eq(accountTokens.purpose, "reset"));
    assert.equal(
      (
        await f.request("POST", "/api/auth/reset", {
          token: expired,
          password: "another correct long password",
        })
      ).statusCode,
      400,
    );
    await f.request("POST", "/api/auth/forgot", { email: u.email });
    const token = f.token("reset", u.email);
    assert.equal(
      (
        await f.request("POST", "/api/auth/reset", {
          token,
          password: "another correct long password",
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.request("POST", "/api/auth/reset", {
          token,
          password: "another correct long password",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await f.request("GET", "/api/me", undefined, u.cookie)).statusCode,
      401,
    );
    assert.equal((await f.db.select().from(apiKeys)).length, 0);
    assert.equal(
      (
        await f.request("POST", "/api/auth/login", {
          email: u.email,
          password: "correct horse battery staple",
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.request("POST", "/api/auth/login", {
          email: u.email,
          password: "another correct long password",
        })
      ).statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});
test("T08/T17/E08 profiles, safe avatars, reauthenticated deletion, and complete live cleanup", async () => {
  const f = await fixture();
  try {
    const a = await f.signup(),
      b = await f.signup();
    const updated = await f.request(
      "PATCH",
      "/api/me",
      { name: "New Name", bio: "My research", interests: ["agents"] },
      a.cookie,
    );
    assert.equal(updated.json().user.name, "New Name");
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const avatar = await f.request(
      "POST",
      "/api/me/avatar",
      { image: `data:image/png;base64,${png.toString("base64")}` },
      a.cookie,
    );
    const oversized=`data:image/png;base64,${Buffer.alloc(2097153).toString("base64")}`;
    assert.equal((await f.request("POST","/api/me/avatar",{ image:oversized },a.cookie)).statusCode,400);
    const excessivePixels=await sharp({ create:{ width:4001,height:4000,channels:3,background:"#ff0000" } }).png().toBuffer();
    assert.equal((await f.request("POST","/api/me/avatar",{ image:`data:image/png;base64,${excessivePixels.toString("base64")}` },a.cookie)).statusCode,400);
    assert.equal(avatar.statusCode, 200);
    assert.match(avatar.json().user.avatar, /^data:image\/png/);
    assert.equal(
      (await f.request("GET", "/api/me", undefined, b.cookie)).json().user
        .avatar,
      null,
    );
    for (const image of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,bm90YW5pbWFnZQ==",
      `data:image/jpeg;base64,${png.toString("base64")}`,
    ])
      assert.equal(
        (await f.request("POST", "/api/me/avatar", { image }, a.cookie))
          .statusCode,
        400,
      );
    assert.equal(
      (await f.request("DELETE", "/api/me/avatar", {}, a.cookie)).json().user
        .avatar,
      null,
    );
    await f.request(
      "POST",
      "/api/resources",
      { url: "https://example.test/a", title: "Private" },
      a.cookie,
    );
    await f.request("POST", "/api/auth/verify", {
      token: f.token("verify", a.email),
    });
    await f.request("POST", "/api/keys", { name: "Delete me" }, a.cookie);
    assert.equal(
      (
        await f.request(
          "DELETE",
          "/api/me",
          { password: "wrong", confirmation: "DELETE" },
          a.cookie,
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.request(
          "DELETE",
          "/api/me",
          { password: "correct horse battery staple", confirmation: "DELETE" },
          a.cookie,
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await f.request("GET", "/api/me", undefined, a.cookie)).statusCode,
      401,
    );
    assert.equal(
      (await f.request("GET", "/api/me", undefined, b.cookie)).statusCode,
      200,
    );
    const result = await f.db.execute(
      sql`select (select count(*) from resources where user_id=${a.user.id})+(select count(*) from collections where user_id=${a.user.id})+(select count(*) from api_keys where user_id=${a.user.id})+(select count(*) from sessions where user_id=${a.user.id})+(select count(*) from account_tokens where user_id=${a.user.id}) as remaining`,
    );
    assert.equal(Number(result.rows[0].remaining), 0);
  } finally {
    await f.close();
  }
});
test("T05/T17 authentication endpoints enforce rate limits", async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 10; n++)
      assert.equal(
        (
          await f.request("POST", "/api/auth/forgot", {
            email: "absent@example.test",
          })
        ).statusCode,
        200,
      );
    assert.equal(
      (
        await f.request("POST", "/api/auth/forgot", {
          email: "absent@example.test",
        })
      ).statusCode,
      429,
    );
  } finally {
    await f.close();
  }
});
test("T06 concurrent old-password login cannot create a session after a reset", async () => {
  const f = await fixture();
  try {
    const u = await f.signup();
    const { hashPassword } = await import("../apps/server/src/auth.js");
    const replacement = await hashPassword("a newly changed password");
    let login: ReturnType<typeof f.request> | undefined;
    await f.db.transaction(async (tx) => {
      await tx
        .select()
        .from(users)
        .where(eq(users.id, u.user.id))
        .for("update");
      login = f.request("POST", "/api/auth/login", {
        email: u.email,
        password: "correct horse battery staple",
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      await tx
        .update(users)
        .set({ passwordHash: replacement })
        .where(eq(users.id, u.user.id));
      await tx.delete(sessions).where(eq(sessions.userId, u.user.id));
    });
    assert.equal((await login!).statusCode, 401);
    assert.equal((await f.db.select().from(sessions)).length, 0);
  } finally {
    await f.close();
  }
});

test("signup and recovery accept eight characters and reject seven", async () => {
  const f = await fixture();
  try {
    const short = await f.request("POST", "/api/auth/signup", { name: "Length test", email: "length@example.test", password: "1234567" });
    assert.equal(short.statusCode, 400);
    const created = await f.request("POST", "/api/auth/signup", { name: "Length test", email: "length@example.test", password: "Stash123" });
    assert.equal(created.statusCode, 201);
    assert.equal((await f.request("POST", "/api/auth/login", { email: "length@example.test", password: "Stash123" })).statusCode, 200);
    await f.request("POST", "/api/auth/forgot", { email: "length@example.test" });
    const token = f.token("reset", "length@example.test");
    assert.equal((await f.request("POST", "/api/auth/reset", { token, password: "1234567" })).statusCode, 400);
    assert.equal((await f.request("POST", "/api/auth/reset", { token, password: "Newpass8" })).statusCode, 200);
    assert.equal((await f.request("POST", "/api/auth/login", { email: "length@example.test", password: "Newpass8" })).statusCode, 200);
  } finally { await f.close(); }
});

test("email-disabled deployment allows private signup and keys without sending mail", async()=>{
 const f=await fixture();let sent=0;
 const { createApp }=await import('../apps/server/src/app.js');
 const app=await createApp(f.db,{emailDisabled:true,mailer:{async send(){sent++;}}});
 try {
  const r=await app.inject({method:'POST',url:'/api/auth/signup',headers:{origin:'http://127.0.0.1:3000'},payload:{name:'Deployment',email:'deployment@example.test',password:'Stash123'}});
  assert.equal(r.statusCode,201);assert.equal(r.json().user.emailEnabled,false);assert.equal(r.json().emailSent,false);assert.equal(sent,0);
  const cookie=r.headers['set-cookie']!.toString().split(';')[0];
  const me=await app.inject({method:'GET',url:'/api/me',headers:{cookie}});assert.equal(me.json().user.emailEnabled,false);
  assert.equal((await app.inject({method:'POST',url:'/api/keys',headers:{cookie,origin:'http://127.0.0.1:3000'},payload:{name:'Private agent'}})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/auth/forgot',headers:{origin:'http://127.0.0.1:3000'},payload:{email:'deployment@example.test'}})).statusCode,503);
  assert.equal(sent,0);
 } finally {await app.close();await f.close();}
});
