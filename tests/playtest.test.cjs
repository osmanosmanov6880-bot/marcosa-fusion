'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto,createHash}=require('node:crypto');
const creator=require('../site/creator.js');
const playable=require('../site/creator-standalone.js');
const playtest=require('../site/creator-playtest.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const draft=()=>creator.demoDraft();
const make=(fingerprint,path,rating)=>({
  schema:playtest.SCHEMA,story_fingerprint:fingerprint,path,rating
});

test('R13 binds a voluntary feedback file to one exact story revision, independent of theme',async()=>{
  const data=draft();
  const fp=await playable.storyFingerprint(data,webcrypto);
  assert.match(fp,/^[0-9a-f]{64}$/);
  const html=await playable.buildPlayable(data,{theme:'aurora'},webcrypto);
  const match=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match);
  const encoded=match[1].match(/\)\("([A-Za-z0-9+/=]+)"\);$/);
  assert.ok(encoded);
  const embedded=JSON.parse(Buffer.from(encoded[1],'base64').toString('utf8'));
  assert.equal(embedded.story_fingerprint,fp);
  assert.equal(embedded.schema,'marcosa-standalone-playable/v1');
  assert.equal(embedded.endings.length,4);
  assert.equal(fp,await playable.storyFingerprint(copy(data),webcrypto));
  const other=copy(data);
  other.endings[1].body+=' Еще одна смысловая редакция финала.';
  assert.notEqual(fp,await playable.storyFingerprint(other,webcrypto));
  other.endings[1].body=data.endings[1].body;
  other.title='Совершенно другая история';
  assert.notEqual(fp,await playable.storyFingerprint(other,webcrypto));
  const initial=playable.authoredData(data);
  const expected=createHash('sha256').update(JSON.stringify(initial),'utf8').digest('hex');
  assert.equal(fp,expected,'canonical payload fingerprint must exclude theme, credentials and editor state');
});

test('R13 strict feedback parser allows ONLY a rating and one anonymous ending path',async()=>{
  const fp=await playable.storyFingerprint(draft(),webcrypto);
  const good=make(fp,'01',5);
  assert.deepEqual(playtest.parseReport(JSON.stringify(good)),good);
  assert.equal(playtest.MAX_FILE_BYTES,2048);
  assert.equal(playtest.MAX_BATCH,100);
  assert.equal(playtest.MAX_REPORTS,300);
  const attacks=[
    {...good,name:'John Doe'},
    {...good,ip:'127.0.0.1'},
    {...good,timestamp:'2026-10-24'},
    {...good,free_text:'hello'},
    {...good,email:'x@example.org'},
    {...good,tracking_cookie:'s'},
    {...good,session_id:'abc'},
    {...good,location:'home'},
    {...good,project_id:'another-story'},
    {...good,path:'01#<script>'},
    {...good,path:'02'},
    {...good,path:'000'},
    {...good,path:0},
    {...good,rating:0},
    {...good,rating:6},
    {...good,rating:'5'},
    {...good,rating:4.5},
    {...good,rating:null},
    {...good,story_fingerprint:'a'.repeat(63)},
    {...good,story_fingerprint:'A'.repeat(64)},
    {...good,story_fingerprint:'not-a-hash'},
    {...good,schema:'published-review/v1'}
  ];
  for(const attack of attacks){
    assert.throws(()=>playtest.validateReport(attack),/UNKNOWN_FEEDBACK_FIELD|INVALID_FEEDBACK/);
  }
  const pollution=JSON.parse(JSON.stringify(good).replace('"schema":','"__proto__":{"admin":true},"schema":'));
  assert.throws(()=>playtest.validateReport(pollution),/UNKNOWN_FEEDBACK_FIELD/);
  assert.throws(()=>playtest.parseReport('not JSON'),/INVALID_FEEDBACK_JSON/);
  assert.throws(()=>playtest.parseReport(' '.repeat(2049)),/FEEDBACK_TOO_LARGE/);
  assert.throws(()=>playtest.parseReport('{}'),/UNKNOWN_FEEDBACK_FIELD/);
  assert.throws(()=>playtest.parseReport(null),/FEEDBACK_TOO_LARGE/);
});

