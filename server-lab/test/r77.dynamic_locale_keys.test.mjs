import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const catalog=readFileSync(new URL('../public/i18n.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const dynamic=[...catalog.matchAll(/^[ ]*["'](dynamic\.[a-zA-Z.]+)["']:\[(["'])(.*?)\2,\s*(["'])(.*?)\4\],?$/gm)]
 .map(m=>({key:m[1],ru:m[3],en:m[5]}));
const references=new Set([...app.matchAll(/["'](dynamic\.[a-zA-Z.]+)["']/gm)].map(m=>m[1]));

test('R77 all app-owned dynamic strings are bilingual, unique and actually referenced',()=>{
 assert.ok(dynamic.length>=42,'Unexpected loss of dynamic RU/EN labels');
 assert.equal(new Set(dynamic.map(d=>d.key)).size,dynamic.length);
 assert.equal(new Set(dynamic.map(d=>d.ru)).size,dynamic.length,'Russian text ambiguity would translate the wrong UI label');
 for(const {key,ru,en} of dynamic){
  assert.match(key,/^dynamic(?:\.[a-zA-Z]+)+$/);
  assert.ok(ru.trim()&&en.trim());
  assert.notEqual(ru,en,'Untranslated label '+key);
  assert.ok(references.has(key),'Unused or orphaned label '+key);
 }
 const keys=new Set(dynamic.map(x=>x.key));
 assert.deepEqual([...references].filter(key=>!keys.has(key)),[],'Every locale lookup must have a trusted catalog key');
});

test('R77 dynamic rendering translates only explicitly-owned UI, never posts or usernames',()=>{
 assert.match(app,/const systemNode=\(tag,key,text,cls=''\)=>/);
 assert.match(app,/el\.dataset\.i18nDynamic=key/);
 assert.match(app,/for\(const el of document\.querySelectorAll\('\[data-i18n-dynamic\]'\)\)/);
 assert.match(app,/for\(const el of document\.querySelectorAll\('\[data-i18n-dynamic-prefix\]'\)\)/);
 assert.match(app,/for\(const el of document\.querySelectorAll\('\[data-i18n-placeholder\]'\)\)/);
 assert.ok(app.includes("node('p',post.body,'post-body')"),'User post body must remain plain text');
 assert.ok(app.includes("node('h3',world.title)"),'User World title must remain plain text');
 assert.ok(app.includes("node('p',item.body,'comment-copy')"),'User comment must remain plain text');
 assert.ok(!/\binnerHTML\s*=/.test(app),'Dynamic locale must never parse user-controlled HTML');
 assert.ok(!/new\s+MutationObserver\s*\(/.test(app),'No automatic mutation-based translation of user data');
 assert.ok(app.includes("summary.dataset.i18nDynamicPrefix='dynamic.discussion.title'"));
 assert.ok(app.includes("block.dataset.i18nSuffix=world.owner"));
 assert.ok(app.includes("toggle.dataset.i18nDynamic=wasSaved?"));
});

test('R77 exact fallback for user text and forms is preserved on language change',()=>{
 assert.ok(app.includes("input.dataset.i18nPlaceholder='dynamic.comments.placeholder'"));
 assert.ok(app.includes("const i18n=()=>window.MARCOSA_LOCALE"));
 assert.ok(app.includes("const localText=(key,fallback)=>i18n()?.t(key)||fallback"));
 assert.ok(app.includes("const block=node('button',localText('dynamic.world.block','Заблокировать @')+world.owner"));
});
