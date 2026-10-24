#!/usr/bin/env node
'use strict';
/* R25 real Chromium QA of seven branded pages and working Social Core.
   No external CDNs, no automated accounts, no fake HTTP services. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'dist'),SHOTS=path.join(ROOT,'qa-r25');
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
   const type=file.endsWith('.webp')?'image/webp':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':
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
 if(window.innerWidth<=720){
   const usable=Array.from(nav.querySelectorAll('.m-world-label')).filter(x=>getComputedStyle(x).display!=='none');
   if(usable.length<5||usable[0].getBoundingClientRect().height<8)
    throw Error('R25_MOBILE_NAV_HAS_ICONS_WITHOUT_TEXT');
 }

 const art={gateway:'visual-city.webp',social:'visual-cascade.webp',cinema:'visual-hero.webp',
            creator:'visual-archive.webp',atlas:'visual-control.webp',
            stories:'visual-city.webp','film-network':'visual-earthrise.webp'}[expected];
 const resources=performance.getEntriesByType('resource').map(x=>x.name);
 if(!resources.some(u=>u.endsWith('/'+art)))throw Error('R25_SOURCE_BACKED_ARTWORK_NOT_LOADED_'+expected+'_'+art);
 if(expected==='gateway'){
   const oldHome=document.querySelector('.q23-home');
   const livePanel=document.querySelector('.m22-experience');
   const command=document.querySelector('.m22-command');
   const heading=document.getElementById('m22-hero-title');
   const art=document.querySelector('.m22-artwork');
   const search=document.getElementById('m22-world-search');
   const shortcuts=document.querySelector('.m24-community');
   if(!oldHome||!livePanel||!command||!heading||!art||!search||!shortcuts||!window.MarcosaGateway?.hasRealLinks)
    throw Error('R25_LIVE_APP_SHELL_MISSING');
   if(getComputedStyle(oldHome).display!=='none')
    throw Error('R25_REJECTED_WHITE_EDITORIAL_VISIBLE');
   if(getComputedStyle(livePanel).display==='none')
    throw Error('R25_APPROVED_REFERENCE_GATEWAY_HIDDEN');
   if(parseFloat(getComputedStyle(heading).fontSize)<59)
    throw Error('R25_MAIN_HEADING_TOO_SMALL');
   if(!getComputedStyle(art).backgroundImage.includes('visual-city.webp'))
    throw Error('R25_REAL_ARCHITECTURAL_HERO_MISSING');
   const area=command.getBoundingClientRect();
   if(window.innerWidth>1100&&area.width<window.innerWidth*.80)
    throw Error('R25_MAIN_REFERENCE_APP_TOO_NARROW');
   if(!shortcuts.querySelector('a[href="./social.html?view=saved#so-feed"]'))
    throw Error('R25_SOCIAL_SAVED_DEEP_LINK_MISSING');
   search.value='cinema';
   search.dispatchEvent(new Event('input',{bubbles:true}));
   if(document.querySelectorAll('.m22-feature:not([hidden])').length!==1)
    throw Error('R25_REAL_FEATURED_WORLD_SEARCH_FAILED');
   search.value='';
   search.dispatchEvent(new Event('input',{bubbles:true}));
   if(document.querySelectorAll('.m22-feature:not([hidden])').length!==4)
    throw Error('R25_FEATURED_WORLD_SEARCH_RESET_FAILED');
   if(getComputedStyle(document.body).backgroundColor==='rgb(243, 240, 233)')
    throw Error('R25_LIGHT_BACKGROUND_HAS_RETURNED');
 
   if(window.innerWidth<=720){
    const menuButton=document.querySelector('.mi-header button[data-mn-open]');
    if(!menuButton)throw Error('R25_NATIVE_CATALOGUE_BUTTON_MISSING');
    const rect=menuButton.getBoundingClientRect();
    if(rect.left<0||rect.right>document.documentElement.clientWidth-3||rect.width<90||
       getComputedStyle(menuButton).display==='none')
     throw Error('R25_MOBILE_CATALOGUE_BUTTON_CLIPPED_'+JSON.stringify({left:rect.left,right:rect.right,width:rect.width}));
   }
   // R25: a working, accessible, source-backed three-frame director's scene.
   const director=window.MarcosaDirector;
   if(!director||director.edition!=='R25'||director.sceneCount!==3||!director.localOnly)
    throw Error('R25_DIRECTOR_JS_NOT_RUNNING');
   const chooser=document.getElementById('m25-scene-chooser');
   const controls=Array.from(chooser?.querySelectorAll('button[data-m25-scene]')||[]);
   const stills=Array.from(document.querySelectorAll('.m25-visual[data-m25-visual]'));
   if(!chooser||controls.length!==3||stills.length!==3)
    throw Error('R25_INTERACTIVE_FRAMES_NOT_PRESENT');
   if(getComputedStyle(chooser).display==='none')
    throw Error('R25_INTERACTIVE_CINEMA_HIDDEN');
   if(!getComputedStyle(stills[0]).backgroundImage.includes('visual-city-director.webp'))
    throw Error('R25_DIRECTOR_CINEMATIC_GRADE_NOT_APPLIED');
   controls[1].click();
   if(director.activeScene!=='cinema'||controls[1].getAttribute('aria-pressed')!=='true'||
      !stills[1].classList.contains('is-active'))
    throw Error('R25_CINEMATIC_SCENE_SWITCH_FAILED');
   controls[2].click();
   if(director.activeScene!=='studio'||!stills[2].classList.contains('is-active'))
    throw Error('R25_STUDIO_SCENE_SWITCH_FAILED');
   controls[0].focus();
   controls[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
   if(director.activeScene!=='cinema')throw Error('R25_KEYBOARD_SCENE_SWITCH_FAILED');
   controls[0].click();
   if(director.activeScene!=='city'||controls[0].getAttribute('aria-pressed')!=='true')
    throw Error('R25_SCENE_RESET_BROKEN');

 }
 if(expected==='social'){
   const heading=document.getElementById('so-main-title');
   const shell=document.querySelector('.so-shell');
   const art=document.querySelector('.so-art');
   if(!heading||!shell||!art||parseFloat(getComputedStyle(heading).fontSize)<44)
    throw Error('R25_REAL_DARK_SOCIAL_EDITION_MISSING');
   if(getComputedStyle(shell).backgroundColor!=='rgb(9, 13, 24)')
    throw Error('R25_SOCIAL_NOT_DARK_NAVY');
   if(!getComputedStyle(art).backgroundImage.includes('visual-cascade-director.webp'))
    throw Error('R25_SOCIAL_NOT_USING_SOURCE_GRADE');
   if(!getComputedStyle(art).backgroundImage.includes('visual-cascade.webp'))
    throw Error('R25_SOCIAL_ORIGINAL_VISUAL_MISSING');
   // R26: the product feed must be visible soon after a compact hero.
   const quick=document.querySelector('nav.s26-quick');
   const quickSaved=document.getElementById('so-saved-count');
   const cards=document.getElementById('so-cards');
   const feed=document.getElementById('so-feed');
   const hero=document.querySelector('.so-hero');
   if(!quick||!quickSaved||!cards||!feed||!hero)
    throw Error('R26_SOCIAL_QUICK_WORKSPACE_MISSING');
   if(quick.querySelectorAll('a[href]').length!==3)
    throw Error('R26_QUICK_NAV_ACTIONS_MISSING');
   if(!quick.querySelector('a[href="./social.html?view=saved#so-feed"]'))
    throw Error('R26_SAVED_DEEP_LINK_MISSING');
   const heroRect=hero.getBoundingClientRect();
   if(window.innerWidth>=1121&&heroRect.height>420)
    throw Error('R26_DESKTOP_SOCIAL_HERO_TOO_TALL_'+heroRect.height);
   if(window.innerWidth<=720&&heroRect.height>580)
    throw Error('R26_MOBILE_SOCIAL_HERO_TOO_TALL_'+heroRect.height);
   const cols=getComputedStyle(cards).gridTemplateColumns.split(/\s+/).filter(Boolean).length;
   if(window.innerWidth>=1301&&cols!==2)
    throw Error('R26_DESKTOP_FEED_NOT_TWO_COLUMN');
   if(window.innerWidth<=720&&cols!==1)
    throw Error('R26_MOBILE_FEED_NOT_SINGLE_COLUMN');
   if(!getComputedStyle(document.querySelector('.so-card--cinema .so-cover')).backgroundImage.includes('visual-hero-director.webp'))
    throw Error('R26_REAL_FILM_COVER_MISSING');
   if(window.innerWidth<=720){
    const opacity=Number(getComputedStyle(art).opacity);
    if(opacity<.50)throw Error('R25_MOBILE_SOCIAL_VISUAL_TOO_DIM');
    const buttons=Array.from(document.querySelectorAll('.so-hero-actions a'));
    if(buttons.length!==2||Math.abs(buttons[0].getBoundingClientRect().top-buttons[1].getBoundingClientRect().top)>5)
      throw Error('R25_MOBILE_SOCIAL_ACTIONS_NOT_SIDE_BY_SIDE');
   }
   if(window.innerWidth>=1121){
    const box=document.querySelector('.so-hero').getBoundingClientRect();
    const image=art.getBoundingClientRect();
    if(image.left<box.left+box.width*.43||image.width<box.width*.3)
      throw Error('R25_DESKTOP_SOCIAL_IMAGE_LAYOUT_BROKEN');
   }
 }

 const type=getComputedStyle(document.body).fontFamily;
 if(!type.includes('Aptos')&&!type.includes('Segoe'))throw Error('R25_APP_BODY_NOT_READABLE');

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
 if(save.getAttribute('aria-pressed')!=='true'||!$('so-bookmark-summary').textContent.includes('SIGNAL WORLDS')||$('so-saved-count').textContent!=='1')
  throw Error('SOCIAL_BOOKMARK_FAILED');
 document.querySelector('[data-so-filter="saved"]').click();
 if(Array.from(document.querySelectorAll('#so-cards article')).filter(x=>!x.hidden).length!==1)
  throw Error('R25_SAVED_ONLY_FEED_FAILED');
 const draft=$('so-draft-text');
 draft.value='Мой приватный тестовый черновик MARCOSA.';
 draft.dispatchEvent(new Event('input',{bubbles:true}));
 $('so-save-draft').click();
 if(!$('so-draft-status').textContent.includes('сохранён только в этом браузере'))
  throw Error('SOCIAL_DRAFT_SAVE_FAILED');
 if(!localStorage.getItem('marcosa-social-private-draft-v1'))throw Error('SOCIAL_DRAFT_NOT_PERSISTED');
 if($('so-personal-note').hidden||!$('so-personal-note-body').textContent.includes('тестовый черновик'))
  throw Error('R25_MY_PRIVATE_NOTE_NOT_SHOWN');
 return {filter:'cinema',search:'Signal',saved:true,draftSaved:true,sourceCards:window.MarcosaSocial.sourceCardCount};
}
function socialClean(){
 const $=id=>document.getElementById(id);
 if(!$('so-draft-text').value.includes('тестовый черновик'))throw Error('SOCIAL_DRAFT_NOT_RESTORED');
 $('so-clear-draft').click();
 if(localStorage.getItem('marcosa-social-private-draft-v1'))throw Error('SOCIAL_DRAFT_DELETE_FAILED');
 if(!$('so-personal-note').hidden)throw Error('R25_DELETED_PRIVATE_NOTE_STILL_VISIBLE');
 const bookmark=document.querySelector('[data-so-save="signal"]');
 if(bookmark.getAttribute('aria-pressed')==='true')bookmark.click();
 if($('so-saved-count').textContent!=='0')throw Error('R26_LOCAL_BOOKMARK_COUNT_NOT_CLEARED');
 return {draftCleared:true,bookmarksCleared:true};
}
async function main(){
 const binary=chrome(),web=startServer(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r25-'));
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
                  {name:'mobile',width:390,height:844,mobile:true},
                  {name:'compact',width:360,height:740,mobile:true}]){
   await cdp.call('Emulation.setDeviceMetricsOverride',
    {width:d.width,height:d.height,deviceScaleFactor:1,mobile:d.mobile});
   for(const [file,world] of pages){
    cdp.requests.length=0;cdp.errors.length=0;
    await cdp.call('Page.navigate',{url:base+file});
    await cdp.wait("document.readyState==='complete'&&!!window.MarcosaBrand&&document.documentElement.dataset.mWorld==="+JSON.stringify(world)+"&&!!document.querySelector('.m-world-bar img')?.naturalWidth",world);
    // The legitimate navigation/loading overlay fades after resources are ready.
    // Capture the ACTUAL settled UI, not a translucent mid-transition screenshot.
    await cdp.wait("document.querySelector('.m-transition')?.hidden===true",world+'-loading-finished');
    await pause(110);
    const summary=await cdp.evalJS('('+inspectBrand.toString()+')('+JSON.stringify(world)+')');
    if(world==='gateway'){
     const grade=await cdp.evalJS("(async()=>{const images=['visual-city-director.webp','visual-cascade-director.webp','visual-hero-director.webp'];for(const file of images){const im=new Image();im.src='./'+file;await im.decode();if(im.naturalWidth!==1600||im.naturalHeight!==900)throw Error('R25_GRADED_FRAME_DIMENSIONS_'+file);}return true;})()");
     if(!grade)throw Error('R25_REAL_GRADED_ART_FAILED');
    }
    if(['gateway','social','cinema','creator','atlas'].includes(world)){
     const capture=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     const data=Buffer.from(capture.data,'base64');
     if(data.length<10000||data.subarray(0,4).toString('hex')!=='89504e47')
      throw Error('SCREENSHOT_INVALID_'+world);
     fs.writeFileSync(path.join(SHOTS,'r25-'+d.name+'-'+world+'.png'),data);
    }
    if(world==='social'){
     const test=await cdp.evalJS('('+socialActions.toString()+')()');
     if(!test.saved||!test.draftSaved)throw Error('SOCIAL_INTERACTIVE_CONTROLS_FAILED');
     // Directly open the advertised Saved route, keeping actual local bookmarks.
     await cdp.call('Page.navigate',{url:base+'social.html?view=saved#so-feed'});
     await cdp.wait("document.readyState==='complete'&&!!window.MarcosaSocial",'social-saved-deep-link');
     const savedView=await cdp.evalJS("(()=>({active:document.querySelector('[data-so-filter=\"saved\"]').getAttribute('aria-pressed'),count:Array.from(document.querySelectorAll('#so-cards article')).filter(x=>!x.hidden).length}))()");
     if(savedView.active!=='true'||savedView.count!==1)throw Error('R25_SAVED_DEEP_LINK_NOT_FUNCTIONAL');
     const clean=await cdp.evalJS('('+socialClean.toString()+')()');
     console.log('R25 '+d.name+' SOCIAL LOCAL TEST '+JSON.stringify({test,clean}));
    }
    const external=cdp.requests.filter(u=>/^https?:/.test(u)&&!u.startsWith(base));
    if(external.length)throw Error('EXTERNAL_REQUESTS_'+world+JSON.stringify(external));
    if(cdp.errors.length)throw Error('JS_ERRORS_'+world+JSON.stringify(cdp.errors.slice(0,3)));
    console.log('R25 '+d.name+' '+world+' PASS '+JSON.stringify(summary));
   }
   // Click a real global navigation link to verify a visible transition and actual page route.
   await cdp.call('Page.navigate',{url:base+'index.html'});
   await cdp.wait("document.readyState==='complete'&&!!window.MarcosaBrand",'transition-start');
   const nav=await cdp.evalJS("(()=>{document.querySelector(window.innerWidth>=721?'.m22-gateway-menu a[href=\"./social.html\"]':'.m22-cta-main').click();return document.querySelector('.m-transition').dataset.active;})()");
   if(nav!=='true')throw Error('BRAND_NAVIGATION_DID_NOT_SHOW_TRANSITION');
   await cdp.wait("location.pathname.endsWith('/social.html')&&window.MarcosaBrand?.current==='social'",'transition-target');
   console.log('R25 '+d.name+' TRANSITION PASS: home -> social');
  }
  console.log('R25: PASS seven distinct branded routes, real navigation, responsive Social Core and no external network requests');
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
  catch(e){console.warn('R25 disposable Chrome profile cleanup:',e.code||e.message);}
 }
}
main().catch(e=>{console.error('R25 BROWSER QA FAIL',e.stack||e);process.exitCode=1;});
