'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const read=(name)=>fs.readFileSync(path.join(ROOT,name),'utf8');

test('R18: source-pinned, offline cinema films are real HTML with embedded frames and executable JS',()=>{
 for(const [slug,minimumFrameCount] of [['protocol-zero',18],['adverse-judge',20]]){
  const source=read('site/film-'+slug+'.html');
  assert.match(source,/^<!-- MARCOSA R18/);
  assert.match(source,/<html lang="ru"/);
  assert.equal(/<script\b[^>]*\bsrc\s*=/i.test(source),false,slug+' script dependency not bundled');
  assert.equal(/<link\b[^>]*\brel=['"]stylesheet/i.test(source),false,slug+' stylesheet dependency not bundled');
  const frames=source.match(/data:image\/webp;base64,/g)||[];
  assert.ok(frames.length>=minimumFrameCount,slug+' all keyframes must be present');
  const scripts=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1]);
  assert.ok(scripts.length>0,slug+' must have original scene engine');
  for(const [i,js] of scripts.entries())assert.doesNotThrow(()=>new vm.Script(js,{filename:slug+'-'+i+'.js'}));
  assert.ok(Buffer.byteLength(source)>700000,slug+' cannot be a minimal fake scene');
  assert.ok(Buffer.byteLength(source)<4000000,slug+' unexpectedly huge');
  assert.ok(source.includes('https://marcosa.club/'),'Opt-in finale link must be present');
  assert.doesNotMatch(source,/sk-proj-[a-zA-Z0-9]{30}|-----BEGIN [A-Z ]+PRIVATE KEY-----/);
 }
});
test('R18: original film logic is preserved, including original 15-scene choices and finale',()=>{
 const protocol=read('site/film-protocol-zero.html');
 const adverse=read('site/film-adverse-judge.html');
 assert.match(protocol,/PROTOCOL_ZERO_DEBUG/);
 assert.match(protocol,/function renderEnding\(scene\)/);
 assert.match(protocol,/open['",]/);
 assert.match(protocol,/seal['",]/);
 assert.match(protocol,/class RealityBridge/);
 assert.match(adverse,/window\.CINEMA_DATA/);
 assert.match(adverse,/CINEMA_ENGINE/);
 assert.match(adverse,/scene_015/);
 assert.match(adverse,/networkContinuation\(\)/);
});
test('R18: theater has real buttons for all 3 standalone films and no automatic playing',()=>{
 const page=read('site/cinema-pilot.html'),controller=read('site/cinema-pilot.js');
 const atlas=read('site/source-hub.js');
 for(const film of ['internet-v-humanity','protocol-zero','adverse-judge']){
  assert.ok(page.includes('data-cp-film="'+film+'"'),film);
  assert.ok(controller.includes("'"+film+"':Object.freeze({"),film);
  assert.ok(controller.includes('./film-'+film+'.html'),film);
 }
 assert.ok(page.includes('href="./film-protocol-zero.html"'));
 assert.ok(page.includes('href="./film-adverse-judge.html"'));
 assert.ok(atlas.includes("'./cinema-pilot.html#'+item.name"));
 assert.equal((page.match(/sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/g)||[]).length,1);
 assert.ok(controller.includes("play.addEventListener('click'"));
 assert.ok(!controller.includes('fetch('));
 assert.ok(!controller.includes('localStorage'));
 assert.ok(!controller.includes('XMLHttpRequest'));
});
test('R18: independent source version pins are mandatory for the release builder',()=>{
 const builder=read('tools/build_cinema_r18.py');
 for(const pin of ['0f1841c0e56e47f7413bea9948e66200409e7a7a',
                   'f48a00510984a3da2d5527cd01ef8a51f102881e'])assert.ok(builder.includes(pin));
 assert.ok(builder.includes('check_revision('));
 assert.ok(builder.includes('src/reality.mjs'),'RealityBridge module must not be omitted');
 const workflow=read('.github/workflows/marcosa-public-pages.yml');
 assert.ok(workflow.includes('tools/build_cinema_r18.py'));
});
