#!/usr/bin/env node
'use strict';
/* R16: real-time Chrome acceptance of a source-identical, PLAYABLE cinema.
 * Includes both genuine story endings, iframe sandbox and mobile checks.
 * All network access except localhost is forbidden. No NPM dependencies.
 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {spawn,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'dist'),SHOTS=path.join(ROOT,'qa-r16');
const ALLOW=new Set(['cinema-pilot.html','cinema-pilot.css','cinema-pilot.js',
 'film-internet-v-humanity.html','source-hub.html','source-hub.css','source-hub.js']);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function chromeBinary(){
 for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
  const result=spawnSync('which',[name],{encoding:'utf8'});
  if(result.status===0&&result.stdout.trim())return result.stdout.trim();
 }
 throw Error('CHROME_BINARY_UNAVAILABLE');
}
function serve(){
 return http.createServer((req,res)=>{
  let file;
  try{file=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).replace(/^\/+/, '');}
  catch(e){res.writeHead(400);res.end();return;}
  if(!ALLOW.has(file)){res.writeHead(404);res.end();return;}
  try{
   const data=fs.readFileSync(path.join(DIST,file));
   res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(data);
  }catch(e){res.writeHead(404);res.end();}
 });
}
async function connect(port){
 let page;
 for(let count=0;count<110;count++){
  try{
   const resp=await fetch('http://127.0.0.1:'+port+'/json/list');
   page=(await resp.json()).find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
   if(page)break;
  }catch(e){}
  await pause(90);
 }
 if(!page)throw Error('CDP_PAGE_UNAVAILABLE');
 const socket=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('CDP_CONNECT_TIMEOUT')),12000);
  socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
  socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP_CONNECT_ERROR'));},{once:true});
 });
 let seq=0;const awaiting=new Map(),requests=[];
 socket.addEventListener('message',event=>{
  let data;try{data=JSON.parse(String(event.data));}catch(e){return;}
  if(data.method==='Network.requestWillBeSent')requests.push(data.params?.request?.url||'');
  if(!awaiting.has(data.id))return;
  const job=awaiting.get(data.id);awaiting.delete(data.id);clearTimeout(job.timer);
  if(data.error)job.reject(Error('CDP '+job.method+' '+JSON.stringify(data.error)));
  else job.resolve(data.result);
 });
 const call=(method,params={},duration=25000)=>new Promise((resolve,reject)=>{
  const id=++seq,timer=setTimeout(()=>{awaiting.delete(id);reject(Error('CDP_TIMEOUT_'+method));},duration);
  awaiting.set(id,{resolve,reject,timer,method});
  socket.send(JSON.stringify({id,method,params}));
 });
 async function evalJS(code,duration=30000){
  const result=await call('Runtime.evaluate',{expression:code,awaitPromise:true,returnByValue:true,userGesture:true},duration);
  if(result.exceptionDetails)
   throw Error('JS_EXCEPTION '+(result.exceptionDetails.exception?.description||result.exceptionDetails.text));
  return result.result?.value;
 }
 return {call,evalJS,requests,close:()=>socket.close()};
}
async function waitReady(cdp,expression,description){
 for(let i=0;i<120;i++){
  try{if(await cdp.evalJS(expression,4500))return;}
  catch(e){}
  await pause(75);
 }
 throw Error('PAGE_BOOT_TIMEOUT_'+description);
}
function atlasCheck(){
 const card=Array.from(document.querySelectorAll('#sh-grid .sh-card'))
  .find(node=>node.textContent.includes('THE INTERNET v. HUMANITY'));
 if(!card)throw Error('MISSING_REAL_SOURCE_CARD');
 const link=card.querySelector('a.sh-play');
 if(!link||!link.href.endsWith('/cinema-pilot.html'))throw Error('BROKEN_PLAYABLE_SOURCE_ROUTE');
 if(document.querySelectorAll('#sh-grid a.sh-play').length!==3)throw Error('EXPECTED_THREE_REAL_PLAYABLE_FILMS');
 return {status:'PASS_R16_ATLAS_TO_REAL_CINEMA',links:1};
}
function theaterCheck(){
 return (async()=>{
  const $=id=>document.getElementById(id);
  const wait=async(check,label)=>{
   for(let i=0;i<130;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,40));}
   throw Error('WAIT_'+label+' / '+$('cp-status').textContent);
  };
  const iframe=$('cp-film-frame');
  if(!iframe.hidden||iframe.hasAttribute('src'))throw Error('PREVIEW_PRELOADED_WITHOUT_CONSENT');
  if($('cp-restart').disabled!==true||$('cp-fullscreen').disabled!==true)throw Error('INERT_BUTTON_NOT_DISABLED');
  if(iframe.getAttribute('sandbox')!=='allow-scripts allow-popups allow-popups-to-escape-sandbox')
   throw Error('DANGEROUS_IFRAME_SANDBOX');
  $('cp-play').click();
  await wait(()=>!iframe.hidden&&iframe.getAttribute('src')==='./film-internet-v-humanity.html'
   &&$('cp-status').textContent.includes('Игра запущена'),'FILM_LAUNCH');
  if($('cp-restart').disabled||$('cp-fullscreen').disabled||!$('cp-placeholder').hidden)
   throw Error('PLAYER_NOT_ENABLED');
  $('cp-restart').click();
  await wait(()=>$('cp-status').textContent.includes('Игра запущена'),'FILM_RESTART');
  if(document.documentElement.scrollWidth>document.documentElement.clientWidth+3)
   throw Error('THEATER_OVERFLOW');
  $('cp-stage').scrollIntoView({block:'start',behavior:'auto'});
  await new Promise(resolve=>setTimeout(resolve,220));
  return {status:'PASS_R16_PLAYER_LAUNCH_AND_RESTART',viewport:document.documentElement.clientWidth};
 })();
}
function storyCheck(){
 const $=id=>document.getElementById(id);
 const choice=n=>{
  const choices=document.querySelectorAll('#scene .choicebar .choice');
  if(!choices[n])throw Error('MISSING_STORY_CHOICE_'+n);
  choices[n].click();
 };
 const finish=expected=>{
  const ending=$('scene').querySelector('.continuation');
  if(!ending)throw Error('NO_ENDING_CONTINUATION_'+expected);
  const link=ending.querySelector('a[href="https://marcosa.club/"]');
  if(!link)throw Error('ENDING_LINK_MISSING');
  if(link.target!=='_blank'||!link.rel.includes('noopener')||!link.rel.includes('noreferrer'))
   throw Error('UNSAFE_ENDING_LINK');
  if(!ending.textContent.includes('Никакие решения или данные этого фильма туда не отправляются'))
   throw Error('OFFSITE_DISCLOSURE_MISSING');
  if(!$('scene').querySelector('h1')?.textContent.includes(expected))
   throw Error('WRONG_ENDING_'+expected);
 };
 $('reset').click();
 if($('scene').querySelector('.continuation'))throw Error('CTA_BEFORE_STORY');
 choice(0); // intro -> court
 if($('scene').querySelector('.continuation'))throw Error('CTA_AT_COURT');
 choice(0); // court -> human responsibility
 if($('scene').querySelector('.continuation'))throw Error('CTA_BEFORE_HUMAN_ENDING');
 choice(0); // human -> end_human
 finish('БУДУЩЕЕ');
 $('reset').click();
 choice(0);choice(1);choice(0); // algorithm verdict and finale
 finish('НИ ОДНО РЕШЕНИЕ');
 $('reset').click();
 choice(1);choice(0);choice(0); // archive -> evidence -> court
 if(!$('scene').querySelector('h1').textContent.includes('КТО ВИНОВЕН'))
  throw Error('ARCHIVE_EVIDENCE_BRANCH_BROKEN');
 if($('scene').querySelector('.continuation'))throw Error('CTA_IN_ARCHIVE');
 if(document.documentElement.scrollWidth>document.documentElement.clientWidth+3)
  throw Error('STANDALONE_MOBILE_OVERFLOW');
 return {status:'PASS_R16_BOTH_ENDINGS_AND_EVIDENCE',viewport:document.documentElement.clientWidth,endings:2};
}
async function main(){
 const binary=chromeBinary(),server=serve(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r16-cinema-'));
 let chrome=null,cdp=null;
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const webport=server.address().port,profile=path.join(dir,'profile');
  chrome=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage',
   '--disable-background-networking','--no-first-run','--no-default-browser-check',
   '--remote-allow-origins=*','--remote-debugging-port=0','--user-data-dir='+profile,
   'about:blank'],{stdio:['ignore','ignore','pipe']});
  let err='';chrome.stderr.on('data',b=>{err=(err+String(b)).slice(-2300);});
  let port=0;
  for(let i=0;i<140;i++){
   const f=path.join(profile,'DevToolsActivePort');
   if(fs.existsSync(f)){port=Number(fs.readFileSync(f,'utf8').split(/\r?\n/)[0]);if(port>0)break;}
   if(chrome.exitCode!==null)throw Error('CHROME_EARLY_EXIT '+err);
   await pause(90);
  }
  if(!port)throw Error('CDP_PORT_MISSING '+err);
  cdp=await connect(port);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Network.enable');
  fs.mkdirSync(SHOTS,{recursive:true});
  for(const device of [{name:'desktop',width:1440,height:900,mobile:false},
                       {name:'mobile',width:390,height:844,mobile:true}]){
   await cdp.call('Emulation.setDeviceMetricsOverride',
    {width:device.width,height:device.height,deviceScaleFactor:1,mobile:device.mobile});
   cdp.requests.length=0;
   await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+webport+'/source-hub.html'});
   await waitReady(cdp,"document.readyState==='complete'&&!!window.MarcosaSourceAtlas",'source-atlas');
   const atlas=await cdp.evalJS('('+atlasCheck.toString()+')()');
   if(!atlas?.status?.startsWith('PASS_R16'))throw Error('ATLAS_CHECK_FAILED');
   await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+webport+'/cinema-pilot.html'});
   await waitReady(cdp,"document.readyState==='complete'&&!!document.getElementById('cp-play')",'cinema-theater');
   const result=await cdp.evalJS('('+theaterCheck.toString()+')()',30000);
   if(result?.status!=='PASS_R16_PLAYER_LAUNCH_AND_RESTART')
    throw Error('PLAYER_FAILED '+JSON.stringify(result));
   const capture=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   const bytes=Buffer.from(capture.data,'base64');
   if(bytes.length<10000||bytes.subarray(0,4).toString('hex')!=='89504e47')
    throw Error('SCREENSHOT_FAILED_'+device.name);
   fs.writeFileSync(path.join(SHOTS,'r16-'+device.name+'-real-cinema.png'),bytes);
   await cdp.call('Page.navigate',{url:'http://127.0.0.1:'+webport+'/film-internet-v-humanity.html'});
   await waitReady(cdp,"document.readyState==='complete'&&!!document.querySelector('#scene .choice')",'standalone');
   const game=await cdp.evalJS('('+storyCheck.toString()+')()',30000);
   if(game?.status!=='PASS_R16_BOTH_ENDINGS_AND_EVIDENCE')
    throw Error('SOURCE_CINEMA_FAILED '+JSON.stringify(game));
   const leaked=cdp.requests.filter(url=>/^https?:/.test(url)&&!url.startsWith('http://127.0.0.1:'+webport+'/'));
   if(leaked.length)throw Error('EXTERNAL_NETWORK_REQUESTS '+JSON.stringify(leaked));
   console.log('R16 '+device.name+' confirmed:',JSON.stringify({atlas,player:result,story:game,screenshot_bytes:bytes.length,external_requests:leaked.length}));
  }
  console.log('R16 SOURCE-IDENTICAL CINEMA: PASS (2 endings, real sandbox player, desktop and mobile)');
 }finally{
  if(cdp)try{cdp.close();}catch(e){}
  if(chrome){
   const stopped=new Promise(resolve=>chrome.once('exit',resolve));
   if(chrome.exitCode===null)chrome.kill('SIGTERM');
   await Promise.race([stopped,pause(2300)]);
   if(chrome.exitCode===null)chrome.kill('SIGKILL');
   await pause(130);
  }
  await new Promise(resolve=>server.close(resolve));
  try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:280});}
  catch(e){console.warn('R16 tmp profile cleanup:',e.message);}
 }
}
main().catch(e=>{console.error('R16 CDP acceptance FAIL:',e.stack||e);process.exitCode=1;});
