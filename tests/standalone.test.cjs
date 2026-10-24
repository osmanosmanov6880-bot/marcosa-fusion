'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const creator=require('../site/creator.js');
const standalone=require('../site/creator-standalone.js');
function unpack(html){
  const script=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script,'exactly one inline player script');
  const payload=script[1].match(/\)\("([A-Za-z0-9+/=]+)"\);$/);
  assert.ok(payload,'author text must be encoded inside executable script');
  return JSON.parse(Buffer.from(payload[1],'base64').toString('utf8'));
}
test('R12 standalone HTML contains exactly two decisions and four original endings',async()=>{
  const draft=creator.demoDraft();
  const html=await standalone.buildPlayable(draft,{theme:'cosmos'},webcrypto);
  const data=unpack(html);
  assert.equal(data.schema,'marcosa-standalone-playable/v1');
  assert.deepEqual(data.opening,draft.opening);
  assert.deepEqual(data.branches,draft.branches);
  assert.deepEqual(data.endings,draft.endings);
  assert.equal(data.endings.length,4);
  assert.equal(data.branches.length,2);
  assert.equal(data.manual_approval,undefined);
  assert.equal(data.rights_self_attested,undefined);
  assert.equal((html.match(/<script>/g)||[]).length,1);
  assert.ok(Buffer.byteLength(html)<standalone.MAX_HTML_BYTES);
});
test('R12 content security policy cryptographically pins the exact player',async()=>{
  const html=await standalone.buildPlayable(creator.demoDraft(),{theme:'cosmos'},webcrypto);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash=createHash('sha256').update(script,'utf8').digest('base64');
  assert.ok(html.includes("script-src 'sha256-"+hash+"'"));
  for(const directive of ["default-src 'none'","connect-src 'none'","img-src 'none'",
    "object-src 'none'","form-action 'none'","base-uri 'none'"])
    assert.ok(html.includes(directive),directive);
  assert.equal(/<script[^>]+src=|<link\b|<img\b|<iframe\b/i.test(html),false);
  assert.equal(/https?:\/\//.test(html),false);
});
test('R12 HTML injection survives only as inert Base64 JSON, not raw executable markup',async()=>{
  const draft=creator.demoDraft();
  draft.title='My <script>evil()</script> game';
  draft.opening.scene='Scene with </script><img src=x onerror=alert(1)> and long fictional text.';
  draft.endings[3].body='Ending contains <iframe src="https://evil.invalid">HTML</iframe> as fiction.';
  const html=await standalone.buildPlayable(draft,{theme:'ember'},webcrypto);
  const data=unpack(html);
  assert.equal(data.title,draft.title);
  assert.equal(data.opening.scene,draft.opening.scene);
  assert.equal(data.endings[3].body,draft.endings[3].body);
  assert.ok(!html.includes('evil.invalid'));
  assert.ok(!html.includes('<img src=x'));
  assert.equal((html.match(/<\/script>/g)||[]).length,1);
  assert.ok(standalone.portablePlayer.toString().includes('caption.textContent=value'));
});
test('R12 rejects forged approvals, malformed authorship and invalid themes',async()=>{
  const draft=creator.demoDraft();
  draft.publication_state='published';
  await assert.rejects(standalone.buildPlayable(draft,{theme:'cosmos'},webcrypto),/INVALID_DRAFT_CONTRACT/);
  draft.publication_state='not_published';
  draft.title='X';
  await assert.rejects(standalone.buildPlayable(draft,{theme:'cosmos'},webcrypto),/INVALID_FIELD/);
  await assert.rejects(standalone.buildPlayable(creator.demoDraft(),{theme:'unknown'},webcrypto),/INVALID_PLAYABLE_THEME/);
  await assert.rejects(standalone.buildPlayable(creator.demoDraft(),{theme:'cosmos'},null),/WEBCRYPTO_UNAVAILABLE/);
});
test('R12 supports all locales and filenames cannot escape the download directory',async()=>{
  for(const lang of ['ru','en','zh']){
    const draft=creator.demoDraft();
    draft.language=lang;
    const html=await standalone.buildPlayable(draft,{theme:'aurora'},webcrypto);
    assert.equal(unpack(html).language,lang);
    assert.ok(html.includes('<html lang="'+lang+'"'));
    assert.ok(standalone.COPY[lang].title.length>5);
  }
  assert.equal(standalone.filename('Cyber City Story!'),'marcosa-story-cyber-city-story.html');
  assert.equal(standalone.filename('История Османа'),'marcosa-story-original.html');
  assert.equal(standalone.filename('../evil<script>.html'),'marcosa-story-evil-script-html.html');
});
test('R12 sandbox UI requires rights confirmation and makes no network calls',()=>{
  const root=path.resolve(__dirname,'../site');
  const html=fs.readFileSync(path.join(root,'creator.html'),'utf8');
  const source=fs.readFileSync(path.join(root,'creator-standalone.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'creator.css'),'utf8');
  for(const id of ['mc-standalone','mc-standalone-rights','mc-standalone-sponsor',
    'mc-standalone-privacy','mc-standalone-download','mc-standalone-preview',
    'mc-standalone-player','mc-standalone-feedback','mc-standalone-theme'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('src="./creator-standalone.js"'));
  assert.ok(html.includes('sandbox="allow-scripts"'));
  assert.ok(html.includes('referrerpolicy="no-referrer"'));
  assert.ok(source.includes('runtime.getEditedDraft()'));
  assert.ok(source.includes('if(download&&('));
  assert.ok(css.includes('.mc-standalone-card'));
  for(const forbidden of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket(',
    'localStorage', 'sessionStorage', 'indexedDB.open(', 'service_role',
    'document.cookie', 'innerHTML', 'eval('])
    assert.ok(!source.includes(forbidden),'forbidden '+forbidden);
});
