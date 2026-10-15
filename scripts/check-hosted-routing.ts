// Hosted routing acceptance uses one disposable account and synthetic note only.
import {chromium,expect} from '@playwright/test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
if(process.env.STASH_HOSTED_ACCEPTANCE!=='true')throw Error('Explicit hosted acceptance flag required');
const origin='https://stash.kasitek.co.za',headers={origin},password=randomBytes(24).toString('base64url');
const browser=await chromium.launch(),context=await browser.newContext(),page=await context.newPage();
const report:Record<string,unknown>={checkedAt:new Date().toISOString(),passed:false,fixture:'One labelled Resend test recipient and a synthetic note'};let created=false,stage='public home';
async function json(response:any,status=200){expect(response.status()).toBe(status);return response.json();}
try{
 expect(await(await context.request.get(origin)).text()).toContain('class="site-hero');
 stage='signup';await json(await context.request.post(`${origin}/api/auth/signup`,{headers,data:{name:'Hosted route reader',email:`delivered+stash-routes-${randomUUID()}@resend.dev`,password}}),201);created=true;
 const saved=await json(await context.request.post(`${origin}/api/items`,{headers,data:{kind:'note',title:'Route verification',body:'Synthetic content for refresh and account separation checks.'}}));
 stage='authenticated HTML';const html=await(await context.request.get(origin)).text();expect(html).not.toContain('class="site-hero');report.noPublicHeroInAuthenticatedHtml=true;
 await page.addInitScript(()=>{(window as any).__stashHeroSeen=false;new MutationObserver(()=>{if(document.querySelector('.site-hero'))(window as any).__stashHeroSeen=true;}).observe(document,{subtree:true,childList:true});});
 const routes=['/library','/connections','/profile','/library/favourites','/library/archive','/library/trash',`/items/${saved.item.id}`];
 for(const route of routes){stage=route.startsWith('/items/')?'item refresh':route;await page.goto(origin+route);await expect(page.locator('main')).toBeVisible();await page.reload();await expect(page.locator('main')).toBeVisible();await expect(page.locator('.site-hero')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__stashHeroSeen)).toBe(false);expect(new URL(page.url()).pathname).toBe(route);}
 report.directRoutesAndRefresh=true;
 stage='profile ownership and caching';const profile=await context.request.get(`${origin}/profile`);expect(profile.headers()['cache-control']).toContain('no-store');expect(await profile.text()).toContain('Hosted route reader');report.privateHtmlNoStore=true;
 stage='library card';await page.goto(origin+'/library');await page.getByRole('link',{name:'Route verification',exact:true}).click();await expect(page).toHaveURL(url=>url.pathname===`/items/${saved.item.id}`);await expect(page.getByText('Synthetic content for refresh and account separation checks.',{exact:true})).toBeVisible();report.cardNavigation=true;
 await page.goto(origin+'/connections');await expect(page.locator('.copy-field code')).toContainText('https://api.stash.kasitek.co.za/mcp');await page.screenshot({path:'docs/evidence/routing/hosted-connections.png',fullPage:true});
 await page.setViewportSize({width:375,height:1000});await page.goto(origin+'/library');await expect(page.getByRole('link',{name:'Route verification',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/evidence/routing/hosted-library-mobile.png',fullPage:true});report.mobileOverflow=false;
 stage='account deletion';await json(await context.request.delete(`${origin}/api/me`,{headers,data:{password,confirmation:'DELETE'}}));created=false;report.disposableAccountDeleted=true;
 await page.goto(origin+'/profile');await expect(page).toHaveURL(/\/signin\?next=%2Fprofile$/);report.unauthenticatedReturnPath=true;report.passed=true;
}catch{report.failedAt=stage;process.exitCode=1;}
finally{if(created){try{report.disposableAccountDeleted=(await context.request.delete(`${origin}/api/me`,{headers,data:{password,confirmation:'DELETE'}})).status()===200;}catch{report.disposableAccountDeleted=false;}}await context.close();await browser.close();await mkdir('docs/evidence/routing',{recursive:true});await writeFile('docs/evidence/routing/hosted-routing.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.disposableAccountDeleted)process.exitCode=1;}
