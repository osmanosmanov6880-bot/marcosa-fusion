import {mkdtemp,mkdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../server-lab/server.mjs';
import {chromium} from 'playwright';

const app=createApp({inviteCode:'r151-browser-invite-1234'});
let browser;
const screenshots=process.env.MARCOSA_BROWSER_SCREENSHOTS||join(await mkdtemp(join(tmpdir(),'marcosa-browser-')),'screenshots');
await mkdir(screenshots,{recursive:true});
try{
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const fixtures=[
  {name:'desktop',width:1440,height:900,isMobile:false},
  {name:'mobile',width:390,height:844,isMobile:true},
  {name:'compact',width:360,height:740,isMobile:true}
 ];
 for(const f of fixtures){
  const context=await browser.newContext({viewport:{width:f.width,height:f.height},isMobile:f.isMobile,deviceScaleFactor:1});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  const response=await page.goto(base+'/series',{waitUntil:'domcontentloaded',timeout:15000});
  if(response.status()!==200)throw Error('Season catalog returned '+response.status());
  await page.getByRole('heading',{name:'Авторские сезоны'}).waitFor();
  const pageWidth=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  if(pageWidth>2)throw Error(f.name+' horizontal scroll '+pageWidth);
  await page.screenshot({path:join(screenshots,f.name+'-seasons.png'),fullPage:true});
  if(errors.length)throw Error(f.name+' JavaScript exceptions: '+errors.join('; '));
  const screenshot=await stat(join(screenshots,f.name+'-seasons.png'));
  if(screenshot.size<3000)throw Error(f.name+' screenshot too small');
  await context.close();
 }
 console.log('PASS: desktop, 390px and 360px browser catalog screenshots');
}finally{
 if(browser)await browser.close();
 await app.close();
}
