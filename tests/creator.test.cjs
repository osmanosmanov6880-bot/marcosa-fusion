'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const creator=require('../site/creator.js');

const fresh=()=>creator.demoDraft();
const copy=x=>JSON.parse(JSON.stringify(x));

test('R8 ships a real two-decision tree with four independent, coherent endings',()=>{
  const original=fresh();
  assert.equal(creator.SCHEMA,'marcosa-original-story/v1');
  assert.equal(creator.normalizeDraft(original).schema,creator.SCHEMA);
  assert.equal(creator.SECTIONS.length,8);
  assert.equal(creator.FIELDS.length,22);
  assert.equal(original.branches.length,2);
  assert.equal(original.endings.length,4);
  assert.equal(original.publication_state,'not_published');
  assert.equal(original.tracking,false);
  let played=0;
  const texts=new Set();
  for(const first of [0,1])for(const second of [0,1]){
    const opening=creator.atStep(original,[]);
    assert.equal(opening.index,0);
    assert.equal(opening.ending,false);
    assert.equal(opening.choices.length,2);
    const history1=creator.takeChoice([],first);
    const branch=creator.atStep(original,history1);
    assert.equal(branch.index,1);
    assert.equal(branch.choices.length,2);
    assert.equal(branch.body,original.branches[first].scene);
    const history2=creator.takeChoice(history1,second);
    const ending=creator.atStep(original,history2);
    assert.equal(ending.index,2);
    assert.equal(ending.ending,true);
    assert.equal(ending.choices.length,0);
    assert.equal(ending.title,original.endings[first*2+second].title);
    texts.add(ending.title);
    assert.deepEqual(history1,[first],'pure choice function never mutates source history');
    played++;
  }
  assert.equal(played,4);
  assert.equal(texts.size,4);
  assert.deepEqual(creator.atStep(original,[]).choices,original.opening.choices);
});

test('R8 validates every author field and refuses malformed story branches and unsafe metadata',()=>{
  const good=fresh();
  assert.deepEqual(creator.normalizeDraft(good),good);
  for(const [pathKey,invalid] of [
    ['title','ab'],
    ['tagline','bad'],
    ['opening.scene','Short'],
    ['opening.question','tiny'],
    ['opening.choices.0','X'],
    ['branches.0.scene','No'],
    ['branches.1.choices.1','Z'],
    ['endings.0.title','Hi'],
    ['endings.3.body','too short'],
    ['opening.scene','X'.repeat(1101)],
    ['endings.2.body','X'.repeat(1301)]
  ]){
    const bad=copy(good);
    creator.writePath(bad,pathKey,invalid);
    assert.throws(()=>creator.normalizeDraft(bad),/INVALID_FIELD/,pathKey);
  }
  for(const key of ['title','tagline','opening.scene','endings.0.body']){
    const changed=copy(good);
    creator.writePath(changed,key,42);
    assert.throws(()=>creator.normalizeDraft(changed),/INVALID_FIELD/,key);
  }
  for(const key of ['tracking','payments','rights_independently_verified','manual_approval']){
    const changed=copy(good);
    changed[key]=true;
    assert.throws(()=>creator.normalizeDraft(changed),/INVALID_DRAFT_CONTRACT/,key);
  }
  const extra=copy(good);extra.secret_token='never export this';
  assert.throws(()=>creator.normalizeDraft(extra),/UNKNOWN_FIELD:draft/);
  const polluting=JSON.parse(JSON.stringify(good).replace(
    '"schema":', '"__proto__":{"injected":"x"},"schema":'));
  assert.throws(()=>creator.normalizeDraft(polluting),/UNKNOWN_FIELD:draft/);
  const branch=copy(good);branch.branches.push(copy(branch.branches[0]));
  assert.throws(()=>creator.normalizeDraft(branch),/BRANCH_COUNT/);
  const ending=copy(good);ending.endings.pop();
  assert.throws(()=>creator.normalizeDraft(ending),/ENDING_COUNT/);
  const unknown=copy(good);unknown.opening.arbitrary='payload';
  assert.throws(()=>creator.normalizeDraft(unknown),/UNKNOWN_FIELD:opening/);
  const review=copy(good);review.review_gates.shift();
  assert.throws(()=>creator.normalizeDraft(review),/INVALID_REVIEW_GATES/);
  const lang=copy(good);lang.language='javascript:';
  assert.throws(()=>creator.normalizeDraft(lang),/INVALID_DRAFT_CONTRACT/);
});

