'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),SITE=path.join(ROOT,'site');
const read=file=>fs.readFileSync(path.join(SITE,file),'utf8');
test('R26 real Social viewport becomes feed-first, not a full-screen static landing',()=>{
 const html=read('social.html');
 const css=read('marcosa-social-first.css');
 assert.ok(html.includes('id="so-feed"'),'real feed remains');
 assert.ok(html.includes('id="so-draft"'),'real private editor remains');
 assert.ok(html.includes('id="so-search"'),'actual search remains');
 assert.ok(html.includes('class="s26-quick"'),'active 3-way discovery nav');
 assert.ok(html.includes('href="./social.html?view=saved#so-feed"'),'real deep link to saved list');
 for(const token of ['href="#so-feed"','href="#so-draft"','id="so-saved-count"',
  'id="so-cards"','id="so-personal-note"','data-so-filter="saved"'])
  assert.ok(html.includes(token),token);
 assert.ok(html.indexOf('class="s26-quick"')>html.indexOf('class="so-hero"'));
 assert.ok(html.indexOf('class="s26-quick"')<html.indexOf('class="so-layout"'));
 assert.ok(css.includes('min-height:332px!important'),'desktop hero must be a teaser, not a takeover');
 assert.ok(css.includes('min-height:405px!important'),'mobile editorial smaller and usable');
 assert.ok(css.includes('grid-template-columns:repeat(2,minmax(0,1fr))!important'));
 assert.ok(css.includes('html[data-m-world="social"] .so-card[hidden]{display:none!important}'));
});
test('R26 real source imagery replaces cheap planets on Social cards',()=>{
 const css=read('marcosa-social-first.css');
 for(const marker of ['visual-cascade-director.webp','visual-cascade.webp','visual-station-director.webp',
 'visual-hero-director.webp','visual-archive-director.webp','visual-control-director.webp',
 '.so-cover:before','.so-cover:after','.so-cover-orbit','display:none!important'])
  assert.ok(css.includes(marker),marker);
 assert.doesNotMatch(css,/url\(["']?https?:\/\//,'no remote wallpaper services');
 assert.match(css,/@media\(max-width:720px\)/);
 assert.match(css,/@media\(max-width:380px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
test('R26 quick saved count is backed by real localStorage bookmarks',()=>{
 const js=read('social-core.js');
 assert.ok(js.includes("const quickCount=$('so-saved-count');"));
 assert.ok(js.includes('quickCount.textContent=String(saved.length)'));
 assert.ok(js.includes("saved.includes(card.dataset.soId)"));
 assert.ok(js.includes("root.localStorage.setItem(key,JSON.stringify(data))"));
 assert.ok(js.includes("body.textContent=value||''"));
 assert.doesNotThrow(()=>new vm.Script(js));
 for(const forbidden of ['fetch(','XMLHttpRequest','WebSocket(','sendBeacon(','innerHTML','eval('])
  assert.ok(!js.includes(forbidden),'must remain local-only');
});
test('R26 route keeps original social feature links and CSS loaded last',()=>{
 const html=read('social.html'),css=read('marcosa-social-first.css');
 assert.ok(html.indexOf('marcosa-social-first.css')>html.indexOf('marcosa-director.css'));
 for(const href of ['./cinema-pilot.html','./creator.html','./source-hub.html','./film-signal-worlds.html'])
  assert.ok(html.includes('href="'+href+'"'),href);
 assert.equal((html.match(/data-so-save=/g)||[]).length,4);
 assert.equal((html.match(/data-so-filter=/g)||[]).length,5);
 assert.ok(css.includes('.s26-quick-link:focus-visible'));
 assert.ok(css.includes('scroll-margin-top:30px'));
});
