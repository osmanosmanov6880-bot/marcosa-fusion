'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {record,validateList,readBackup,merge,format,version,maxItems,maxBody}=require('../site/social-journal.js');
const ROOT=path.resolve(__dirname,'..'),SITE=path.join(ROOT,'site');
const read=x=>fs.readFileSync(path.join(SITE,x),'utf8');
const baseline=(id='mj-a1b2c3d4')=>({
 id,title:'Идея проекта',body:'Создать работающий проект на основе реальной потребности.',
 category:'idea',createdAt:'2026-10-24T09:00:00.000Z',
 updatedAt:'2026-10-24T09:00:01.000Z',pinned:false
});
test('R27 journal schema safely accepts real local notes',()=>{
 assert.equal(format,'MARCOSA-JOURNAL');
 assert.equal(version,1);
 assert.equal(maxItems,40);
 assert.equal(maxBody,2000);
 assert.deepEqual(record(baseline()),baseline());
 assert.equal(record({...baseline(),title:'  Название  '}).title,'Название');
 assert.deepEqual(validateList([baseline()]),[baseline()]);
});
test('R27 rejects malformed imported IDs, categories, scripts as keys, lengths, timestamps and duplicates',()=>{
 for(const patch of [
  {id:'<script>alert(1)</script>'},{id:'__proto__'},{category:'__proto__'},
  {category:'remote'},{title:' '},{body:''},{title:'a'.repeat(91)},
  {body:'b'.repeat(2001)},{createdAt:'yesterday'},{updatedAt:'xyz'},
  {pinned:0}
 ])assert.throws(()=>record({...baseline(),...patch}));
 assert.throws(()=>validateList([baseline(),baseline()]),/Дублированный/);
 assert.throws(()=>validateList(Array.from({length:41},(_,i)=>baseline('mj-id'+String(i).padStart(8,'0')))),/Слишком много/);
});
test('R27 importer rejects JSON injection, wrong format, too-large, malformed and duplicate backup',()=>{
 const valid=JSON.stringify({format,version,items:[baseline()]});
 assert.deepEqual(readBackup(valid),[baseline()]);
 for(const invalid of [
   'not json',JSON.stringify({format:'other',version,items:[]}),
   JSON.stringify({format,version:10,items:[]}),
   JSON.stringify({format,version,items:[baseline(),baseline()]}),
   'x'.repeat(250001),
   JSON.stringify({format,version,items:[{...baseline(),category:'constructor'}]})
 ])assert.throws(()=>readBackup(invalid));
});
test('R27 import merges, preserves existing records, skips duplicate IDs and caps capacity',()=>{
 const old=baseline();
 const newer=baseline('mj-abcdef0123');
 const merged=merge([old],[{...old,body:'do not overwrite existing'},newer]);
 assert.deepEqual(merged,{items:[old,newer],added:1,duplicates:1,overflow:0});
 const full=Array.from({length:40},(_,i)=>baseline('mj-id'+String(i).padStart(8,'0')));
 const result=merge(full,[newer]);
 assert.equal(result.items.length,40);
 assert.equal(result.overflow,1);
 assert.equal(result.added,0);
});
test('R27 real Social DOM has accessible editor, keyboard import, view and fallback links',()=>{
 const html=read('social.html');
 for(const id of ['so-journal','s27-editor','s27-title-input','s27-body','s27-category',
  's27-list','s27-count','s27-save','s27-reset','s27-search','s27-filter','s27-sort',
  's27-export','s27-import-trigger','s27-import','s27-undo','s27-empty','s27-feedback','s27-shortcut-count'])
  assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 for(const link of ['href="#so-journal"','href="./marcosa-journal.css"','src="./social-journal.js"'])
  assert.ok(html.includes(link),'missing linked component '+link);
 assert.ok(html.includes('не публикуется другим людям'));
 assert.ok(html.includes('JSON-архив не зашифрован'));
 assert.ok(read('social-journal.js').includes("quick.textContent=String(records.length)"));
 assert.ok(html.indexOf('marcosa-journal.css')>html.indexOf('marcosa-social-first.css'));
 assert.ok(html.indexOf('social-journal.js')>html.indexOf('social-core.js'));
});
test('R27 editor never inserts user-controlled HTML and has no networking',()=>{
 const js=read('social-journal.js'),css=read('marcosa-journal.css');
 for(const unsafe of ['innerHTML','insertAdjacentHTML','eval(','XMLHttpRequest','sendBeacon(','fetch(','WebSocket('])
  assert.ok(!js.includes(unsafe),unsafe);
 for(const needed of ['.s27-workspace','.s27-entry-actions','.s27-editor',
  '.s27-entry-title','@media(max-width:800px)','@media(prefers-reduced-motion:reduce)'])
  assert.ok(css.includes(needed),needed);
 assert.doesNotMatch(css,/url\(["']?https?:\/\//,'no image tracking or remote fonts');
 assert.ok(js.includes('textContent'),'all user content rendered via DOM text nodes');
 assert.ok(js.includes('locked=true'),'corrupt storage never overwritten silently');
});
