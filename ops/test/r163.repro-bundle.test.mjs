import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {buildR163Bundle,verifyR163Bundle,R163_REQUIRED_SOURCES} from '../r163/repro-bundle.mjs';

const sha='a'.repeat(40);
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'marcosa-r163-bundle-'));
 for(const p of R163_REQUIRED_SOURCES){
  await mkdir(dirname(join(root,p)),{recursive:true});
  await writeFile(join(root,p),'Synthetic source file: '+p+'\n');
 }
 return {root,clean:()=>rm(root,{recursive:true,force:true})};
}
test('R163 deterministic bundle reproduces canonical bytes and protects all mandatory files',async()=>{
 const f=await fixture();
 try{
  const a=await buildR163Bundle({root:f.root,commit:sha});
  for(const p of R163_REQUIRED_SOURCES)
   await utimes(join(f.root,p),new Date(12345678),new Date(12345678));
  const b=await buildR163Bundle({root:f.root,commit:sha});
  assert.deepEqual(a.bytes,b.bytes);
  assert.equal(a.sha256,b.sha256);
  assert.equal(a.sourceCount,R163_REQUIRED_SOURCES.length);
  assert.equal((await verifyR163Bundle({root:f.root,commit:sha,
   bytes:b.bytes,expectedSha256:a.sha256})).productionAuthorized,false);
 }finally{await f.clean();}
});
test('R163 stale checkout, altered binary, mismatched commit and forged production fail closed',async()=>{
 const f=await fixture();
 try{
  const a=await buildR163Bundle({root:f.root,commit:sha});
  await writeFile(join(f.root,R163_REQUIRED_SOURCES[0]),'tampered source');
  await assert.rejects(verifyR163Bundle({root:f.root,commit:sha,
   bytes:a.bytes,expectedSha256:a.sha256}),/source checkout|differs/);
  await assert.rejects(verifyR163Bundle({root:f.root,commit:'b'.repeat(40),
   bytes:a.bytes,expectedSha256:a.sha256}),/schema or sources/);
  const changed=Buffer.from(a.bytes);changed[100]^=1;
  await assert.rejects(verifyR163Bundle({root:f.root,commit:sha,
   bytes:changed,expectedSha256:a.sha256}),/bundle SHA256 mismatch/);
  await assert.rejects(buildR163Bundle({root:f.root,commit:'short'}),
   /full lowercase/);
 }finally{await f.clean();}
});
test('R163 symbolic link source and replacement cannot produce bundle',async()=>{
 const f=await fixture();
 try{
  const p=R163_REQUIRED_SOURCES[3],path=join(f.root,p);
  await rm(path);await symlink(join(f.root,R163_REQUIRED_SOURCES[0]),path);
  await assert.rejects(buildR163Bundle({root:f.root,commit:sha}),
   /unexpected source|unsafe source/);
 }finally{await f.clean();}
});
