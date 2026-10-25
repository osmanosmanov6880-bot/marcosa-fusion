import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRelease,REPO,PIPELINES} from '../ops/release_evidence_r114.mjs';
const sha='a'.repeat(40),newSha='b'.repeat(40);
const makeRun=(kind,patch={})=>({
 id:kind==='pages'?8701001:8701002,name:PIPELINES[kind].name,
 head_sha:sha,head_branch:'main',event:'push',status:'completed',
 conclusion:'success',...patch
});
const jobs=kind=>PIPELINES[kind].jobs.map((name,n)=>({
 id:5000+n,name,status:'completed',conclusion:'success'
}));
function context(p={},s={}){
 const pages=makeRun('pages',p),staging=makeRun('staging',s);
 return{sourceSha:sha,mainSha:sha,runs:[pages,staging],
 jobsByRun:{[pages.id]:jobs('pages'),[staging.id]:jobs('staging')}};
}
test('R114 same full SHA and ALL required job conclusions yield PASS for both channels only',()=>{
 const result=evaluateRelease(context());
 assert.equal(result.status,'PASS');
 assert.equal(result.channels.pages.status,'PASS');
 assert.equal(result.channels.staging.status,'PASS');
 assert.equal(result.sourceBasedPublicPagesVerified,true);
 assert.equal(result.sourceBasedRestrictedStagingVerified,true);
 assert.equal(result.productionAuthorized,false);
 assert.equal(result.productionCutoverVerified,false);
 assert.equal(result.privateAccountsOrDatabaseVerified,false);
 assert.ok(result.channels.pages.url.startsWith('https://github.com/'+REPO));
});
test('R114 Pages publish success without actual verify-public-bytes must NOT pass',()=>{
 const x=context();
 x.jobsByRun['8701001']=jobs('pages').filter(j=>j.name!=='verify-public-bytes');
 const r=evaluateRelease(x);
 assert.equal(r.status,'PENDING');
 assert.equal(r.channels.pages.status,'PENDING');
});
test('R114 real Pages readback failure blocks even if deploy succeeded',()=>{
 const x=context();
 x.jobsByRun['8701001']=jobs('pages').map(j=>j.name==='verify-public-bytes'?{...j,conclusion:'failure'}:j);
 const r=evaluateRelease(x);
 assert.equal(r.status,'FAIL');
 assert.equal(r.channels.staging.status,'PASS');
 assert.equal(r.channels.pages.status,'FAIL');
});
test('R114 staging build passes but SSH deploy omitted cannot pass',()=>{
 const x=context();
 x.jobsByRun['8701002']=jobs('staging').filter(j=>j.name!=='deploy_ssh_filesystem');
 const r=evaluateRelease(x);
 assert.equal(r.channels.staging.status,'PENDING');
 assert.equal(r.status,'PENDING');
});
test('R114 incomplete in-progress publication reports PENDING without claiming success',()=>{
 const x=context({status:'in_progress',conclusion:null});
 const r=evaluateRelease(x);
 assert.equal(r.status,'PENDING');
 assert.equal(r.channels.pages.reason,'RUN_STILL_ACTIVE');
 assert.equal(r.sourceBasedPublicPagesVerified,false);
});
test('R114 cancelled run fails, not reported as successful production',()=>{
 const x=context({conclusion:'cancelled'});
 const r=evaluateRelease(x);
 assert.equal(r.status,'FAIL');
 assert.equal(r.productionAuthorized,false);
});
test('R114 exact head SHA, main ref, branch and workflow names are required',()=>{
 const x=context();
 x.runs[0].head_sha=newSha;
 assert.equal(evaluateRelease(x).channels.pages.reason,'NO_MATCHING_EXACT_SHA_RUN');
 const y=context();
 y.mainSha=newSha;
 assert.equal(evaluateRelease(y).status,'SUPERSEDED');
 const z=context();
 z.runs[1].head_branch='feature';
 assert.equal(evaluateRelease(z).channels.staging.status,'PENDING');
 assert.throws(()=>evaluateRelease({...context(),sourceSha:'invalid'}));
});
test('R114 newer complete run supersedes older even if older succeeded',()=>{
 const x=context();
 x.runs.push(makeRun('pages',{id:9999001,status:'in_progress',conclusion:null}));
 assert.equal(evaluateRelease(x).channels.pages.reason,'RUN_STILL_ACTIVE');
});
test('R114 wrong workflow job name or skipped required job never passes',()=>{
 const x=context();
 x.jobsByRun['8701001']=jobs('pages').map(j=>j.name==='publish'?{...j,conclusion:'skipped'}:j);
 assert.equal(evaluateRelease(x).status,'FAIL');
});

test('R114 shipped public entry discloses static-preview-only scope and never claims accounts',async()=>{
 const {readFileSync}=await import('node:fs');
 const html=readFileSync(new URL('../site/index.html',import.meta.url),'utf8');
 assert.match(html,/name="marcosa-release-scope" content="R114-public-static-preview-only; no-production-cutover"/);
 assert.doesNotMatch(html,/name="marcosa-release-scope" content="production-ready"/);
});
