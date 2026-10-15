import { test,expect,type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
const headers={origin:"http://127.0.0.1:3100"};
async function signup(page:Page){const email=`draft-${randomUUID()}@example.test`,response=await page.request.post("/api/auth/signup",{headers,data:{name:"Draft researcher",email,password:"Research123"}});expect(response.status()).toBe(201);return(await response.json()).user;}
async function editor(page:Page){await page.getByRole("button",{name:"Add item",exact:true}).first().click();return page.getByRole("dialog");}
async function draftKeys(page:Page){return page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith("stash-draft:")));}

test("Capture drafts survive close/reopen, discard explicitly and save with a deterministic title",async({page})=>{
 await page.setViewportSize({width:375,height:1000});await signup(page);await page.goto("/");let form=await editor(page);
 await form.getByLabel("Type",{exact:true}).selectOption("note");await form.getByLabel("Content",{exact:true}).fill("Unsaved note to revisit");await form.getByLabel("Why it matters").fill("Important context");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await form.getByRole("button",{name:"Close dialog",exact:true}).click();form=await editor(page);await expect(form.getByLabel("Content",{exact:true})).toHaveValue("Unsaved note to revisit");await expect(form.getByLabel("Why it matters")).toHaveValue("Important context");
 page.once("dialog",dialog=>dialog.accept());await form.getByRole("button",{name:"Discard draft",exact:true}).click();await expect(form.getByLabel("Type",{exact:true})).toHaveValue("link");await expect.poll(()=>draftKeys(page)).toEqual([]);
 await form.getByLabel("Type",{exact:true}).selectOption("idea");await form.getByLabel("Content",{exact:true}).fill("# A useful next step\n\nKeep all the context.");await form.getByRole("button",{name:"Save item",exact:true}).click();await page.getByRole("link",{name:"A useful next step",exact:true}).click();await expect(page.locator(".item-markdown")).toContainText("Keep all the context.");await expect.poll(()=>draftKeys(page)).toEqual([]);
 await page.getByRole("button",{name:"Edit",exact:true}).click();await page.getByLabel("Content",{exact:true}).fill("A draft after refresh");page.once("dialog",dialog=>dialog.accept());await page.reload();await page.getByRole("button",{name:"Edit",exact:true}).click();await expect(page.getByLabel("Content",{exact:true})).toHaveValue("A draft after refresh");
 page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Discard draft",exact:true}).click();await expect(page.getByLabel("Content",{exact:true})).toHaveValue("# A useful next step\n\nKeep all the context.");
 expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("Conflict review preserves typed changes and shows the latest saved context before retry",async({page})=>{
 await signup(page);const created=await page.request.post("/api/items",{headers,data:{kind:"idea",title:"Conflict example",body:"Initial body",notes:"Initial context"}});const item=(await created.json()).item;
 await page.goto(`/items/${item.id}`);await page.getByRole("button",{name:"Edit",exact:true}).click();await page.getByLabel("Content",{exact:true}).fill("My typed changes stay here");await page.getByLabel("Why it matters").fill("My unsaved context");
 expect((await page.request.patch(`/api/items/${item.id}`,{headers,data:{revision:item.revision,body:"Another agent's saved body",notes:"Another agent's saved context",tags:["latest"]}})).status()).toBe(200);
 await page.getByRole("button",{name:"Save changes",exact:true}).click();await expect(page.locator("form").getByRole("alert")).toBeVisible();await expect(page.getByLabel("Content",{exact:true})).toHaveValue("My typed changes stay here");
 await page.getByRole("button",{name:"Review latest version",exact:true}).click();const review=page.locator(".edit-conflict");await expect(review.getByText("Another agent's saved body",{exact:true})).toBeVisible();await expect(review.getByText("Another agent's saved context",{exact:false})).toBeVisible();await expect(review.getByText("Tags: latest",{exact:true})).toBeVisible();
 await page.screenshot({path:"docs/evidence/library-v2/edit-conflict.png",fullPage:true});await page.getByRole("button",{name:"Use this revision for my next save",exact:true}).click();await page.getByRole("button",{name:"Save changes",exact:true}).click();await page.reload();await expect(page.locator(".item-markdown")).toContainText("My typed changes stay here");await expect(page.getByText("My unsaved context",{exact:true})).toBeVisible();await expect.poll(()=>draftKeys(page)).toEqual([]);
});

test("An old editor cannot save its draft into a newly signed-in account",async({page})=>{
 await signup(page);await page.goto("/");const form=await editor(page);await form.getByLabel("Type",{exact:true}).selectOption("note");await form.getByLabel("Content",{exact:true}).fill("Account A private draft");
 await signup(page);await form.getByRole("button",{name:"Save item",exact:true}).click();await expect(form.getByRole("alert")).toContainText("account changed");await expect(form.getByLabel("Content",{exact:true})).toHaveValue("Account A private draft");expect((await(await page.request.get("/api/items")).json()).total).toBe(0);
 page.once("dialog",dialog=>dialog.accept());await page.reload();await expect(page.getByRole("button",{name:"Add item",exact:true}).first()).toBeVisible();await expect.poll(()=>draftKeys(page)).toEqual([]);
});

for(const ending of["signout","delete"])test(`Session ${ending} clears drafts and private editors in other tabs without a discard prompt`,async({page,context})=>{
 await signup(page);await page.goto("/");const form=await editor(page);await form.getByLabel("Type",{exact:true}).selectOption("idea");await form.getByLabel("Content",{exact:true}).fill("A draft in the first tab");
 const other=await context.newPage();await other.goto("/");const second=await editor(other);await second.getByLabel("Type",{exact:true}).selectOption("note");await second.getByLabel("Content",{exact:true}).fill("Another draft in the same account");await second.getByRole("button",{name:"Close dialog",exact:true}).click();
 await other.getByRole("link",{name:"Open profile",exact:true}).click();
 if(ending==="signout")await other.getByRole("button",{name:"Sign out",exact:true}).click();
 else{await other.getByRole("button",{name:"Delete account",exact:true}).click();await other.getByLabel("Current password",{exact:true}).fill("Research123");await other.getByLabel("Type DELETE to confirm",{exact:true}).fill("DELETE");await other.getByRole("button",{name:"Permanently delete account",exact:true}).click();}
 await expect(page).toHaveURL(/\/signin$/);await expect(page.getByLabel("Email address",{exact:true})).toBeVisible();await expect.poll(()=>draftKeys(page)).toEqual([]);expect(await draftKeys(other)).toEqual([]);await other.close();
});

test("A full browser draft store warns honestly and still saves the entered item",async({page})=>{
 await signup(page);await page.goto("/");const form=await editor(page);await form.getByLabel("Type",{exact:true}).selectOption("note");
 await page.evaluate(()=>{for(let i=0;i<20;i++)try{sessionStorage.setItem(`quota-large-${i}`,"x".repeat(500000));}catch{break;}for(let i=0;i<1000;i++)try{sessionStorage.setItem(`quota-small-${i}`,"x".repeat(1000));}catch{break;}});
 const body="A recoverable note. ".repeat(300);await form.getByLabel("Content",{exact:true}).fill(body);await expect(form.getByText("Draft storage is unavailable. Keep this editor open until you save.",{exact:true})).toBeVisible();await expect(form.getByLabel("Content",{exact:true})).toHaveValue(body);
 await form.getByRole("button",{name:"Save item",exact:true}).click();await expect(form).toHaveCount(0);const saved=(await(await page.request.get("/api/items")).json()).items;expect(saved).toHaveLength(1);const detail=(await(await page.request.get(`/api/items/${saved[0].id}`)).json()).item;expect(detail.body).toBe(body.trim());
});
