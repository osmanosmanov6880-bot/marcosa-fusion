'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),SITE=path.join(ROOT,'site');
const read=name=>fs.readFileSync(path.join(SITE,name),'utf8');
const ROUTES=[
 ['index.html','gateway'],['social.html','social'],['cinema-pilot.html','cinema'],
 ['creator.html','creator'],['source-hub.html','atlas'],
 ['stories.html','stories'],['film-network.html','film-network']
];
test('R23 replaces the visual homepage with a social-first editorial experience',()=>{
 const html=read('index.html');
 for(const marker of ['id="q23-home"','id="q23-title"','id="q23-directory"',
  'id="q23-search-input"','href="./social.html#so-feed"','href="./social.html#so-draft"',
  'class="q23-hero-visual"','src="./marcosa-quiet.js"'])
  assert.ok(html.includes(marker),'missing new real element: '+marker);
 assert.match(html,/Место, где/);
 assert.match(html,/Открыть сообщество/);
 assert.equal((html.match(/data-q23-search=/g)||[]).length,4);
 for(const unused of ['50K+','12K+','1M+'])assert.equal(html.includes(unused),false);
 assert.ok(html.includes('id="mn-dialog"'),'existing live source-network tools cannot be deleted');
 assert.ok(html.includes('id="m22-experience"'),'preserve previous source for rollback');
});
test('R23 design applies to all seven real routes with low-motion, high-legibility typography',()=>{
 const css=read('marcosa-quiet.css');
 assert.ok(css.includes('--q-serif:'));
 assert.ok(css.includes('--q-paper:#f3f0e9'));
 assert.ok(css.includes('--q-gold:#aa9477'));
 assert.ok(css.includes('q23-hero h1'));
 assert.ok(css.includes('font-size:clamp(61px'));
 assert.ok(css.includes('font-size:clamp(17px'));
 assert.ok(css.includes('m-transition:before'));
 assert.ok(css.includes('display:none!important'));
 assert.ok(css.includes('@media(max-width:640px)'));
 assert.ok(css.includes('prefers-reduced-motion:reduce'));
 assert.doesNotMatch(css,/url\(["']?https?:\/\//,'no remote fonts/images');
 for(const [route,world] of ROUTES){
  const html=read(route);
  assert.ok(html.includes('data-m-world="'+world+'"'),route);
  assert.ok(html.includes('href="./marcosa-quiet.css"'),route);
  assert.ok(html.includes('href="./marcosa-brand.css"'),route);
 }
});
test('R23 quiet branding retains the M but does not recreate giant space effects',()=>{
 const svg=read('marcosa-mark.svg');
 assert.match(svg,/MARCOSA — Orbital M/);
 assert.match(svg,/матового шампанского/);
 assert.match(svg,/<path /);
 assert.match(svg,/<ellipse /);
 assert.doesNotMatch(svg,/animation|http:\/\/[^"]+\/static/i);
 const css=read('marcosa-quiet.css');
 for(const token of ['html[data-m-world="social"]','.so-stream-head h2','.so-create','.so-personal-note','.cp-hero','.mc-hero','.sh-hero'])
  assert.ok(css.includes(token),token);
});
test('R23 local Social Core supports real saved feed and safely mirrors its own private draft',()=>{
 const html=read('social.html'),js=read('social-core.js');
 for(const id of ['so-search','so-cards','so-personal-note','so-personal-note-body',
  'so-draft-text','so-save-draft','so-clear-draft'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes('data-so-filter="saved"'));
 assert.ok(js.includes("filter==='saved'?saved.includes(card.dataset.soId)"));
 assert.ok(js.includes("body.textContent=value||''"));
 assert.ok(js.includes("if(success)showPrivateNote(value)"));
 assert.ok(js.includes("if(success)showPrivateNote('')"));
 assert.doesNotThrow(()=>new vm.Script(js));
 const home=read('marcosa-quiet.js');
 assert.doesNotThrow(()=>new vm.Script(home));
 assert.ok(home.includes("search.addEventListener('input',apply)"));
 for(const code of [js,home]){
  for(const forbidden of ['fetch(','XMLHttpRequest','WebSocket(','sendBeacon','innerHTML','eval('])
   assert.ok(!code.includes(forbidden),forbidden+' not allowed');
 }
});
test('R23 release asserts theme and includes all six original independent playable films',()=>{
 const gate=fs.readFileSync(path.join(ROOT,'tools/build_webroot.py'),'utf8');
 assert.ok(gate.includes('"marcosa-quiet.css", "marcosa-quiet.js"'));
 assert.ok(gate.includes('R23 quiet luxury stylesheet is incomplete'));
 const theater=read('cinema-pilot.html');
 for(const name of ['internet-v-humanity','protocol-zero','adverse-judge','signal-worlds','opspilot','intentgraph'])
  assert.ok(theater.includes('data-cp-film="'+name+'"'),name);
});
