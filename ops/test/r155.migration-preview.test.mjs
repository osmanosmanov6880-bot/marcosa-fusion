import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
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
test('R155 missing or duplicated auth identity bridge is rejected; disk-backed data is refused',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  assert.throws(()=>buildSyntheticR155Bundle(db,{identityMap:{},syntheticOnly:false}),/forbidden/);
  assert.throws(()=>buildSyntheticR155Bundle(db,{identityMap:{},syntheticOnly:true}),/at most ten synthetic/);
 }finally{db.close();}
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
