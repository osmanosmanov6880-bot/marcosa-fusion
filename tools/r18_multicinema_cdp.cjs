#!/usr/bin/env node
'use strict';
/* R18 end-to-end Chromium test: 2 new authentic offline cinemas, two viewports,
   embedded WebP frames, UI start buttons and zero unexpected remote requests. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const {spawn,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'dist'),SHOTS=path.join(ROOT,'qa-r18');
const ALLOW=new Set(['cinema-pilot.html','cinema-pilot.css','cinema-pilot.js',
 'film-internet-v-humanity.html','film-protocol-zero.html','film-adverse-judge.html']);
const sleep=t=>new Promise(resolve=>setTimeout(resolve,t));
function chromeBinary(){
 for(const n of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  const r=spawnSync('which',[n],{encoding:'utf8'});
  if(r.status===0&&r.stdout.trim())return r.stdout.trim();
 }
 throw Error('CHROMIUM_NOT_INSTALLED');
}
function server(){
 return http.createServer((req,res)=>{
  let name;
  try{name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/+/, '');}
  catch{res.writeHead(400);res.end();return;}
  if(!ALLOW.has(name)){res.writeHead(404);res.end();return;}
  try{
   const bytes=fs.readFileSync(path.join(DIST,name));
   const mime=name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html';
   res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
   res.end(bytes);
  }catch{res.writeHead(404);res.end();}
 });
}
async function openCdp(port){
 let meta=null;
 for(let i=0;i<150;i++){
  try{
   const r=await fetch('http://127.0.0.1:'+port+'/json/list');
   meta=(await r.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
   if(meta)break;
  }catch{}
  await sleep(70);
 }
 if(!meta)throw Error('NO_BROWSER_DEBUGGING_PAGE');
 const ws=new WebSocket(meta.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const t=setTimeout(()=>reject(Error('CDP_CONNECT_TIMEOUT')),15000);
  ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});
  ws.addEventListener('error',()=>{clearTimeout(t);reject(Error('CDP_SOCKET_ERROR'));},{once:true});
 });
 const pending=new Map();const requests=[];const exceptions=[];let id=0;
 ws.addEventListener('message',event=>{
  let message;try{message=JSON.parse(String(event.data));}catch{return;}
  if(message.method==='Network.requestWillBeSent')
   requests.push(message.params?.request?.url||'');
  if(message.method==='Runtime.exceptionThrown')
   exceptions.push(message.params?.exceptionDetails?.exception?.description||
                   message.params?.exceptionDetails?.text||'UNKNOWN_EXCEPTION');
  const job=pending.get(message.id);if(!job)return;
  pending.delete(message.id);clearTimeout(job.timer);
  if(message.error)job.reject(Error('CDP '+job.method+' '+JSON.stringify(message.error)));
  else job.resolve(message.result);
 });
 function call(method,params={},timeout=25000){
  return new Promise((resolve,reject)=>{
   const i=++id,timer=setTimeout(()=>{pending.delete(i);reject(Error('CDP_TIMEOUT '+method));},timeout);
   pending.set(i,{resolve,reject,timer,method});ws.send(JSON.stringify({id:i,method,params}));
  });
 }
 async function evalJS(expression,timeout=15000){
  const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},timeout);
  if(r.exceptionDetails)throw Error('BROWSER_JAVASCRIPT_EXCEPTION '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));
  return r.result?.value;
 }
 async function ready(expression,label){
  for(let i=0;i<160;i++){
   try{if(await evalJS(expression,5000))return;}catch{}
   await sleep(75);
  }
  throw Error('PAGE_NOT_READY '+label);
 }
 return {call,evalJS,ready,requests,exceptions,close:()=>ws.close()};
}
function standaloneAudit(slug){
 if(document.documentElement.scrollWidth>document.documentElement.clientWidth+5)
  throw Error('HORIZONTAL_OVERFLOW_'+slug);
 if(slug==='protocol-zero'){
  if(!window.PROTOCOL_ZERO_DEBUG)throw Error('PZ_DEBUG_MISSING');
  if(!document.getElementById('art')?.naturalWidth)throw Error('PZ_KEYFRAME_NOT_RENDERED');
  if(!document.querySelector('#choices button'))throw Error('PZ_SCENE_CHOICES_UNAVAILABLE');
  return {slug,scene:window.PROTOCOL_ZERO_DEBUG.getState().current,
          artWidth:document.getElementById('art').naturalWidth,
          choices:document.querySelectorAll('#choices button').length};
 }
 if(!window.CINEMA_ENGINE||!window.CINEMA_DATA)throw Error('ADVERSE_ENGINE_MISSING');
 if(window.CINEMA_DATA.scenes.length!==15)throw Error('ADVERSE_SCENE_GRAPH_WRONG');
 if(Object.keys(window.CINEMA_ASSETS||{}).length!==20)throw Error('ADVERSE_MISSING_ASSETS');
 if(!document.getElementById('interaction-zone'))throw Error('ADVERSE_CONTROLS_UNAVAILABLE');
 return {slug,scenes:window.CINEMA_DATA.scenes.length,assets:Object.keys(window.CINEMA_ASSETS).length,
         storyCharacters:document.getElementById('story-copy')?.textContent.length||0};
}
function theaterAudit(slug){
 return (async()=>{
  const $=id=>document.getElementById(id);
  if(!Array.from(document.querySelectorAll('[data-cp-film]')).some(x=>x.dataset.cpFilm===slug))
   throw Error('THEATER_SELECTOR_MISSING_'+slug);
  const button=Array.from(document.querySelectorAll('.cp-film-tabs [data-cp-film]'))
   .find(x=>x.dataset.cpFilm===slug);
  button.click();
  const frame=$('cp-film-frame');
  if(!frame.hidden||frame.hasAttribute('src'))throw Error('SOURCE_AUTO_STARTED');
  if(frame.getAttribute('sandbox')!=='allow-scripts allow-popups allow-popups-to-escape-sandbox')
   throw Error('UNSAFE_IFRAME_SANDBOX');
  $('cp-play').click();
  for(let i=0;i<130;i++){
   if($('cp-status').textContent.includes('запущен.')&&
      frame.getAttribute('src')==='./film-'+slug+'.html')break;
   await new Promise(done=>setTimeout(done,50));
  }
  if(!frame.getAttribute('src')?.endsWith('/film-'+slug+'.html')&&
     frame.getAttribute('src')!=='./film-'+slug+'.html')
   throw Error('WRONG_PLAYABLE_SOURCE');
  if($('cp-restart').disabled||$('cp-fullscreen').disabled)throw Error('CONTROLS_NOT_ENABLED');
  if(!$('cp-status').textContent.includes('запущен.'))throw Error('IFRAME_NOT_LOADED');
  if(document.documentElement.scrollWidth>document.documentElement.clientWidth+5)
   throw Error('THEATER_MOBILE_HORIZONTAL_OVERFLOW');
  return {film:slug,status:'PASS',iframe:frame.getAttribute('src')};
 })();
}
async function main(){
 const browser=chromeBinary(),web=server(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r18-'));
 let chrome,cdp;
 try{
  await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(0,'127.0.0.1',resolve);});
  const webport=web.address().port,profile=path.join(temp,'profile');
  chrome=spawn(browser,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,
   'about:blank'],{stdio:['ignore','ignore','pipe']});
  let err='';chrome.stderr.on('data',x=>{err=(err+String(x)).slice(-2000);});
  let debugport=0;
  for(let i=0;i<170;i++){
   const file=path.join(profile,'DevToolsActivePort');
   if(fs.existsSync(file)){debugport=Number(fs.readFileSync(file,'utf8').split(/\r?\n/)[0]);if(debugport)break;}
   if(chrome.exitCode!==null)throw Error('CHROME_EXIT '+err);
   await sleep(80);
  }
  if(!debugport)throw Error('NO_DEVTOOLS_PORT '+err);
  cdp=await openCdp(debugport);
  await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
  fs.mkdirSync(SHOTS,{recursive:true});
  for(const device of [{name:'desktop',width:1440,height:900,mobile:false},
                       {name:'mobile',width:390,height:844,mobile:true}]){
   await cdp.call('Emulation.setDeviceMetricsOverride',
    {width:device.width,height:device.height,deviceScaleFactor:1,mobile:device.mobile});
   for(const slug of ['protocol-zero','adverse-judge']){
    cdp.requests.length=0;cdp.exceptions.length=0;
    await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+webport+'/film-'+slug+'.html'});
    const expression=slug==='protocol-zero'
      ?"document.readyState==='complete'&&!!window.PROTOCOL_ZERO_DEBUG&&!!document.getElementById('art')?.naturalWidth&&!!document.querySelector('#choices button')"
      :"document.readyState==='complete'&&!!window.CINEMA_ENGINE&&!!document.getElementById('interaction-zone')";
    await cdp.ready(expression,slug+'-'+device.name);
    const game=await cdp.evalJS('('+standaloneAudit.toString()+')('+JSON.stringify(slug)+')');
    const capture=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const png=Buffer.from(capture.data,'base64');
    if(png.length<10000||png.subarray(0,4).toString('hex')!=='89504e47')
     throw Error('SCREENSHOT_FAILED_'+slug);
    fs.writeFileSync(path.join(SHOTS,'r18-'+slug+'-'+device.name+'.png'),png);
    await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+webport+'/cinema-pilot.html'});
    await cdp.ready("document.readyState==='complete'&&!!document.getElementById('cp-play')",'theater');
    const theater=await cdp.evalJS('('+theaterAudit.toString()+')('+JSON.stringify(slug)+')',30000);
    const external=cdp.requests.filter(url=>/^https?:/.test(url)&&!url.startsWith('http://127.0.0.1:'+webport+'/'));
    const api=cdp.requests.filter(url=>url.includes('/api/'));
    if(external.length||api.length)throw Error('UNEXPECTED_NETWORK '+JSON.stringify({external,api}));
    if(cdp.exceptions.length)throw Error('RUNTIME_EXCEPTIONS '+JSON.stringify(cdp.exceptions.slice(0,4)));
    console.log('R18 '+device.name+' '+slug+': '+JSON.stringify({game,theater,
      screenshotBytes:png.length,externalRequests:0}));
   }
  }
  console.log('R18: PASS 2 authentic films, responsive standalone and theater, no network leaks.');
 }finally{
  if(cdp)cdp.close();
  if(chrome){
   const stopped=new Promise(resolve=>chrome.once('exit',resolve));
   if(chrome.exitCode===null)chrome.kill('SIGTERM');
   await Promise.race([stopped,sleep(2300)]);
   if(chrome.exitCode===null)chrome.kill('SIGKILL');
  }
  await new Promise(resolve=>web.close(resolve));
  // Chrome child processes sometimes release Profile files after the parent exits.
  // The hosted runner is disposable: cleanup races must not invalidate a PASS.
  await sleep(350);
  try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:25,retryDelay:250});}
  catch(e){console.warn('R18 ephemeral Chrome QA profile cleanup warning:',e.code||e.message);}
 }
}
main().catch(e=>{console.error('R18 CINEMA BROWSER QA FAIL',e.stack||e);process.exitCode=1;});
