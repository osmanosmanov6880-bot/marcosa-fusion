import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../../server-lab/server.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createR155SyntheticFixture} from '../r155/disposable-fixture.mjs';
import {buildSyntheticR155Bundle,verifySyntheticR155Bundle,syntheticStableUuid,R155_FORMAT} from '../r155/migration-bundle.mjs';
import {renderR155SyntheticSql} from '../r155/pg-replay.mjs';

test('R155 deterministic in-memory fixture captures all eight relation classes and excludes auth secrets',async()=>{
 const {bundle,sql,sourceCounts}=await createR155SyntheticFixture();
 assert.equal(bundle.format,R155_FORMAT);
 assert.ok(verifySyntheticR155Bundle(bundle));
 assert.equal(sourceCounts.seasons,2);
 assert.equal(sourceCounts.episodes,2);
 assert.equal(sourceCounts.subscriptions,1);
 assert.equal(sourceCounts.bookmarks,1);
 assert.equal(sourceCounts.attendance,1);
 assert.ok(sourceCounts.audit>=5);
 assert.equal(bundle.claims.realAuthMigrated,false);
 assert.equal(bundle.claims.financialDataMigrated,false);
 assert.equal(bundle.claims.productionCutoverAuthorized,false);
 assert.doesNotMatch(JSON.stringify(bundle),/example\.invalid|synthetic-no-real-account-password|password_hash|session_token|inviteCode|sessions/);
 assert.match(sql,/It''s a 100% synthetic rehearsal/);
 assert.match(sql,/ON CONFLICT DO NOTHING/);
 assert.match(sql,/source\/target mismatch/);
 assert.doesNotMatch(sql,/example\.invalid|password_hash|sk_live_|service_role/);
 assert.ok(sql.startsWith('-- R155 DISPOSABLE/TEST DATA ONLY'));
 assert.equal(syntheticStableUuid('season',1),syntheticStableUuid('season',1));
 assert.notEqual(syntheticStableUuid('season',1),syntheticStableUuid('post',1));
 const recalc=createHash('sha256').update(JSON.stringify({format:bundle.format,mode:bundle.mode,payload:bundle.payload})).digest('hex');
 assert.equal(recalc,bundle.checksumSha256);
});
test('R155 empty or missing identity bridge fails closed',async()=>{
 const app=createApp();
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 try{
  assert.throws(()=>buildSyntheticR155Bundle(app.db,{identityMap:{},syntheticOnly:false}),/forbidden/);
  assert.throws(()=>buildSyntheticR155Bundle(app.db,{identityMap:{},syntheticOnly:true}),/at most ten synthetic/);
 }finally{await app.close();}
});
test('R155 disk-backed SQLite is refused even for an explicitly mapped user',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'r155-disk-')),dbPath=join(dir,'db.sqlite');
 const app=createApp({databasePath:dbPath,inviteCode:'r155-disk-only'});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const base='http://127.0.0.1:'+app.server.address().port;
 try{
  const auth={username:'r155diskuser',email:'r155diskuser@example.invalid',
   password:'synthetic-test-password-only',inviteCode:'r155-disk-only'};
  const response=await fetch(base+'/api/auth/register',{method:'POST',
   headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(auth)});
  assert.equal(response.status,201);
  const userId=app.db.prepare("SELECT id FROM users WHERE username='r155diskuser'").get().id;
  const identityMap={[userId]:'15550000-0000-4555-8555-000000000001'};
  assert.throws(()=>buildSyntheticR155Bundle(app.db,{identityMap,syntheticOnly:true}),
   /Only disposable in-memory SQLite/);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('R155 forged content, field edits, cross-tenant authors and unsupported output all fail closed',async()=>{
 const {bundle}=await createR155SyntheticFixture();
 const corrupted=structuredClone(bundle);corrupted.payload.posts[0].body='forged';
 assert.equal(verifySyntheticR155Bundle(corrupted),false);
 assert.throws(()=>renderR155SyntheticSql(corrupted),/Unverified/);
 const tamper=structuredClone(bundle);
 tamper.payload.episodes[0].seriesId=tamper.payload.seasons[1].id;
 tamper.checksumSha256=createHash('sha256').update(JSON.stringify({format:tamper.format,mode:tamper.mode,payload:tamper.payload})).digest('hex');
 assert.equal(verifySyntheticR155Bundle(tamper),false);
 assert.throws(()=>renderR155SyntheticSql(tamper),/Unverified/);
 const unsupported=structuredClone(bundle);
 unsupported.claims.productionCutoverAuthorized=true;
 assert.equal(verifySyntheticR155Bundle(unsupported),false);
});
