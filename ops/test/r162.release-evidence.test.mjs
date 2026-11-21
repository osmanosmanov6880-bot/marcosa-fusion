import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,appendFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {buildR162Evidence,verifyR162Evidence,R162_REQUIRED_FILES} from '../r162/release-evidence.mjs';
const repo='osmanosmanov6880-bot/marcosa-fusion',commit='a'.repeat(40);
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'r162-artifacts-'));
 for(const name of R162_REQUIRED_FILES){
  await mkdir(dirname(join(root,name)),{recursive:true});
  await writeFile(join(root,name),'test source:'+name);
 }
 return{root,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('R162 exact full-sha evidence, stable ordering and successful checkout readback',async()=>{
 const f=await setup();
 try{
  const m=await buildR162Evidence({root:f.root,repo,commit,
   files:[...R162_REQUIRED_FILES].reverse()});
  assert.equal(m.files.length,R162_REQUIRED_FILES.length);
  assert.deepEqual(m.files.map(f=>f.path),[...R162_REQUIRED_FILES].sort());
  assert.equal(m.productionAuthorized,false);
  const p=await verifyR162Evidence(m,{root:f.root,repo,commit});
  assert.equal(p.matchingLocalCheckout,true);
  assert.equal(p.independentReviewerApproved,false);
  assert.equal(p.sha256,m.manifestSha256);
 }finally{await f.cleanup();}
});
test('R162 source mutation, fake digest, fake commit or omitted code aborts',async()=>{
 const f=await setup();
 try{
  const m=await buildR162Evidence({root:f.root,repo,commit});
  await appendFile(join(f.root,R162_REQUIRED_FILES[0]),'\nchanged');
  await assert.rejects(verifyR162Evidence(m,{root:f.root,repo,commit}),/digest mismatch/);
  await assert.rejects(buildR162Evidence({root:f.root,repo,commit:'short'}),/full lowercase/);
  await assert.rejects(buildR162Evidence({root:f.root,repo,commit,
   files:R162_REQUIRED_FILES.slice(1)}),/complete bounded file set/);
  await assert.rejects(verifyR162Evidence({...m,productionAuthorized:true},
   {root:f.root,repo,commit}),/cannot authorize production/);
 }finally{await f.cleanup();}
});
test('R162 path traversal and symlinked source cannot be accepted',async()=>{
 const f=await setup();
 try{
  await assert.rejects(buildR162Evidence({root:f.root,repo,commit,
   files:[...R162_REQUIRED_FILES,'ops/r162/../../data.txt']}),/unsafe source/);
  const target=join(f.root,R162_REQUIRED_FILES[1]);
  await rm(target);
  await symlink(join(f.root,R162_REQUIRED_FILES[0]),target);
  await assert.rejects(buildR162Evidence({root:f.root,repo,commit}),/unexpected source file/);
 }finally{await f.cleanup();}
});
