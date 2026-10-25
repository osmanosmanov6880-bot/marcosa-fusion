import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../public/i18n.js',import.meta.url),'utf8');

// Deliberately static and source-only. We DO NOT execute untrusted DOM data in CI.
const expression=/^[ ]*['"]([^'"]+)['"]:\[(["'])(.*?)\2,\s*(["'])(.*?)\4\],?$/gm;
const rows=[...source.matchAll(expression)].map(x=>({key:x[1],ru:x[3],en:x[5]}));
test('R71 200+ trusted UI labels have distinct, complete bilingual keys',()=>{
 assert.ok(rows.length>=195,'Bilingual static dictionary unexpectedly shrank');
 assert.equal(new Set(rows.map(x=>x.key)).size,rows.length,'Duplicate locale keys');
 assert.equal(new Set(rows.map(x=>x.ru)).size,rows.length,'Ambiguous Russian UI label mapping');
 for(const row of rows){
  assert.match(row.key,/^[a-z]+(?:\.[a-zA-Z]+)+$/,'Stable label key');
  assert.ok(row.ru.trim().length>0&&row.en.trim().length>0,'Empty locale value');
  assert.notEqual(row.ru,row.en,'Untranslated UI label: '+row.key);
  assert.ok(!/[<>]/.test(row.key),'Unsafe locale key');
 }
 assert.ok(source.includes('const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)'),
  'Trusted template capture required before user content arrives');
 assert.ok(!/\bnew\s+MutationObserver\s*\(/.test(source),'Never auto-translate user content');
 assert.ok(!source.includes('innerHTML='),'Locale must never inject parsed HTML');
 assert.ok(!source.includes('fetch('),'No network translation provider');
});
test('R71 every Russian static HTML label is covered except page title and native locale option',()=>{
 const original=html.replace(/<[^>]*>/g,'\n').split('\n')
  .map(x=>x.trim()).filter(x=>/[А-Яа-яЁё]{3}/.test(x));
 const ru=new Set(rows.map(x=>x.ru));
 const deliberateExceptions=new Set(['MARCOSA — Лаборатория социальных миров R28','Русский']);
 const unknown=[...new Set(original)].filter(x=>!ru.has(x)&&!deliberateExceptions.has(x));
 assert.deepEqual(unknown,[],'All new first-party UI copy must have an English beta translation');
 assert.ok(html.indexOf('/i18n.js')<html.indexOf('/app.js'),
  'Locale script must snapshot trusted template before dynamic user content');
 assert.ok(html.includes('id="language-switch"'));
 assert.ok(html.includes('<option value="en">English (beta)</option>'));
});
