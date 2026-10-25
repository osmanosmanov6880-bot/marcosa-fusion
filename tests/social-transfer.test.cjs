'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const api=require('../site/social-transfer.js');
const ROOT=path.resolve(__dirname,'..');
const SAVED='marcosa-social-private-saved-v1';
const DRAFT='marcosa-social-private-draft-v1';
const instant='2026-10-26T00:00:00.000Z';

function fakeStore(original={},failKey){
 const data=new Map(Object.entries(original));
 return {
  getItem(k){return data.has(k)?data.get(k):null;},
  setItem(k,v){if(k===failKey)throw Error('quota');data.set(k,String(v));},
  removeItem(k){data.delete(k);},
  entries(){return Object.fromEntries(data);}
 };
}

test('R110: strictly typed and bounded portable JSON roundtrips private draft/bookmarks',()=>{
 const data={saved:['cinema','creator'],draft:'Новая идея\nпроект'};
 const encoded=api.backup(data,instant);
 assert.equal(api.format,'MARCOSA-SOCIAL-TRANSFER');
 assert.equal(api.version,1);
 assert.deepEqual(api.parseBackup(encoded),data);
 assert.ok(encoded.includes('"version": 1'));
 assert.ok(encoded.length<api.maxBackup);
});
test('R110: reject invalid format, prototype pollution, duplicates, HTML IDs, corruption and oversize',()=>{
 const valid=JSON.parse(api.backup({saved:['signal'],draft:'мой черновик'},instant));
 for(const mutant of [
   {format:'wrong'}, {version:2},{saved:['cinema','cinema']},
   {saved:['__proto__']},{saved:['<img src=x>']},
   {saved:'cinema'},{draft:123},{draft:'x'.repeat(701)},
   {exportedAt:'invalid'},{unknownField:true}
 ]){
  const payload=JSON.stringify({...valid,...mutant});
  assert.throws(()=>api.parseBackup(payload),/архив|заклад|Черновик|Список|JSON|дата/i,payload.slice(0,80));
 }
 assert.throws(()=>api.parseBackup('not JSON'));
 assert.throws(()=>api.parseBackup('x'.repeat(api.maxBackup+1)));
 assert.throws(()=>api.parseBackup('[]'));
});
test('R110: imported saves merge, existing private draft wins conflict and no duplicate saved IDs',()=>{
 const local={saved:['cinema','signal'],draft:'Мой несинхронизированный черновик'};
 const from={saved:['signal','atlas'],draft:'Другой черновик'};
 const m=api.merge(local,from);
 assert.deepEqual(m.saved,['cinema','signal','atlas']);
 assert.equal(m.draft,local.draft);
 assert.equal(m.conflict,true);
 assert.equal(m.added,1);
 assert.equal(m.importedDraft,false);
 const fresh=api.merge({saved:[],draft:''},from);
 assert.equal(fresh.draft,from.draft);
 assert.equal(fresh.importedDraft,true);
});
test('R110: persist/read storage with same local keys as existing Social Core',()=>{
 const store=fakeStore();
 const data=api.persist(store,{saved:['creator','atlas'],draft:'Дагестан \n Привет'});
 assert.deepEqual(api.state(store),data);
 assert.equal(JSON.parse(store.getItem(SAVED)).length,2);
 assert.equal(JSON.parse(store.getItem(DRAFT)),data.draft);
});
test('R110: malformed existing local storage blocks new import without overwriting anything',()=>{
 const store=fakeStore({[SAVED]:'{"bad":true}',[DRAFT]:JSON.stringify('old')});
 const before=store.entries();
 assert.throws(()=>api.state(store));
 assert.deepEqual(store.entries(),before);
});
test('R110: if second storage write fails, first write is restored and failure surfaced',()=>{
 const old={[SAVED]:JSON.stringify(['cinema']),[DRAFT]:JSON.stringify('old')};
 const store=fakeStore(old,DRAFT);
 assert.throws(()=>api.persist(store,{saved:['creator'],draft:'new'}),/Сохранение не выполнено/);
 assert.deepEqual(store.entries(),old);
});
test('R110: UI is wired into the real Social document and existing feed refreshes without network',()=>{
 const html=fs.readFileSync(path.join(ROOT,'site/social.html'),'utf8');
 const core=fs.readFileSync(path.join(ROOT,'site/social-core.js'),'utf8');
 const code=fs.readFileSync(path.join(ROOT,'site/social-transfer.js'),'utf8');
 const css=fs.readFileSync(path.join(ROOT,'site/marcosa-social-first.css'),'utf8');
 for(const id of ['so-transfer-panel','so-transfer-export','so-transfer-import-trigger',
  'so-transfer-import','so-transfer-feedback'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(html.includes('src="./social-transfer.js"'));
 assert.ok(core.includes("root.addEventListener('marcosa:social-transfer'"));
 assert.ok(core.includes('bookmarks();render();'));
 assert.ok(code.includes("root.dispatchEvent(new root.Event('marcosa:social-transfer'))"));
 assert.ok(code.includes('root.confirm('));
 assert.ok(css.includes('.s110-transfer-actions button:focus-visible'));
 assert.match(css,/background:linear-gradient\(135deg,#29243d,#171726\)/);
 assert.ok(code.includes('Добавлена 1 закладка.'));
 assert.ok(code.includes("qty>=2&&qty<=4"));
 assert.ok(css.includes('@media(max-width:380px)'));
 for(const unsafe of ['fetch(', 'XMLHttpRequest', 'sendBeacon(', 'WebSocket(', 'innerHTML', 'eval(', 'insertAdjacentHTML'])
  assert.ok(!code.includes(unsafe),'no network or HTML parsing in importer: '+unsafe);
});
