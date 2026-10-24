'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),SITE=path.join(ROOT,'site');
const read=name=>fs.readFileSync(path.join(SITE,name),'utf8');
const ROUTES=Object.freeze([
 ['index.html','gateway'],['social.html','social'],['cinema-pilot.html','cinema'],
 ['creator.html','creator'],['source-hub.html','atlas'],['stories.html','stories'],
 ['film-network.html','film-network']
]);

test('R21 seven authentic MARCOSA section routes share Orbital M assets but maintain distinct palettes',()=>{
 const css=read('marcosa-brand.css'),js=read('marcosa-brand.js');
 assert.doesNotThrow(()=>new vm.Script(js));
 for(const [route,world] of ROUTES){
  const html=read(route);
  assert.ok(html.includes('data-m-world="'+world+'"'),route+' wrong brand scope');
  assert.ok(html.includes('href="./marcosa-brand.css"'),route+' needs unified design');
  assert.ok(html.includes('src="./marcosa-brand.js"'),route+' needs real transitions');
  assert.ok(css.includes('data-m-world="'+world+'"'),world+' visual accent missing');
  assert.ok(js.includes("id:'"+world+"'"),world+' navigation target missing');
 }
 assert.equal((js.match(/href:'\.\/[a-z-]+\.html'/g)||[]).length,7);
 assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
 assert.ok(css.includes('@media(max-width:690px)'));
});
test('R21 logo is an original self-contained source SVG used on all surfaces',()=>{
 const mark=read('marcosa-mark.svg');
 assert.match(mark,/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
 assert.match(mark,/Orbital M/);
 assert.match(mark,/<ellipse /);
 assert.match(mark,/<path /);
 assert.ok(!mark.includes('http://www.w3.org/2000/svg" href='));
 assert.doesNotMatch(mark,/<script|foreignObject|https?:\/\/[^"]+\/asset/i);
 const css=read('marcosa-brand.css');
 for(const element of ['.mi-brand-glyph','.ms-brand-icon','.mc-monogram','.sh-monogram','.cp-symbol','.fn-brand>b'])
  assert.ok(css.includes(element),'logo surface '+element);
});
test('R21 nav changes actual internal pages with an accessible orbital transition',()=>{
 const js=read('marcosa-brand.js');
 for(const fragment of ["role','status'","'aria-live','polite'","'aria-current','page'","root.location.assign(url.href)","event.preventDefault()"])
  assert.ok(js.includes(fragment),fragment);
 for(const forbidden of ['fetch(', 'sendBeacon', 'XMLHttpRequest', 'WebSocket(', 'document.cookie', 'innerHTML', 'eval('])
  assert.equal(js.includes(forbidden),false,'unsafe branding operation: '+forbidden);
 const home=read('index.html');
 assert.ok(home.includes('m-world-gallery'));
 for(const [route] of ROUTES.slice(1,6))assert.ok(home.includes('href="./'+route+'"'),route+' gallery');
});
test('R21 Social Core is usable without inventing a production user backend',()=>{
 const html=read('social.html'),js=read('social-core.js'),css=read('social-core.css');
 assert.doesNotThrow(()=>new vm.Script(js));
 for(const id of ['so-app','so-feed','so-search','so-count','so-draft-text','so-save-draft','so-clear-draft','so-draft-status','so-bookmark-summary'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.equal((html.match(/class="so-card so-card--/g)||[]).length,4);
 assert.equal((html.match(/data-so-save=/g)||[]).length,4);
 for(const key of ['data-so-filter="all"','data-so-filter="cinema"','data-so-filter="create"','data-so-filter="source"'])
  assert.ok(html.includes(key));
 assert.ok(js.includes('localStorage'));
 assert.ok(js.includes("$('so-clear-draft').addEventListener('click'"));
 assert.ok(js.includes("button.setAttribute('aria-pressed',String(active))"));
 assert.ok(html.includes('не серверная соцсеть')||html.includes('пока не подключены'));
 assert.ok(css.includes('@media(max-width:600px)'));
 for(const forbidden of ['fetch(', 'sendBeacon', 'XMLHttpRequest', 'WebSocket(', 'document.cookie', 'innerHTML'])
  assert.equal(js.includes(forbidden),false,'Social Core must remain a private local preview');
});
test('R21 server-private cinema engines and R19 byte-for-byte provenance remain independent',()=>{
 const gate=fs.readFileSync(path.join(ROOT,'tools/build_webroot.py'),'utf8');
 const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/marcosa-public-pages.yml'),'utf8');
 for(const name of ['social.html','social-core.css','social-core.js','marcosa-mark.svg','marcosa-brand.css','marcosa-brand.js'])
  assert.ok(gate.includes('"'+name+'"'),'Public allowlist missing '+name);
 for(const forbidden of ['site/film-protocol-zero.html','site/film-adverse-judge.html','site/film-signal-worlds.html'])
  assert.ok(fs.existsSync(path.join(ROOT,forbidden)),forbidden);
 assert.ok(gate.includes('commercial_rights')===false);
 assert.ok(workflow.includes('tests/brand_r21.test.cjs'));
});
