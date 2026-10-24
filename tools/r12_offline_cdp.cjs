#!/usr/bin/env node
'use strict';
/* R12 acceptance: actually open downloaded story HTML through file:// in Chrome.
 * No NPM dependencies, no server, no network, no resources outside the file.
 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {webcrypto}=require('node:crypto');
const standalone=require('../site/creator-standalone.js');
const creator=require('../site/creator.js');
const OUTPUT=path.resolve(__dirname,'../qa-r5');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const browser=()=>{
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){
    const candidate=spawnSync('which',[name],{encoding:'utf8'});
    if(candidate.status===0&&candidate.stdout.trim())return candidate.stdout.trim();
  }
  return null;
};
async function cdpConnect(port){
  let url=null;
  for(let i=0;i<110;i++){
    try{
      const response=await fetch('http://127.0.0.1:'+port+'/json/list');
      const pages=await response.json();
      url=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
      if(url)break;
    }catch(e){}
    await pause(100);
  }
  if(!url)throw Error('CDP_NO_PAGE');
  const socket=new WebSocket(url);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CDP_WEBSOCKET_TIMEOUT')),10000);
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('CDP_WS_ERROR'));},{once:true});
  });
  const requests=[],pending=new Map();
  let counter=0;
  socket.addEventListener('message',event=>{
    let parsed;try{parsed=JSON.parse(event.data);}catch(e){return;}
    if(parsed.method==='Network.requestWillBeSent')requests.push(parsed.params?.request?.url||'');
    if(!pending.has(parsed.id))return;
    const task=pending.get(parsed.id);pending.delete(parsed.id);clearTimeout(task.timer);
    parsed.error?task.reject(Error('CDP '+task.method+': '+JSON.stringify(parsed.error))):
      task.resolve(parsed.result);
  });
  const call=(method,params={},ms=25000)=>new Promise((resolve,reject)=>{
    const id=++counter,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP_TIMEOUT_'+method));},ms);
    pending.set(id,{method,resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params}));
  });
  async function evalJS(expression,ms=25000){
    const payload=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},ms);
    if(payload.exceptionDetails)
      throw Error('JS_EXCEPTION '+(payload.exceptionDetails.exception?.description||payload.exceptionDetails.text));
    return payload.result?.value;
  }
  return {call,evalJS,requests,close:()=>socket.close()};
}
async function main(){
  const binary=browser();
  if(!binary)throw Error('Chromium is required for offline acceptance');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'marcosa-r12-offline-'));
  const profile=path.join(temp,'profile');
  let processRef=null,cdp=null;
  try{
    const draft=creator.demoDraft();
    const story=await standalone.buildPlayable(draft,{theme:'cosmos'},webcrypto);
    const file=path.join(temp,'story.html');
    fs.writeFileSync(file,story,'utf8');
    processRef=spawn(binary,[
      '--headless=new','--no-sandbox','--disable-dev-shm-usage',
      '--disable-background-networking','--no-first-run','--no-default-browser-check',
      '--remote-allow-origins=*','--remote-debugging-port=0',
      '--user-data-dir='+profile,'about:blank'
    ],{stdio:['ignore','ignore','pipe']});
    let stderr='';
    processRef.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-5000);});
    let port=null;
    for(let attempt=0;attempt<140;attempt++){
      const info=path.join(profile,'DevToolsActivePort');
      if(fs.existsSync(info)){
        port=Number(fs.readFileSync(info,'utf8').split(/\r?\n/)[0]);
        if(Number.isInteger(port)&&port>0)break;
      }
      if(processRef.exitCode!==null)throw Error('CHROME_CLOSED '+stderr);
      await pause(100);
    }
    if(!port)throw Error('CHROME_DEBUG_PORT_TIMEOUT '+stderr);
    cdp=await cdpConnect(port);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Network.enable');
    fs.mkdirSync(OUTPUT,{recursive:true});
    const expected=['Город общих решений','Смена на рассвете','Открытый маяк','Тихий контроль'];
    for(const device of [{name:'desktop',width:1440,height:900,mobile:false},
      {name:'mobile',width:390,height:844,mobile:true}]){
      await cdp.call('Emulation.setDeviceMetricsOverride',{
        width:device.width,height:device.height,deviceScaleFactor:1,mobile:device.mobile
      });
      cdp.requests.length=0;
      await cdp.call('Page.navigate',{url:'file://'+file});
      let ready=false;
      for(let retry=0;retry<100;retry++){
        const status=await cdp.evalJS(
          'document.readyState==="complete" && !!document.getElementById("play-title")?.textContent'
        ).catch(()=>false);
        if(status){ready=true;break;}
        await pause(90);
      }
      if(!ready)throw Error('R12_INLINE_PLAYER_CSP_OR_MOUNT_FAILED_'+device.name);
      const protocol=await cdp.evalJS('location.protocol');
      if(protocol!=='file:')throw Error('NOT_INDEPENDENT_OFFLINE_FILE');
      for(let first=0;first<2;first++)for(let second=0;second<2;second++){
        await cdp.evalJS('document.getElementById("play-restart").click()');
        await cdp.evalJS('document.getElementById("play-choose-'+(first?'b':'a')+'").click()');
        const secondChoices=await cdp.evalJS('document.querySelectorAll("#play-choices button").length');
        if(secondChoices!==2)throw Error('R12_MISSING_SECOND_DECISION');
        await cdp.evalJS('document.getElementById("play-choose-'+(second?'b':'a')+'").click()');
        const ending=await cdp.evalJS('document.getElementById("play-title").textContent');
        if(ending!==expected[first*2+second])
          throw Error('R12_WRONG_ENDING '+device.name+' '+first+second+' '+ending);
        const choices=await cdp.evalJS('document.querySelectorAll("#play-choices button").length');
        if(choices!==0)throw Error('R12_ENDING_STILL_HAS_CHOICES');
      }
      await cdp.evalJS('document.getElementById("play-back").click()');
      if((await cdp.evalJS('document.querySelectorAll("#play-choices button").length'))!==2)
        throw Error('R12_BACK_NAVIGATION_BROKEN');
      await cdp.evalJS('document.getElementById("play-restart").click()');
      await cdp.evalJS('document.dispatchEvent(new KeyboardEvent("keydown",{key:"1",bubbles:true}))');
      await cdp.evalJS('document.dispatchEvent(new KeyboardEvent("keydown",{key:"2",bubbles:true}))');
      if((await cdp.evalJS('document.getElementById("play-title").textContent'))!==expected[1])
        throw Error('R12_KEYBOARD_CHOICES_FAILED');
      const overflow=await cdp.evalJS('document.documentElement.scrollWidth-document.documentElement.clientWidth');
      if(overflow>3)throw Error('R12_HORIZONTAL_OVERFLOW_'+device.name+' '+overflow);
      const outbound=cdp.requests.filter(u=>u.startsWith('http:')||u.startsWith('https:'));
      if(outbound.length)throw Error('R12_OFFLINE_FILE_NETWORK_REQUESTS '+outbound.join(','));
      const image=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const png=Buffer.from(image.data,'base64');
      if(png.length<10000||png.toString('hex',0,4)!=='89504e47')throw Error('R12_BAD_PNG');
      fs.writeFileSync(path.join(OUTPUT,'r12-real-'+device.name+'-offline-playable.png'),png);
      console.log('R12 offline Chrome '+device.name+': PASS (4 endings, back, restart, keyboard, zero network) / png='+png.length);
    }
    const attack=creator.demoDraft();
    attack.opening.scene='Сюжет содержит </script><img src=x onerror="window.hacked=1"> и текст для проверки.';
    const infected=await standalone.buildPlayable(attack,{theme:'ember'},webcrypto);
    const attackFile=path.join(temp,'story-xss-test.html');
    fs.writeFileSync(attackFile,infected,'utf8');
    await cdp.call('Page.navigate',{url:'file://'+attackFile});
    let loaded=false;
    for(let retry=0;retry<75;retry++){
      loaded=await cdp.evalJS('!!document.getElementById("play-body")?.textContent').catch(()=>false);
      if(loaded)break;
      await pause(85);
    }
    if(!loaded)throw Error('R12_XSS_TEST_DID_NOT_LOAD');
    const result=await cdp.evalJS('({markup:document.querySelectorAll("img,iframe").length, hacked:window.hacked===1, body:document.getElementById("play-body").textContent})');
    if(result.markup!==0||result.hacked||!result.body.includes('<img src=x'))
      throw Error('R12_UNTRUSTED_STORY_EXECUTED '+JSON.stringify(result));
    if(cdp.requests.some(u=>u.startsWith('https://')))throw Error('R12_XSS_EXTERNAL_REQUEST');
    console.log('R12 attacker-authored story: PASS (HTML inert, file://, no outbound network)');
    console.log('R12 standalone file:// acceptance: PASS');
  }finally{
    if(cdp)try{cdp.close();}catch(e){}
    if(processRef){
      const closed=new Promise(resolve=>processRef.once('exit',resolve));
      if(processRef.exitCode===null)processRef.kill('SIGTERM');
      await Promise.race([closed,pause(2400)]);
      if(processRef.exitCode===null)processRef.kill('SIGKILL');
      await pause(130);
    }
    try{fs.rmSync(temp,{recursive:true,force:true,maxRetries:12,retryDelay:250});}
    catch(err){console.warn('Chrome cleanup:',err.message);}
  }
}
main().catch(err=>{console.error('R12 OFFLINE FAIL:',err.stack||err);process.exitCode=1;});
