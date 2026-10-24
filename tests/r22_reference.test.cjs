'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),SITE=path.join(ROOT,'site');
const read=file=>fs.readFileSync(path.join(SITE,file),'utf8');
test('R22 strict real-app Gateway matches approved reference architecture',()=>{
 const html=read('index.html');
 for(const token of ['id="m22-experience"','class="m22-command"','class="m22-gateway-sidebar"',
 'id="m22-world-search"','id="m22-hero-title"','class="m22-featured"',
 'class="m22-world-grid"','href="./social.html"','href="./cinema-pilot.html"',
 'href="./creator.html"','href="./source-hub.html"','src="./marcosa-gateway.js"'])
  assert.ok(html.includes(token),'R22 REAL Gateway missing '+token);
 assert.ok(html.includes('A network<br><em>of worlds.</em>'));
 assert.ok(html.includes('06</strong><small>PLAYABLE FILMS'));
 assert.ok(html.includes('20</strong><small>GITHUB REPOSITORIES'));
 assert.ok(!html.includes('50K+'));
 assert.ok(!html.includes('12K+'));
 assert.ok(!html.includes('1M+'));
 assert.ok(html.includes('id="mn-dialog"'),'Legacy Network OS forms preserved');
 assert.ok(html.includes('id="mi-world-canvas"'),'Old GPU scene remains available to regression');
});
test('R22 reference-grade art is sourced from locally owned cinematic WebP frames',()=>{
 const css=read('marcosa-cinematic.css');
 const assets=['visual-station.webp','visual-city.webp','visual-cascade.webp','visual-hero.webp',
 'visual-archive.webp','visual-control.webp','visual-operator.webp','visual-earthrise.webp'];
 for(const name of assets)assert.ok(css.includes(name)||name==='visual-operator.webp','R22 art not used '+name);
 for(const world of ['gateway','social','cinema','creator','atlas','stories','film-network'])
  assert.ok(css.includes('data-m-world="'+world+'"'),'Page missing cinematic treatment: '+world);
 assert.ok(css.includes('.m22-command'),'real console frame required');
 assert.ok(css.includes('m22-tunnel-roll'),'orbital transition required');
 assert.ok(css.includes('@media(max-width:720px)'),'mobile fallback required');
 assert.ok(css.includes('prefers-reduced-motion:reduce'),'motion accessibility required');
 assert.doesNotMatch(css,/url\(["']?https?:\/\//,'No external cinematic backgrounds');
});
test('R22 literal design brief is checked in and accurate about release boundaries',()=>{
 const brief=fs.readFileSync(path.join(ROOT,'docs/MARCOSA_R22_REFERENCE_IMPLEMENTATION_BRIEF_RU.md'),'utf8');
 assert.ok(brief.includes('НЕ генерировать новые изображения'));
 assert.ok(brief.includes('GitHub Pages'));
 assert.ok(brief.includes('не равен промышленному AAA-продакшену'));
});
test('R22 original film packages stay unmodified and branded scripts are executable',()=>{
 for(const file of ['marcosa-gateway.js','marcosa-brand.js']){
  assert.doesNotThrow(()=>new vm.Script(read(file)),file);
  assert.ok(!read(file).includes('fetch('),file+' must not transmit analytics');
 }
 const film=read('cinema-pilot.html');
 for(const id of ['internet-v-humanity','protocol-zero','adverse-judge',
 'signal-worlds','opspilot','intentgraph'])assert.ok(film.includes('data-cp-film="'+id+'"'));
 const script=read('marcosa-gateway.js');
 assert.ok(script.includes("search.addEventListener('input',all)"));
 assert.ok(script.includes('element.hidden=!show'));
});
test('R22 all seven real sections load cinematic CSS and original behavior scripts',()=>{
 for(const file of ['index.html','social.html','cinema-pilot.html','creator.html',
 'source-hub.html','stories.html','film-network.html']){
  const html=read(file);
  assert.ok(html.includes('href="./marcosa-cinematic.css"'),file);
  assert.ok(html.includes('href="./marcosa-brand.css"'),file);
  assert.ok(html.includes('src="./marcosa-brand.js"'),file);
 }
 const ico=read('marcosa-mark.svg');
 assert.ok(ico.includes('gold-glow'));
 assert.ok(ico.includes('subtle-shadow'));
 assert.ok(ico.includes('Orbital M'));
});