test('R8 export/import is portable, rights-gated and strictly draft-only',()=>{
  const draft=fresh();
  assert.throws(()=>creator.exportDraft(draft),/RIGHTS_REQUIRED/);
  draft.rights_self_attested=true;
  assert.throws(()=>creator.exportDraft(draft),/RIGHTS_REQUIRED/);
  draft.sponsorship_disclosure_committed=true;
  const json=creator.exportDraft(draft);
  assert.ok(json.endsWith('\n'));
  const restored=creator.parseDraftFile(json);
  assert.deepEqual(restored,draft);
  assert.equal(restored.status,'draft_only');
  assert.equal(restored.publication_state,'not_published');
  assert.equal(restored.rights_independently_verified,false);
  assert.equal(restored.manual_approval,false);
  assert.equal(restored.tracking,false);
  assert.equal(restored.payments,false);
  assert.ok(restored.review_gates.includes('manual_publication_approval'));
  assert.throws(()=>creator.parseDraftFile('{"not":"our-format"}'),/UNKNOWN_FIELD/);
  assert.throws(()=>creator.parseDraftFile(JSON.stringify({...draft,status:'published'})),/INVALID_DRAFT_CONTRACT/);
  assert.throws(()=>creator.parseDraftFile(' '.repeat(131073)),/INVALID_IMPORT_SIZE/);
  assert.throws(()=>creator.parseDraftFile(''),SyntaxError);
  assert.throws(()=>creator.parseDraftFile('{"__proto__":{"x":1}}'),/UNKNOWN_FIELD/);
});

test('R8 story text remains data (not HTML) and all paths are bounded',()=>{
  const raw=fresh();
  raw.endings[0].body='<img src=x onerror=alert(1)> '+
    'This is fictional user-provided writing for a story, not trusted markup.';
  raw.opening.scene='The director wrote <script>alert(1)</script> as a quoted scene in the story.';
  const validated=creator.normalizeDraft(raw);
  assert.match(validated.endings[0].body,/<img src=x onerror=/);
  assert.match(validated.opening.scene,/<script>/);
  assert.throws(()=>creator.takeChoice([],2),/INVALID_CHOICE/);
  assert.throws(()=>creator.takeChoice([0,0],1),/INVALID_CHOICE/);
  assert.throws(()=>creator.takeChoice([1,'0'],1),/INVALID_CHOICE/);
  assert.throws(()=>creator.atStep(raw,[2]),/INVALID_HISTORY/);
  assert.throws(()=>creator.atStep(raw,[0,0,1]),/INVALID_HISTORY/);
  const js=fs.readFileSync(path.join(__dirname,'../site/creator.js'),'utf8');
  assert.ok(js.includes('.textContent'));
  for(const forbidden of [
    'fetch(', 'XMLHttpRequest','sendBeacon','localStorage','sessionStorage',
    'document.cookie','innerHTML','eval(', 'new Function(', 'https://cdn', 'new Image('
  ])assert.equal(js.includes(forbidden),false,'forbidden API: '+forbidden);
});

test('R8 localized authoring and navigation exists with accessible controls',()=>{
  const root=path.join(__dirname,'../site');
  const html=fs.readFileSync(path.join(root,'creator.html'),'utf8');
  const stories=fs.readFileSync(path.join(root,'stories.html'),'utf8');
  const home=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'creator.css'),'utf8');
  const storyJs=fs.readFileSync(path.join(root,'stories.js'),'utf8');
  const creatorJs=fs.readFileSync(path.join(root,'creator.js'),'utf8');
  const actualIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const queriedIds=[...new Set([...creatorJs.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]))];
  for(const id of queriedIds)assert.ok(actualIds.has(id),'missing creator DOM id: '+id);
  for(const id of [
    'mc-editor','mc-preview','mc-fields','mc-apply','mc-download','mc-import',
    'mc-reset','mc-rights','mc-disclose','mc-story-language','mc-play-title',
    'mc-play-copy','mc-play-question','mc-choice-list','mc-back','mc-restart',
    'mc-feedback','mc-progress','mc-progress-fill','mc-dirty','mc-graph'
  ])assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('src="./creator.js"'));
  assert.ok(html.includes('href="./creator.css"'));
  assert.ok(html.includes('role="status" aria-live="polite"'));
  assert.ok(html.includes('role="progressbar"'));
  assert.ok(html.includes('type="file"'));
  assert.ok(stories.includes('href="./creator.html"'));
  assert.ok(home.includes('href="./creator.html"'));
  assert.ok(storyJs.includes("openCreator:'"));
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/\[hidden\]/);
  for(const language of ['ru','en','zh']){
    assert.ok(creator.UI[language].heading.length>10);
    assert.equal(creator.UI[language].sections.length,8);
    assert.ok(creator.UI[language].statusNeedRights.length>8);
  }
});
