import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
if (process.env.STASH_HOSTED_ACCEPTANCE !== "true") throw Error("Explicit hosted acceptance flag required");
const origin="https://stash.kasitek.co.za", headers={origin}, password=randomBytes(24).toString("base64url");
const browser=await chromium.launch(), context=await browser.newContext(), page=await context.newPage();
const report:Record<string,unknown>={checkedAt:new Date().toISOString(),passed:false};
let created=false, stage="signup";
async function json(response:any,status=200){expect(response.status()).toBe(status);return response.json();}
try {
  await json(await context.request.post(`${origin}/api/auth/signup`,{headers,data:{name:"Activity acceptance",email:`delivered+stash-activity-${randomUUID()}@resend.dev`,password}}),201);
  created=true;
  stage="project-and-item-order";
  const older=(await json(await context.request.post(`${origin}/api/projects`,{headers,data:{name:"Earlier research"}}))).project;
  const newer=(await json(await context.request.post(`${origin}/api/projects`,{headers,data:{name:"Later research"}}))).project;
  const first=(await json(await context.request.post(`${origin}/api/items`,{headers,data:{kind:"note",title:"First finding",body:"Synthetic early finding",projectId:older.id}}))).item;
  await json(await context.request.post(`${origin}/api/items`,{headers,data:{kind:"note",title:"Second finding",body:"Synthetic later finding",projectId:older.id}}));
  await json(await context.request.patch(`${origin}/api/projects/${newer.id}`,{headers,data:{revision:1,description:"Synthetic later project update"}}));
  expect((await json(await context.request.get(`${origin}/api/projects`))).items[0].id).toBe(newer.id);
  const edited=(await json(await context.request.patch(`${origin}/api/items/${first.id}`,{headers,data:{revision:1,body:"Synthetic revised finding"}}))).item;
  const projects=(await json(await context.request.get(`${origin}/api/projects`))).items;
  expect(projects[0].id).toBe(older.id);expect(projects[0].revision).toBe(1);
  expect((await json(await context.request.get(`${origin}/api/items?projectId=${older.id}`))).items[0].id).toBe(first.id);
  const library=(await json(await context.request.post(`${origin}/api/items`,{headers,data:{kind:"idea",title:"Synthetic library idea",body:"Synthetic reusable idea"}}))).item;
  await json(await context.request.post(`${origin}/api/items`,{headers,data:{kind:"note",title:"Synthetic later note",body:"Synthetic note"}}));
  await json(await context.request.patch(`${origin}/api/items/${library.id}`,{headers,data:{revision:1,body:"Synthetic revised idea"}}));
  expect((await json(await context.request.get(`${origin}/api/items`))).items[0].id).toBe(library.id);
  report.latestProjectAndItemOrdering=true;
  await mkdir("docs/evidence/activity",{recursive:true});
  for(const width of [1440,375]) {
    stage=`live-layout-${width}`;
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:width===375?"dark":"light"});await page.goto(`${origin}/projects`);
    await expect(page.locator(".project-card").first()).toContainText("Earlier research");
    await expect(page.locator(".project-card").first().locator("time")).toContainText(/Updated \d+ (sec|min) ago/);
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`docs/evidence/activity/hosted-projects-${width}.png`,fullPage:true});
    await page.locator(".project-card").first().click();
    await expect(page.locator(".project-item").first()).toContainText("First finding");
    const stamp=page.locator(".project-item").first().locator("time");
    await expect(stamp).toHaveAttribute("datetime",edited.updatedAt);
    await expect(stamp).toContainText(/Updated \d+ (sec|min) ago/);
    if(width===1440){const previous=await stamp.innerText();await expect.poll(()=>stamp.innerText(),{timeout:65000}).not.toBe(previous);}
    expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`docs/evidence/activity/hosted-items-${width}.png`,fullPage:true});
    await page.goto(`${origin}/items/${first.id}`);await expect(page.locator(".item-meta time")).toContainText("Updated");
    await page.goto(`${origin}/library`);await expect(page.locator(".resource-card").first()).toContainText("Synthetic library idea");
    await expect(page.locator(".resource-card").first().locator("time")).toContainText("Updated");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    report[`${width}px`]={timestamps:true,projectOrder:true,itemOrder:true,axe:true,noOverflow:true};
  }
  report.passed=true;
} catch(error) {report.failedStage=stage;report.errorType=(error as Error).name;process.exitCode=1;}
finally {
  if(created){try{report.disposableAccountDeleted=(await context.request.delete(`${origin}/api/me`,{headers,data:{password,confirmation:"DELETE"}})).status()===200;}catch{report.disposableAccountDeleted=false;}}
  if(!report.disposableAccountDeleted){report.passed=false;process.exitCode=1;}
  await context.close();await browser.close();await mkdir("docs/evidence/activity",{recursive:true});
  await writeFile("docs/evidence/activity/hosted.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
}
