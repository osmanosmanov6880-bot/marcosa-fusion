'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const story=require('../site/stories.js');
const network=require('../site/network.js');

test('3 fictional stories, 2 meaningful choices each, 12 valid explained endings',()=>{
  assert.equal(story.STORIES.length,3);
  const slugs=new Set(network.products.map(p=>p.slug));
  const ids=new Set();
  let checked=0;
  for(const s of story.STORIES){
    assert.ok(!ids.has(s.id));ids.add(s.id);
    assert.equal(s.steps.length,2);
    assert.deepEqual(Object.keys(s.endings).sort(),['00','01','10','11']);
    assert.match(s.id,/^[a-z0-9-]+$/);
    assert.ok(s.title.ru&&s.title.en&&s.title.zh);
    for(const step of s.steps){
      assert.equal(step.choices.length,2);
      for(const lang of ['ru','en','zh']){
        assert.ok(step.title[lang]&&step.body[lang]&&step.question[lang]);
        assert.ok(step.choices.every(c=>c[lang].length>2));
      }
    }
    for(const a of [0,1])for(const b of [0,1]){
      const start=story.createState(s.id);
      assert.deepEqual(start.answers,[]);
      const middle=story.advance(start,a);
      assert.deepEqual(start.answers,[],'original state must remain unchanged');
      assert.deepEqual(middle.answers,[a]);
      const finished=story.advance(middle,b);
      assert.deepEqual(finished.answers,[a,b]);
      const out=story.outcome(finished);
      assert.ok(out,'every ending resolves');
      assert.ok(slugs.has(out.product),'no invented or invalid product');
      assert.equal(network.products.find(p=>p.slug===out.product).live,false,'unverified source products stay unlaunched');
      for(const lang of ['ru','en','zh'])
        assert.ok(out.title[lang]&&out.body[lang]&&out.because[lang],'localized transparent recommendation');
      assert.deepEqual(story.rewind(finished),middle);
      assert.throws(()=>story.advance(finished,0),/STORY_ALREADY_COMPLETE/);
      checked++;
    }
  }
  assert.equal(checked,12);
  assert.throws(()=>story.createState('nonexistent'),/UNKNOWN_STORY/);
  assert.throws(()=>story.advance(story.createState('signal'),2),/INVALID_CHOICE/);
  assert.equal(story.outcome(story.createState('world-zero')),null);
});

test('contextual catalogue and house-campaign routes are whitelisted, never arbitrary URLs',()=>{
  assert.deepEqual(network.parseNetworkRoute('#network'),{tab:'products',slug:null});
  assert.deepEqual(network.parseNetworkRoute('#network-product=proofos'),{tab:'products',slug:'proofos'});
  assert.deepEqual(network.parseNetworkRoute('#network-campaign=signal-worlds'),{tab:'campaign',slug:'signal-worlds'});
  for(const h of [
    '#network-product=javascript:alert(1)','#network-product=https://evil.com',
    '#network-product=unknown-product','#network-campaign=%2e%2e',
    '#network-product=proofos?redirect=elsewhere','#network-product=PROOFOS',
    '#network-product=proofos/../../foo'
  ])assert.equal(network.parseNetworkRoute(h),null,h);
});

test('creator campaign brief requires rights, disclosure and bounded actual inputs',()=>{
  const good={
    brand:'MARCOSA ORIGINAL',audience:'Independent storytellers',
    goal:'Introduce the project through a voluntary, non-interruptive story ending.',
    storyId:'world-zero',product:'signal-worlds',
    rightsAttested:true,sponsorshipDisclosed:true
  };
  const draft=story.buildBrief(good);
  assert.equal(draft.schema,'marcosa-branded-story-brief/v1');
  assert.equal(draft.status,'draft_only');
  assert.equal(draft.publication_state,'not_published');
  assert.equal(draft.continuation_product,'signal-worlds');
  assert.equal(draft.ownership_self_attested,true);
  assert.equal(draft.rights_independently_verified,false);
  assert.equal(draft.product_public_service_verified,false);
  assert.equal(draft.tracking,false);
  assert.equal(draft.payments,false);
  assert.ok(draft.review_gates.includes('sponsorship_label'));
  assert.ok(draft.review_gates.includes('manual_publication_approval'));
  for(const overrides of [
    {brand:'x'},{brand:'b'.repeat(101)},{audience:'no'},
    {goal:'too short'},{storyId:'missing'},{product:'unsupported'},
    {rightsAttested:false},{sponsorshipDisclosed:false}
  ])assert.throws(()=>story.buildBrief({...good,...overrides}),/BRIEF_VALIDATION/);
  const inject=story.buildBrief({...good,brand:'<svg onload=alert(1)>'});
  assert.equal(inject.brand,'<svg onload=alert(1)>','JSON retains source text, UI must use textContent');
});

