'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const SITE=path.join(__dirname,'../site');
const read=name=>fs.readFileSync(path.join(SITE,name));
const html=name=>read(name).toString('utf8');
const SOURCE_COMMIT='4c492d30656d16a908f0dbd851a703f815b2d34e';
const SOURCE_BLOB='f18380a086f2196cf0faab1a9c6568ebef854e9e';
test('R16 cinema is byte-identical to genuine internet-v-humanity GitHub commit',()=>{
 const file=read('film-internet-v-humanity.html');
 const header=Buffer.from('blob '+file.length+'\0');
 const actual=crypto.createHash('sha1').update(Buffer.concat([header,file])).digest('hex');
 assert.equal(actual,SOURCE_BLOB,'do not quietly modify the original film story or its engine');
 assert.equal(file.toString('utf8').includes('end_human'),true);
 assert.equal(file.toString('utf8').includes('end_algorithm'),true);
 assert.ok(!file.toString('utf8').includes('<script src='));
 assert.ok(!file.toString('utf8').includes('<img src='));
 const script=/<script>([\s\S]*?)<\/script>/i.exec(file.toString('utf8'))?.[1];
 assert.ok(script&&script.length>1400);
 assert.doesNotThrow(()=>new vm.Script(script,{filename:'proven-source-film.js'}));
});
test('R16 source film does not invite viewers to MARCOSA until an actual ending',()=>{
 const s=html('film-internet-v-humanity.html');
 assert.match(s,/id==="end_human"\|\|id==="end_algorithm"/);
 assert.match(s,/link\.href="https:\/\/marcosa\.club\/"/);
 assert.match(s,/link\.target="_blank"/);
 assert.match(s,/link\.rel="noopener noreferrer"/);
 assert.match(s,/Никакие решения или данные этого фильма туда не отправляются/);
 assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|new WebSocket\(|service_role|sk-proj-/.test(s));
});
test('R16 isolated player has functional start, restart, fullscreen and external standalone links',()=>{
 const page=html('cinema-pilot.html'),js=html('cinema-pilot.js'),css=html('cinema-pilot.css');
 for(const id of ['cp-app','cp-play','cp-restart','cp-fullscreen','cp-stage','cp-placeholder','cp-film-frame','cp-status'])
  assert.ok(page.includes('id="'+id+'"'),id);
 assert.match(page,/sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
 assert.ok(!page.includes('allow-same-origin'),'do not combine iframe sandbox scripts with same-origin capability');
 assert.ok(!page.includes('allow-top-navigation'));
 assert.match(page,/referrerpolicy="no-referrer"/);
 assert.ok(page.includes('href="./film-internet-v-humanity.html"'));
 assert.ok(page.includes('/tree/'+SOURCE_COMMIT));
 assert.match(js,/play\.addEventListener\('click'/);
 assert.match(js,/restart\.addEventListener\('click'/);
 assert.match(js,/fullscreen\.addEventListener\('click'/);
 assert.match(js,/frame\.src=src/);
 assert.match(css,/@media\(max-width:520px\)/);
 assert.match(css,/:focus-visible/);
 for(const word of ['fetch(','XMLHttpRequest','sendBeacon','document.cookie','new WebSocket(','innerHTML'])
  assert.equal(js.includes(word),false,'no player tracking or HTML insertion: '+word);
 for(const re of [/\blocalStorage\s*\./,/\bsessionStorage\s*\./])
  assert.equal(re.test(js),false,'no storage reads/writes in player runtime');
});
test('R16 honors production/source boundaries for two other engines',()=>{
 const page=html('cinema-pilot.html'),atlas=html('source-hub.js');
 const src=html('source-hub.html'),index=html('index.html');
 assert.match(page,/PROTOCOL ZERO/);
 assert.match(page,/ADVERSE JUDGE/);
 assert.match(page,/OFFLINE SOURCE BUILD · NO ACCOUNT/);
 assert.match(page,/data-cp-film="protocol-zero"/);
 assert.match(page,/data-cp-film="adverse-judge"/);
 assert.match(page,/Это ограниченный автономный пролог/);
 assert.match(page,/43 доменов остаётся неподтверждённым/);
 assert.ok(index.includes('href="./cinema-pilot.html"'));
 assert.ok(src.includes('href="./cinema-pilot.html"'));
 assert.ok(atlas.includes("if(item.name==='internet-v-humanity')"));
 assert.ok(atlas.includes("play.href='./cinema-pilot.html'"));
 assert.equal((atlas.match(/play\.href='\.\/*cinema-pilot\.html'/g)||[]).length,1);
});
