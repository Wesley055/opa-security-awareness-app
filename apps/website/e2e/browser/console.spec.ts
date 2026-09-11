import {test,expect} from '@playwright/test';
import path from 'node:path';
const facility='11111111-1111-4111-8111-111111111111',incident='44444444-4444-4444-8444-444444444444';
const pages=[['queue','FACILITY_OPERATOR','/operator','Active incidents'],['incident-detail','FACILITY_OPERATOR','/operator/incidents/'+incident,'[protected] [protected]'],['members','FACILITY_OPERATOR','/operator/members','Facility membership'],['residents','FACILITY_ADMIN','/operator/residents','Residents'],['super-admin','ADMIN','/super-admin','Facility directory'],['facility-detail','ADMIN','/super-admin?facilityId='+facility,'Fixture Facility — browser validation only'],['reports','FACILITY_OPERATOR','/operator/reports','Reports / Analytics'],['enrollment','FACILITY_OPERATOR','/enroll','Accept your OPA invitation']] as const;
for(const [name,role,url,heading] of pages)test(name+' responsive and accessible',async({page,context},testInfo)=>{
 await context.addCookies([{name:role==='ADMIN'?'opa_super_admin_access':'opa_operator_access',value:'fixture.'+role,domain:'localhost',path:'/'}]);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(url);await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 if(name==='residents'){await page.getByRole('button',{name:'Bulk add',exact:true}).click();await expect(page.getByLabel('Residents to invite')).toBeVisible();}
 if(name==='incident-detail'){await expect(page.getByRole('button',{name:'Download verified evidence'})).toBeEnabled();await page.getByRole('button',{name:'Download verified evidence'}).click();await expect(page.getByText('Evidence download is unavailable. Retry to request fresh access.')).toBeVisible();}
 await page.addScriptTag({path:path.resolve('node_modules/axe-core/axe.min.js')});
 const violations=await page.evaluate(async()=>{const engine=(window as unknown as {axe:{run:(node:Document,options:unknown)=>Promise<{violations:{id:string;impact:string;nodes:{target:string[]}[]}[]}>}}).axe;return(await engine.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}})).violations;});
 await testInfo.attach('axe-results',{body:JSON.stringify(violations,null,2),contentType:'application/json'});
 expect(violations).toEqual([]);expect(errors).toEqual([]);
 await page.evaluate(() => window.scrollTo(0, 0));
 await page.screenshot({path:testInfo.outputPath(name+'.png'),fullPage:true});
});
test('keyboard navigation and fixture sign-in',async({page})=>{await page.goto('/operator/login?reason=session-ended');await page.getByLabel('Email',{exact:true}).fill('operator@fixture.test');await page.getByLabel('Password',{exact:true}).fill('FixturePassword123!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Active incidents'})).toBeVisible();await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'Skip to main content'})).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#console-main')).toBeFocused();});
test('unauthenticated route protection',async({page})=>{await page.goto('/super-admin');await expect(page).toHaveURL(/super-admin\/login/);await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();});
