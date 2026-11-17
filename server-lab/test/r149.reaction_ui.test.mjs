import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function client(fetch){
 const inert={addEventListener(){},dataset:{}};
 const document={...inert,body:inert,getElementById:()=>inert,querySelector:()=>inert};
 const window={...inert};
 const context={window,document,fetch:path=>path.includes('/posts/reactions')?fetch(path):new Promise(()=>{}),URLSearchParams};
 // Expose the internal renderer in this VM only; execute the real UI and API wrapper.
 runInNewContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.client={readReactionBars,state};})();'),context);
 context.client.state.me={username:'reader'};
 return context.client;
}
function bar(id,owner='writer'){
 const button={dataset:{reaction:'like'},classList:{toggle(){}},setAttribute(key,val){this[key]=val;}};
 return {dataset:{postId:String(id),owner},querySelectorAll:()=>[button],button};
}
const response=items=>({ok:true,json:async()=>({items})});
test('all pages hydrate and respect privacy, ownership, duplicate cards and the API bounds',async()=>{
 const batches=[];
 const ui=client(async path=>{
  const raw=path.split('ids=')[1],ids=raw.split(',').map(Number);
  batches.push(ids);assert.ok(raw.length<=180 && ids.length<=30);
  return response(ids.filter(id=>id!==9).map(postId=>({postId,counts:{like:4},mine:'like'})));
 });
 const cards=Array.from({length:71},(_,i)=>bar(i+1));
 cards.push(bar(22),bar(8,'reader'),...Array.from({length:25},(_,i)=>bar(100000000000000+i)));
 await ui.readReactionBars(cards);
 assert.deepEqual(batches.flat(),[...new Set(cards.map(c=>Number(c.dataset.postId)))]);
 for(const card of cards){
  const invisible=card.dataset.postId==='9';
  assert.equal(card.hidden,invisible);
  assert.equal(card.button.disabled,invisible || card.dataset.owner==='reader');
  assert.equal(card.button['aria-pressed'],String(!invisible));
 }
});
test('late response cannot restore a reaction after a fresher read revoked access',async()=>{
 const pending=[];
 const ui=client(()=>new Promise(resolve=>pending.push(resolve)));
 const target=bar(3);
 const old=ui.readReactionBars([target]),fresh=ui.readReactionBars([target]);
 pending[1](response([]));await fresh;
 pending[0](response([{postId:3,mine:'like',counts:{like:1}}]));await old;
 assert.equal(target.hidden,true);assert.equal(target.button.disabled,true);
});
