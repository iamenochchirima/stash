import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
test('Authenticated refresh serves the library without rendering the public landing page',async({page})=>{
 expect(await(await page.request.get('/')).text()).toContain('class="site-hero');
 const signup=await page.request.post('/api/auth/signup',{headers:{origin:'http://127.0.0.1:3100'},data:{name:'Route reader',email:`routes-${randomUUID()}@example.test`,password:'Research123'}});expect(signup.status()).toBe(201);
 const response=await page.request.get('/');expect(response.ok()).toBe(true);const html=await response.text();
 expect(html).not.toContain('class="site-hero');
 await page.goto('/');await expect(page.getByRole('button',{name:'Add item',exact:true}).first()).toBeVisible();await page.reload();await expect(page.locator('.site-hero')).toHaveCount(0);
});
test('Workspace pages have durable routes, refresh cleanly and preserve library navigation',async({page})=>{
 await page.request.post('/api/auth/signup',{headers:{origin:'http://127.0.0.1:3100'},data:{name:'Route navigator',email:`routes-${randomUUID()}@example.test`,password:'Research123'}});
 await page.goto('/library');await page.getByLabel('Search your library').fill('retained research');await expect(page).toHaveURL(/\/library\?q=retained\+research/);
 await page.getByRole('link',{name:'Agent connections',exact:true}).click();await expect(page).toHaveURL(/\/connections$/);await page.reload();await expect(page.getByRole('heading',{name:'Agent connections',exact:true})).toBeVisible();await expect(page.locator('.site-hero')).toHaveCount(0);await expect(page.locator('.copy-field code')).toContainText('/mcp');await page.screenshot({path:'docs/evidence/routing/connections-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Open profile',exact:true}).click();await expect(page).toHaveURL(/\/profile$/);await page.reload();await expect(page.getByRole('heading',{name:'Profile',exact:true})).toBeVisible();await page.setViewportSize({width:375,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/evidence/routing/profile-mobile.png',fullPage:true});
 await page.goBack();await expect(page).toHaveURL(/\/connections$/);await page.goBack();await expect(page.getByLabel('Search your library')).toHaveValue('retained research');
 for(const route of ['favourites','archive','trash']){await page.goto(`/library/${route}`);await page.reload();await expect(page).toHaveURL(new RegExp(`/library/${route}$`));await expect(page.locator('.site-hero')).toHaveCount(0);}
 const profileResponse=await page.request.get('/profile');expect(profileResponse.headers()['cache-control']).toContain('no-store');const html=await profileResponse.text();expect(html).not.toContain('class="site-hero');expect(html).toContain('Route navigator');
 await page.request.post('/api/auth/logout',{headers:{origin:'http://127.0.0.1:3100'},data:{}});await page.goto('/connections');await expect(page).toHaveURL(/\/signin\?next=%2Fconnections$/);
});