test('branded pitch exports safe self-contained HTML for print and never invents economics',()=>{
  const brief=story.buildBrief({
    brand:'<img src=x onerror=alert(1)>',audience:'Independent creative studios',
    goal:'Demonstrate the concept without any audience statistics, tracking or automatic publication.',
    storyId:'world-zero',product:'signal-worlds',rightsAttested:true,sponsorshipDisclosed:true
  });
  for(const lang of ['ru','en','zh']){
    const html=story.buildProposalHtml(brief,lang);
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('lang="'+lang+'"'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
    assert.ok(!html.includes('<script'));
    assert.ok(!html.includes('<iframe'));
    assert.ok(!html.includes('<link'));
    assert.ok(html.includes('Content-Security-Policy'));
    assert.ok(html.includes('NOT FOR PUBLICATION')||html.includes('НЕ ПУБЛИКОВАТЬ')||html.includes('不得发布'));
    assert.ok(html.includes('SIGNAL')||html.includes('signal-worlds'));
    assert.ok(html.includes('@media print'));
  }
  assert.throws(()=>story.buildProposalHtml({status:'published'}),/INVALID_PROPOSAL/);
  assert.throws(()=>story.buildProposalHtml({...brief,continuation_product:'fake'}),/INVALID_PROPOSAL/);
});

test('local QA is explicitly opt-in, bounded, session-only and never fabricates visitors',()=>{
  const qa=story.createQaRecorder();
  assert.equal(qa.record('film_started','signal',0),false);
  assert.equal(qa.size,0);
  qa.enable(true);
  assert.equal(qa.record('film_started','signal',0),true);
  assert.equal(qa.record('choice_selected','signal',1),true);
  assert.equal(qa.record('film_completed','signal',2),true);
  assert.equal(qa.record('recommendation_rendered','signal',2,'proofos'),true);
  assert.equal(qa.record('unknown_event','signal',2),false);
  assert.equal(qa.record('film_started','missing',0),false);
  const report=qa.report();
  assert.equal(report.schema,'marcosa-story-qa/v1');
  assert.equal(report.transmission,false);
  assert.equal(report.storage,'memory_only');
  assert.equal(report.scope,'single_tab_not_unique_people');
  assert.equal(report.counts.film_started,1);
  assert.equal(report.counts.recommendation_rendered,1);
  assert.ok(report.events.every(x=>Object.keys(x).every(k=>['type','story_id','stage','product_slug'].includes(k))));
  assert.ok(!JSON.stringify(report).includes('session_id'));
  assert.ok(!JSON.stringify(report).includes('visitor_id'));
  qa.enable(false);
  assert.equal(qa.size,0,'opting out drops in-memory QA events');
  assert.equal(qa.record('film_completed','signal',2),false);
});

test('R7 ending links round-trip every public outcome without leaking private data',()=>{
  let checked=0;
  for(const item of story.STORIES)for(const first of [0,1])for(const second of [0,1]){
    const state=story.advance(story.advance(story.createState(item.id),first),second);
    const route=story.encodeStoryRoute(state);
    assert.match(route,/^#story=[a-z0-9-]+\.[01]{2}$/);
    assert.deepEqual(story.parseStoryRoute(route),state);
    const link=story.buildShareUrl('https://example.test/path/stories.html?email=private%40example.com&token=abc#old',state);
    assert.equal(link,'https://example.test/path/stories.html'+route);
    assert.equal(link.includes('private'),false);
    assert.deepEqual(story.outcome(story.parseStoryRoute(new URL(link).hash)),story.outcome(state));
    checked++;
  }
  assert.equal(checked,12);
  for(const bad of [
    '', '#story=signal.', '#story=signal.02', '#story=signal.001',
    '#story=unknown.00', '#story=signal.00&redirect=https://evil.test',
    '#story=signal.%30%30', '#story=signal.<script>', '#story=signal.00?token=secret',
    '#story=signal.00'.repeat(8)
  ])assert.equal(story.parseStoryRoute(bad),null,bad);
  assert.throws(()=>story.encodeStoryRoute(story.createState('signal')),/INVALID_STORY_ROUTE/);
  assert.throws(()=>story.encodeStoryRoute({storyId:'signal',answers:[0,'1']}),/INVALID_STORY_ROUTE/);
  assert.throws(()=>story.encodeStoryRoute({storyId:'unknown',answers:[0,1]}),/INVALID_STORY_ROUTE/);
  assert.throws(()=>story.buildShareUrl('javascript:alert(1)',{storyId:'signal',answers:[0,0]}),/INVALID_SHARE_URL/);
  assert.equal(
    story.buildShareUrl('https://user:password@example.test/story.html?secret=1#old',{storyId:'signal',answers:[0,1]}),
    'https://example.test/story.html#story=signal.01'
  );
});

test('R5 page and home navigation provide keyboard-ready, localized, accessible controls',()=>{
  const dir=path.join(__dirname,'../site');
  const html=fs.readFileSync(path.join(dir,'stories.html'),'utf8');
  const home=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  const css=fs.readFileSync(path.join(dir,'stories.css'),'utf8');
  for(const id of ['ms-story-list','ms-stage','ms-choices','ms-finish','ms-project-link',
    'ms-campaign-link','ms-share-copy','ms-share-field','ms-share-url','ms-share-feedback','ms-brief-form','ms-brief-download','ms-brief-html','ms-qa-opt','ms-qa-download'])
    assert.ok(html.includes('id="'+id+'"'),id);
  for(const file of ['stories.html','stories.js','stories.css'])
    assert.ok(home.includes('./stories.html')||file!=='stories.html');
  assert.ok(html.includes('src="./network.js"'));
  assert.ok(html.includes('src="./stories.js"'));
  assert.ok(html.includes('href="./stories.css"'));
  assert.ok(home.includes('href="./stories.html"'));
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/:focus-visible/);
  assert.match(css,/\[hidden\]/);
});

test('no third-party tracking, persistence or dangerous HTML injection in the story engine',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../site/stories.js'),'utf8');
  for(const forbidden of [
    'fetch(', 'XMLHttpRequest','sendBeacon','localStorage','sessionStorage',
    'document.cookie','innerHTML','eval(', 'new Function(', 'https://cdn', 'new Image('
  ])assert.equal(code.includes(forbidden),false,'forbidden API: '+forbidden);
  assert.ok(code.includes('textContent'));
  assert.ok(code.includes('rights_independently_verified:false'));
});
