import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { pdf,pagedPdf,imageOnlyPdf } from "../pdf-fixture.js";
for(const width of [1440,375]) test(`Request, revisit and regenerate a cited PDF summary at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const signup=await page.request.post("/api/auth/signup",{headers:{origin:"http://127.0.0.1:3100"},data:{name:"Summary reader",email:`summary-${randomUUID()}@example.test`,password:"Research123"}});
  expect(signup.status()).toBe(201);
  await page.goto("/"); await page.getByRole("button",{name:"Add item",exact:true}).first().click();
  const form=page.getByRole("dialog"); await form.getByLabel("Type",{exact:true}).selectOption("pdf");
  await form.getByLabel("PDF file",{exact:true}).setInputFiles({name:"Filter research.pdf",mimeType:"application/pdf",buffer:pdf("Paper filters removed more sediment in the six-week trial.")});
  await form.getByRole("button",{name:"Save item",exact:true}).click();
  await page.getByRole("link",{name:"Filter research",exact:true}).click();
  const panel=page.getByRole("region",{name:"AI summary"});
  await expect(panel.getByRole("button",{name:"Summarise",exact:true})).toBeEnabled({timeout:20000});
  await expect(panel.getByText(/Sends source text to OpenRouter/)).toBeVisible();
  await panel.getByRole("button",{name:"Summarise",exact:true}).click();
  await expect(panel.getByRole("button",{name:"Regenerate",exact:true})).toBeVisible({timeout:20000});
  await expect(panel.locator(".summary-content > p").first()).toBeVisible();
  await panel.getByRole("button",{name:"Page 1",exact:true}).first().click();
  await expect(page.getByRole("heading",{name:"Page 1",exact:true})).toBeVisible();
  await panel.getByText("Source references",{exact:true}).click();
  await expect(panel.locator("blockquote").first()).toHaveText("Paper filters removed more sediment in the six-week trial.");
  await page.reload(); await expect(panel.getByRole("button",{name:"Regenerate",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Edit",exact:true}).click();
  await page.getByLabel("Why it matters").fill("My notes remain separate from the generated summary.");
  await page.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(panel.getByText("The source text changed since this summary was made.",{exact:true})).toHaveCount(0);
  const regenerated=page.waitForResponse(response=>response.url().endsWith("/summary")&&response.request().method()==="POST");
  await panel.getByRole("button",{name:"Regenerate",exact:true}).click();
  const job=await(await regenerated).json(),itemPath=new URL(page.url()).pathname;
  await expect.poll(async()=>{const current=await page.request.get(`/api${itemPath}/summary`);const body=await current.json();return {id:body.job?.id,state:body.job?.state};},{timeout:20000}).toEqual({id:job.id,state:"succeeded"});
  await expect(panel.getByRole("button",{name:"Regenerate",exact:true})).toBeVisible();
  await expect(panel.getByText("The source text changed since this summary was made.",{exact:true})).toHaveCount(0);
  await expect(page.getByText("My notes remain separate from the generated summary.",{exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`docs/evidence/library-v2/summary-${width}.png`,fullPage:true});
});


test("Long PDF summaries disclose partial coverage and scanned originals remain downloadable",async({page})=>{
 test.setTimeout(90000);const headers={origin:"http://127.0.0.1:3100"};expect((await page.request.post("/api/auth/signup",{headers,data:{name:"Source reviewer",email:`partial-${randomUUID()}@example.test`,password:"Research123"}})).status()).toBe(201);
 async function upload(name:string,bytes:Buffer){const ticket=(await(await page.request.post("/api/items/uploads",{headers,data:{filename:name,byteSize:bytes.length}})).json());const response=await page.request.post(ticket.uploadUrl,{headers:{...headers,authorization:`Bearer ${ticket.token}`,"content-type":"application/pdf"},data:bytes});expect(response.status()).toBe(200);return(await response.json()).item;}
 const long=await upload("Long source.pdf",pagedPdf(Array.from({length:30},(_,index)=>`Page ${index+1}. `+"This synthetic trial compares paper and cloth filters without establishing drinking water safety. ".repeat(15))));
 await page.goto(`/items/${long.id}`);const panel=page.getByRole("region",{name:"AI summary"});await expect(panel.getByRole("button",{name:"Summarise",exact:true})).toBeEnabled({timeout:25000});await panel.getByRole("button",{name:"Summarise",exact:true}).click();await expect(panel.getByText("Covers part of the source. Read the original for the full document.",{exact:true})).toBeVisible({timeout:25000});await panel.getByText("Source references",{exact:true}).click();await expect(panel.getByRole("heading",{name:"Page 1",exact:true})).toBeVisible();await page.screenshot({path:"docs/evidence/library-v2/summary-partial.png",fullPage:true});
 const scanned=await upload("Scanned source.pdf",imageOnlyPdf());await page.goto(`/items/${scanned.id}`);await expect(page.getByText("This PDF has no selectable text. Scanned documents need OCR, which is not supported yet.",{exact:true})).toBeVisible({timeout:25000});await expect(page.getByRole("button",{name:"Download PDF",exact:true})).toBeEnabled();await expect(panel.getByRole("button",{name:"Summarise",exact:true})).toBeDisabled();
 expect((await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
});
