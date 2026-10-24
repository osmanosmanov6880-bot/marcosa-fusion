'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),SITE=path.join(ROOT,'site');
const read=x=>fs.readFileSync(path.join(SITE,x),'utf8');
const routes=[
 ['index.html','gateway'],['social.html','social'],['cinema-pilot.html','cinema'],
 ['creator.html','creator'],['source-hub.html','atlas'],
 ['stories.html','stories'],['film-network.html','film-network']
];
test('R24 nine-panel dark reference is a REAL three-column app, not a white static mockup',()=>{
 const html=read('index.html');
 for(const expected of [
  'id="m22-experience"','class="m22-gateway-sidebar"',
  'class="m22-console"','class="m22-featured"','id="m22-world-search"',
  'id="m22-hero-title"','class="m22-world-grid"','class="m24-community"',
  'href="./social.html?view=saved#so-feed"','href="./social.html#so-draft"',
  'href="./cinema-pilot.html"','href="./creator.html"','href="./source-hub.html"'])
  assert.ok(html.includes(expected),'missing REAL dark app element '+expected);
 assert.match(html,/A network<br><em>of worlds\.<\/em>/);
 assert.ok(html.includes('aria-labelledby="m22-hero-title"'));
 assert.ok(html.includes('20</strong><small>РЕПОЗИТОРИЕВ В КАТАЛОГЕ'));
 assert.ok(!html.includes('50K+'));
 assert.ok(!html.includes('1M+'));
 assert.ok(html.includes('id="mn-dialog"'),'existing Network OS project catalog must survive');
 assert.ok(html.includes('id="mi-world-canvas"'),'R4 rendering pipeline is preserved for rollback');
});
test('R24 dark design replaces visible R23 white but keeps source-safe rollback',()=>{
 const css=read('marcosa-nocturne.css');
 for(const item of ['.q23-home{display:none!important}','.m22-experience{display:block!important',
  '.m22-command{display:grid!important','url("./visual-city.webp")','html[data-m-world="social"] .so-shell',
  'html[data-m-world="social"] .so-hero','url("./visual-cascade.webp")',
  'html[data-m-world="cinema"] .cp-hero','html[data-m-world="creator"] .mc-hero',
  'html[data-m-world="atlas"] .sh-hero','.m24-community-actions',
  '@media(max-width:720px)','@media(max-width:380px)','prefers-reduced-motion:reduce'])
  assert.ok(css.includes(item),'Nocturne missing '+item);
 assert.doesNotMatch(css,/url\(["']?https?:\/\//,'No outside image or font CDN');
 for(const [file,world] of routes){
  const html=read(file);
  assert.ok(html.includes('data-m-world="'+world+'"'),file);
  const pos=html.indexOf('href="./marcosa-nocturne.css"');
  assert.ok(pos>=0,file+' missing live theme');
  assert.ok(pos>html.indexOf('href="./marcosa-quiet.css"'),file+' override order is broken');
 }
});
test('R24 branded gold M keeps depth without giant planetary interface effects',()=>{
 const svg=read('marcosa-mark.svg');
 assert.match(svg,/Orbital M/);
 assert.match(svg,/матового шампанского/);
 assert.match(svg,/linearGradient/);
 assert.match(svg,/subtle-shadow/);
 assert.match(svg,/gold-glow/);
 assert.match(svg,/<ellipse /);
 const css=read('marcosa-nocturne.css');
 assert.match(css,/\.m22-art-depth,[\s\S]*\.m22-beamline\{display:none!important\}/);
 assert.match(css,/\.m-transition:before,html\[data-m-world\] \.m-transition:after\{display:none!important\}/);
});
test('R24 Social is honest local-first with a real saved-only deep-link',()=>{
 const html=read('social.html'),logic=read('social-core.js');
 for(const element of ['id="so-search"','id="so-cards"','id="so-save-draft"',
  'id="so-clear-draft"','data-so-filter="saved"','id="so-personal-note"'])
  assert.ok(html.includes(element),element);
 assert.ok(logic.includes("new URLSearchParams(root.location.search).get('view')==='saved'"));
 assert.ok(logic.includes("filter==='saved'?saved.includes(card.dataset.soId)"));
 assert.ok(logic.includes("body.textContent=value||''"));
 assert.doesNotThrow(()=>new vm.Script(logic));
 for(const unsafe of ['XMLHttpRequest','sendBeacon','WebSocket(','fetch(','innerHTML','eval('])
  assert.ok(!logic.includes(unsafe),unsafe+' unexpectedly in Social local-only JS');
});
test('R24 all six playable cinema routes remain independent and build/test scope includes dark file',()=>{
 const film=read('cinema-pilot.html');
 for(const name of ['internet-v-humanity','protocol-zero','adverse-judge','signal-worlds','opspilot','intentgraph'])
  assert.ok(film.includes('data-cp-film="'+name+'"'),name);
 const builder=fs.readFileSync(path.join(ROOT,'tools/build_webroot.py'),'utf8');
 assert.match(builder,/marcosa-nocturne\.css/);
 assert.match(builder,/R24 real social-first dark Gateway missing/);
 const qa=fs.readFileSync(path.join(ROOT,'tools/r24_nocturne_cdp.cjs'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(qa));
 assert.ok(qa.includes('R24_REJECTED_WHITE_EDITORIAL_VISIBLE'));
 assert.ok(qa.includes('R24_SAVED_DEEP_LINK_NOT_FUNCTIONAL'));
 assert.ok(qa.includes('width:360'));
});