test('R13 aggregates report counts and averages for each of four endings, not user counts',async()=>{
  const fp=await playable.storyFingerprint(draft(),webcrypto);
  const reports=[
    make(fp,'00',5),make(fp,'00',3),make(fp,'01',2),
    make(fp,'10',4),make(fp,'10',5),make(fp,'10',3)
  ];
  const summary=playtest.aggregate(reports,fp);
  assert.equal(summary.schema,'marcosa-playtest-summary/v1');
  assert.equal(summary.imported_reports,6);
  assert.equal(summary.overall_average,3.67);
  assert.deepEqual(summary.endings.map(x=>x.path),['00','01','10','11']);
  assert.deepEqual(summary.endings.map(x=>x.count),[2,1,3,0]);
  assert.deepEqual(summary.endings.map(x=>x.average),[4,2,4,null]);
  assert.deepEqual(summary.endings[0].distribution,[0,0,1,0,1]);
  assert.deepEqual(summary.endings[2].distribution,[0,0,1,1,1]);
  assert.ok(summary.limitation.includes('not unique readers'));
  assert.deepEqual(playtest.aggregate([],fp).endings.map(x=>x.count),[0,0,0,0]);
  assert.equal(playtest.aggregate([],fp).overall_average,null);
  assert.throws(()=>playtest.aggregate([...reports,make('0'.repeat(64),'11',5)],fp),/DIFFERENT_STORY/);
  assert.throws(()=>playtest.aggregate(Array(301).fill(reports[0]),fp),/INVALID_ANALYSIS/);
  assert.throws(()=>playtest.aggregate([], 'invalid'),/INVALID_ANALYSIS/);
  assert.throws(()=>playtest.aggregate('invalid',fp),/INVALID_ANALYSIS/);
});

test('R13 standalone offline player includes an opt-in rating form with CSP and no telemetry',async()=>{
  const page=await playable.buildPlayable(draft(),{theme:'cosmos'},webcrypto);
  const script=page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const actualHash=createHash('sha256').update(script,'utf8').digest('base64');
  assert.ok(page.includes("script-src 'sha256-"+actualHash+"'"));
  assert.equal((page.match(/<script>/g)||[]).length,1);
  for(const id of ['play-feedback','play-rating-options','play-download-feedback',
    'play-feedback-status','feedback-heading','feedback-legend'])
    assert.ok(page.includes('id="'+id+'"'),id);
  for(const text of ['marcosa-playtest-feedback/v1','story.story_fingerprint',
    'selectedRating','path:history.join(', 'JSON.stringify(report,null,2)'])
    assert.ok(script.includes(text),text);
  for(const directive of ["default-src 'none'","connect-src 'none'","img-src 'none'",
    "form-action 'none'","object-src 'none'"])
    assert.ok(page.includes(directive),directive);
  for(const forbidden of [
    'fetch(', 'XMLHttpRequest','sendBeacon','new WebSocket(', 'localStorage',
    'sessionStorage','document.cookie','innerHTML','eval(','navigator.geolocation',
    'navigator.userAgent','Date.now(', 'new Date(', 'performance.now('
  ])assert.ok(!script.includes(forbidden),'Unexpected browser telemetry: '+forbidden);
  assert.equal(/<script[^>]+src=|<link\b|<img\b|<iframe\b/i.test(page),false);
});

test('R13 live Creator includes localized, accessible offline report dashboard without persistence',()=>{
  const folder=path.resolve(__dirname,'../site');
  const html=fs.readFileSync(path.join(folder,'creator.html'),'utf8');
  const js=fs.readFileSync(path.join(folder,'creator-playtest.js'),'utf8');
  const css=fs.readFileSync(path.join(folder,'creator.css'),'utf8');
  for(const id of [
    'mc-playtest','mc-playtest-heading','mc-playtest-files','mc-playtest-export',
    'mc-playtest-clear','mc-playtest-count','mc-playtest-average',
    'mc-playtest-results','mc-playtest-status'
  ])assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('src="./creator-playtest.js"'));
  assert.ok(html.includes('multiple accept=".json,application/json"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(js.includes('storyFingerprint(runtime.getEditedDraft()'),'version binding must be enforced');
  assert.ok(js.includes("clearData('stale')"),'editing invalidates old statistics');
  assert.ok(js.includes('win.setTimeout(()=>URL.revokeObjectURL(url),2000)'), 'release object URLs');
  assert.ok(css.includes('.mc-playtest-card'));
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  for(const lang of ['ru','en','zh']){
    assert.ok(playtest.COPY[lang].title.length>5);
    assert.ok(playtest.COPY[lang].caution.length>25);
    assert.ok(playtest.COPY[lang].wrong.length>8);
  }
  for(const api of [
    'fetch(', 'XMLHttpRequest','sendBeacon','new WebSocket(', 'localStorage',
    'sessionStorage','indexedDB.open(', 'document.cookie','innerHTML','eval(',
    'navigator.geolocation','navigator.userAgent','Date.now('
  ])assert.ok(!js.includes(api),'Analyst must not perform telemetry: '+api);
});
