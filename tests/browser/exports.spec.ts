import { test,expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
test("Bookmark omissions, private JSON download and URL-free agent help",async({page})=>{
 await page.setViewportSize({width:375,height:1000});
 const headers={origin:"http://127.0.0.1:3100"};const signup=await page.request.post("/api/auth/signup",{headers,data:{name:"Export reader",email:`exports-${randomUUID()}@example.test`,password:"Research123"}});expect(signup.status()).toBe(201);
 expect((await page.request.post("/api/items",{headers,data:{kind:"link",url:"https://example.test/reading",title:"Useful source"}})).status()).toBe(200);
 expect((await page.request.post("/api/items",{headers,data:{kind:"idea",body:"This idea stays out of bookmark files"}})).status()).toBe(200);
 await page.goto("/");await page.getByRole("button",{name:"Import / export",exact:true}).click();const dialog=page.getByRole("dialog");
 await dialog.getByRole("button",{name:"Export bookmarks",exact:true}).click();await expect(dialog.getByText("1 link · 1 other item omitted",{exact:true})).toBeVisible();
 let promise=page.waitForEvent("download");await dialog.getByRole("button",{name:"Download bookmarks",exact:true}).click();let download=await promise;expect(download.suggestedFilename()).toBe("stash-bookmarks.html");const html=await readFile((await download.path())!,"utf8");expect(html).toContain("https://example.test/reading");expect(html).toContain("1 other item omitted");expect(html).not.toContain("This idea stays out");
 await expect(dialog.getByText("Your bookmarks have downloaded.",{exact:true})).toBeVisible();
 promise=page.waitForEvent("download");await dialog.getByRole("button",{name:"Export data only",exact:true}).click();download=await promise;expect(download.suggestedFilename()).toBe("stash-export.json");const data=JSON.parse(await readFile((await download.path())!,"utf8"));expect(data.items).toHaveLength(2);expect(data.items.some((i:{body:string})=>i.body==="This idea stays out of bookmark files")).toBe(true);
 expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:"docs/evidence/library-v2/export-options-375.png",fullPage:true});
 await dialog.getByRole("button",{name:"Close dialog",exact:true}).click();await page.goto("/help");await expect(page.getByRole("heading",{name:"Save and find things in conversation",exact:true})).toBeVisible();await expect(page.getByText(/You can save a note or idea without a link/)).toBeVisible();
});
