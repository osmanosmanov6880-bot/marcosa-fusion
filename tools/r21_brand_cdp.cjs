#!/usr/bin/env node
'use strict';
/* R21 real Chromium QA of seven branded pages and working Social Core.
   No external CDNs, no automated accounts, no fake HTTP services. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'dist'),SHOTS=path.join(ROOT,'qa-r21');
const manifest=JSON.parse(fs.readFileSync(path.join(DIST,'build-manifest.json'),'utf8'));
const ALLOW=new Set(Object.keys(manifest.files));
const pages=[
 ['index.html','gateway'],['social.html','social'],['cinema-pilot.html','cinema'],
 ['creator.html','creator'],['source-hub.html','atlas'],['stories.html','stories'],
 ['film-network.html','film-network']
];
const pause=ms=>new Promise(done=>setTimeout(done,ms));
function chrome(){
 for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  const result=spawnSync('which',[name],{encoding:'utf8'});
  if(result.status===0&&result.stdout.trim())return result.stdout.trim();
 }
 throw Error('CHROME_NOT_AVAILABLE');
}
function startServer(){
 return http.createServer((req,res)=>{
  let file;
  try{file=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/+/,'');}
  catch{res.writeHead(400);res.end();return;}
  if(!ALLOW.has(file)){res.writeHead(404);res.end();return;}
  try{
   const raw=fs.readFileSync(path.join(DIST,file));
   const type=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':
    file.endsWith('.svg')?'image/svg+xml':'text/html';
   res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
   res.end(raw);
  }catch{res.writeHead(404);res.end();}
 });
}
async function devtools(port){
 let page;
 for(let n=0;n<150;n++){
  try{const response=await fetch('http://127.0.0.1:'+port+'/json/list');
   page=(await response.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
   if(page)break;
  }catch{}
  await pause(80);
 }
 if(!page)throw Error('NO_DEBUGGER_PAGE');
 const ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(Error('CDP_CONNECT_TIMEOUT')),15000);
  ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});
  ws.addEventListener('error',()=>{clearTimeout(t);reject(Error('CDP_CONNECT_ERROR'));},{once:true});
 });
 let id=0;const jobs=new Map(),requests=[],errors=[];
 ws.addEventListener('message',event=>{
  let obj;try{obj=JSON.parse(String(event.data));}catch{return;}
  if(obj.method==='Network.requestWillBeSent')requests.push(obj.params?.request?.url||'');
  if(obj.method==='Runtime.exceptionThrown')
   errors.push(obj.params?.exceptionDetails?.exception?.description||obj.params?.exceptionDetails?.text||'JS_EXCEPTION');
  const job=jobs.get(obj.id);if(!job)return;
  jobs.delete(obj.id);clearTimeout(job.timer);
  if(obj.error)job.reject(Error('CDP '+job.method+': '+JSON.stringify(obj.error)));
  else job.resolve(obj.result);
 });
 function call(method,params={},ms=25000){
  return new Promise((resolve,reject)=>{
   const current=++id;
   const timer=setTimeout(()=>{jobs.delete(current);reject(Error('CDP_TIMEOUT '+method));},ms);
   jobs.set(current,{resolve,reject,timer,method});
   ws.send(JSON.stringify({id:current,method,params}));
  });
 }
 async function evalJS(expression,timeout=15000){
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true},timeout);
  if(result.exceptionDetails)throw Error('JS_EXCEPTION '+(result.exceptionDetails.exception?.description||result.exceptionDetails.text));
  return result.result?.value;
 }
 async function wait(expression,label){
  for(let n=0;n<160;n++){
   try{if(await evalJS(expression,5000))return;}catch{}
   await pause(75);
  }
  throw Error('NOT_READY '+label);
 }
 return{call,evalJS,wait,requests,errors,close:()=>ws.close()};
}
function inspectBrand(expected){
 const nav=document.querySelector('.m-world-bar');
 const logo=document.querySelector('.m-world-bar img');
 if(!nav||!logo||!logo.complete||!logo.naturalWidth)throw Error('MISSING_ORBITAL_LOGO');
 if(window.MarcosaBrand?.current!==expected)throw Error('MISSING_BRAND_WORLD_'+expected);
 if(document.documentElement.dataset.mWorld!==expected)throw Error('WRONG_PALETTE_SCOPE');
 if(nav.querySelectorAll('a[href]').length!==8)throw Error('WRONG_WORLD_COUNT');
 const active=nav.querySelectorAll('a[aria-current="page"]');
 if(active.length!==1||!active[0].getAttribute('href')?.endsWith(
   ({gateway:'index.html',social:'social.html',cinema:'cinema-pilot.html',
    creator:'creator.html',atlas:'source-hub.html',stories:'stories.html',
    'film-network':'film-network.html'})[expected]))throw Error('WRONG_ACTIVE_WORLD');
 if(!document.querySelector('.m-transition'))throw Error('MISSING_LOADING_ANIMATION');
 const css=getComputedStyle(document.documentElement);
 if(!css.getPropertyValue('--m-accent').trim())throw Error('MISSING_WORLD_ACCENT');
 const overflow=document.documentElement.scrollWidth-document.documentElement.clientWidth;
 if(overflow>6)throw Error('MOBILE_HORIZONTAL_OVERFLOW_'+expected+'_'+overflow);
 return {world:expected,width:document.documentElement.clientWidth,nav:nav.querySelectorAll('a').length,
  accent:css.getPropertyValue('--m-accent').trim(),horizontalOverflow:overflow};
}
function socialActions(){
 const $=id=>document.getElementById(id);
 if(window.MarcosaSocial?.localOnly!==true)throw Error('SOCIAL_BACKEND_MISREPRESENTED');
 const genre=document.querySelector('[data-so-filter="cinema"]');
 genre.click();
 if(Array.from(document.querySelectorAll('#so-cards article')).filter(x=>!x.hidden).length!==2)
  throw Error('SOCIAL_CINEMA_FILTER_FAILED');
 const search=$('so-search');
 search.value='Signal';search.dispatchEvent(new Event('input',{bubbles:true}));
 if(Array.from(document.querySelectorAll('#so-cards article')).filter(x=>!x.hidden).length!==1)
  throw Error('SOCIAL_SEARCH_FAILED');
 const save=document.querySelector('[data-so-save="signal"]');
 save.click();
 if(save.getAttribute('aria-pressed')!=='true'||!$('so-bookmark-summary').textContent.includes('SIGNAL WORLDS'))
  throw Error('SOCIAL_BOOKMARK_FAILED');
 const draft=$('so-draft-text');
 draft.value='Мой приватный тестовый черновик MARCOSA.';
 draft.dispatchEvent(new Event('input',{bubbles:true}));
 $('so-save-draft').click();
 if(!$('so-draft-status').textContent.includes('сохранён только в этом браузере'))
  throw Error('SOCIAL_DRAFT_SAVE_FAILED');
 if(!localStorage.getItem('marcosa-social-private-draft-v1'))throw Error('SOCIAL_DRAFT_NOT_PERSISTED');
 return {filter:'cinema',search:'Signal',saved:true,draftSaved:true,sourceCards:window.MarcosaSocial.sourceCardCount};
}
function socialClean(){
 const $=id=>document.getElementById(id);
 if(!$('so-draft-text').value.includes('тестовый черновик'))throw Error('SOCIAL_DRAFT_NOT_RESTORED');
 $('so-clear-draft').click();
 if(localStorage.getItem('marcosa-social-private-draft-v1'))throw Error('SOCIAL_DRAFT_DELETE_FAILED');
 const bookmark=document.querySelector('[data-so-save="signal"]');
 if(bookmark.getAttribute('aria-pressed')==='true')bookmark.click();
 return {draftCleared:true,bookmarksCleared:true};
}
async function main(){
 const binary=chrome(),web=startServer(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r21-'));
 let processChrome=null,cdp=null;
 try{
  await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(0,'127.0.0.1',resolve);});
  const webport=web.address().port,base='http://127.0.0.1:'+webport+'/',profile=path.join(tmp,'profile');
  processChrome=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],
   {stdio:['ignore','ignore','pipe']});
  let error='';processChrome.stderr.on('data',x=>{error=(error+String(x)).slice(-1400);});
  let port=0;
  for(let n=0;n<170;n++){
   const f=path.join(profile,'DevToolsActivePort');
   if(fs.existsSync(f)){port=Number(fs.readFileSync(f,'utf8').split(/\r?\n/)[0]);if(port)break;}
   if(processChrome.exitCode!==null)throw Error('BROWSER_CLOSED '+error);
   await pause(80);
  }
  if(!port)throw Error('NO_CHROME_PORT '+error);
  cdp=await devtools(port);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  fs.mkdirSync(SHOTS,{recursive:true});
  for(const d of [{name:'desktop',width:1440,height:900,mobile:false},
                  {name:'mobile',width:390,height:844,mobile:true}]){
   await cdp.call('Emulation.setDeviceMetricsOverride',
    {width:d.width,height:d.height,deviceScaleFactor:1,mobile:d.mobile});
   for(const [file,world] of pages){
    cdp.requests.length=0;cdp.errors.length=0;
    await cdp.call('Page.navigate',{url:base+file});
    await cdp.wait("document.readyState==='complete'&&!!window.MarcosaBrand&&document.documentElement.dataset.mWorld==="+JSON.stringify(world)+"&&!!document.querySelector('.m-world-bar img')?.naturalWidth",world);
    await pause(80);
    const summary=await cdp.evalJS('('+inspectBrand.toString()+')('+JSON.stringify(world)+')');
    if(['gateway','social','cinema','creator','atlas'].includes(world)){
     const capture=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     const data=Buffer.from(capture.data,'base64');
     if(data.length<10000||data.subarray(0,4).toString('hex')!=='89504e47')
      throw Error('SCREENSHOT_INVALID_'+world);
     fs.writeFileSync(path.join(SHOTS,'r21-'+d.name+'-'+world+'.png'),data);
    }
    if(world==='social'){
     const test=await cdp.evalJS('('+socialActions.toString()+')()');
     if(!test.saved||!test.draftSaved)throw Error('SOCIAL_INTERACTIVE_CONTROLS_FAILED');
     await cdp.call('Page.reload',{ignoreCache:true});
     await cdp.wait("document.readyState==='complete'&&!!window.MarcosaSocial",'social-restore');
     const clean=await cdp.evalJS('('+socialClean.toString()+')()');
     console.log('R21 '+d.name+' SOCIAL LOCAL TEST '+JSON.stringify({test,clean}));
    }
    const external=cdp.requests.filter(u=>/^https?:/.test(u)&&!u.startsWith(base));
    if(external.length)throw Error('EXTERNAL_REQUESTS_'+world+JSON.stringify(external));
    if(cdp.errors.length)throw Error('JS_ERRORS_'+world+JSON.stringify(cdp.errors.slice(0,3)));
    console.log('R21 '+d.name+' '+world+' PASS '+JSON.stringify(summary));
   }
   // Click a real global navigation link to verify a visible transition and actual page route.
   await cdp.call('Page.navigate',{url:base+'index.html'});
   await cdp.wait("document.readyState==='complete'&&!!window.MarcosaBrand",'transition-start');
   const nav=await cdp.evalJS("(()=>{document.querySelector('.m-world-bar a[href=\"./social.html\"]').click();return document.querySelector('.m-transition').dataset.active;})()");
   if(nav!=='true')throw Error('BRAND_NAVIGATION_DID_NOT_SHOW_TRANSITION');
   await cdp.wait("location.pathname.endsWith('/social.html')&&window.MarcosaBrand?.current==='social'",'transition-target');
   console.log('R21 '+d.name+' TRANSITION PASS: home -> social');
  }
  console.log('R21: PASS seven distinct branded routes, real navigation, responsive Social Core and no external network requests');
 }finally{
  if(cdp)try{cdp.close();}catch{}
  if(processChrome){
   const done=new Promise(resolve=>processChrome.once('exit',resolve));
   if(processChrome.exitCode===null)processChrome.kill('SIGTERM');
   await Promise.race([done,pause(2300)]);
   if(processChrome.exitCode===null)processChrome.kill('SIGKILL');
  }
  await new Promise(resolve=>web.close(resolve));
  await pause(300);
  try{fs.rmSync(tmp,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
  catch(e){console.warn('R21 disposable Chrome profile cleanup:',e.code||e.message);}
 }
}
main().catch(e=>{console.error('R21 BROWSER QA FAIL',e.stack||e);process.exitCode=1;});
