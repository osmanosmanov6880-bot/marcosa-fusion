'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),SITE=path.join(ROOT,'site');
const read=file=>fs.readFileSync(path.join(SITE,file),'utf8');
const routes=[
 ['index.html','gateway'],['social.html','social'],['cinema-pilot.html','cinema'],
 ['creator.html','creator'],['source-hub.html','atlas'],
 ['stories.html','stories'],['film-network.html','film-network']
];
test('R25 user-visible cinematic film frames are real selectable interactive controls',()=>{
 const html=read('index.html');
 assert.ok(html.includes('id="m22-experience"'),'keep actual R24 reference');
 assert.ok(html.includes('id="m25-scene-chooser"'),'missing live frame selector');
 assert.ok(html.includes('class="m22-artwork m25-artwork"'));
 for(const id of ['city','cinema','studio']){
  assert.ok(html.includes('data-m25-scene="'+id+'"'),id+' needs working control');
  assert.ok(html.includes('data-m25-visual="'+id+'"'),id+' needs its source-owned still');
 }
 assert.equal((html.match(/data-m25-scene=/g)||[]).length,3);
 assert.equal((html.match(/data-m25-visual=/g)||[]).length,3);
 assert.ok(html.includes('src="./marcosa-director.js"'));
 assert.ok(html.includes('<img src="./marcosa-mark.svg"'),'real gold brand mark in header');
});
test('R25 art direction is bound on all seven actual world routes after previous themes',()=>{
 const css=read('marcosa-director.css');
 for(const marker of ['.m25-visual--city','.m25-visual--cinema','.m25-visual--studio',
  '.m25-visual.is-active{opacity:1}', '.m25-scene-control button[aria-pressed="true"]',
  '.m22-world-card', '.m22-featured', '.m22-artwork',
  '.so-art', '.cp-hero', '.mc-hero', '.sh-hero', '.ms-hero', '.fn-hero',
  '@media(max-width:720px)', '@media(max-width:380px)', 'prefers-reduced-motion:reduce'])
  assert.ok(css.includes(marker),marker);
 assert.doesNotMatch(css,/url\(["']?https?:\/\//,'Only local, owned images can be used');
 for(const [name,world] of routes){
  const html=read(name);
  const old=html.indexOf('href="./marcosa-nocturne.css"');
  const newer=html.indexOf('href="./marcosa-director.css"');
  assert.ok(old>=0&&newer>old,world+' new layer must override R24');
 }
});
test('R25 cinematic JS retains real navigation, reduces motion and never transmits data',()=>{
 const js=read('marcosa-director.js');
 assert.doesNotThrow(()=>new vm.Script(js));
 for(const feature of ['data-m25-scene','aria-pressed', 'ArrowRight', 'ArrowLeft',
  'prefers-reduced-motion: reduce', 'pointermove', 'pointerleave',
  'localOnly:true', 'sourceArtOnly:true', "scene='city'", 'setAttribute'])
  assert.ok(js.includes(feature),'missing actual interaction: '+feature);
 for(const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'sendBeacon(',
  'innerHTML=', 'eval(', 'localStorage', 'setInterval('])
  assert.ok(!js.includes(forbidden),'unwanted remote state/unsafe DOM: '+forbidden);
});
test('R25 deterministic owned-WebP grade remains source-verified and does not fake AI 4K',()=>{
 const py=fs.readFileSync(path.join(ROOT,'tools/r25_grade_cinematic_assets.py'),'utf8');
 const builder=fs.readFileSync(path.join(ROOT,'tools/build_webroot.py'),'utf8');
 const workflow=fs.readFileSync(path.join(ROOT,'.github/workflows/marcosa-public-pages.yml'),'utf8');
 for(const source of ['visual-city.webp','visual-cascade.webp','visual-hero.webp',
    'visual-archive.webp','visual-control.webp','visual-station.webp']){
  assert.ok(py.includes(source));
  assert.ok(py.includes(source.replace('.webp','-director.webp')));
 }
 assert.match(py,/UnsharpMask/);
 assert.match(py,/ImageEnhance.Contrast/);
 assert.match(py,/1600, 900/);
 assert.match(builder,/place_director_grade\(tmp, manifest\)/);
 assert.match(workflow,/Pillow==12\.0\.0/);
 assert.match(workflow,/dist\/visual-city-director.webp/);
});
